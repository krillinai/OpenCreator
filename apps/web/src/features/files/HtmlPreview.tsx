import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';

export type HtmlPreviewResources = {
  openText(path: string): Promise<{ content: string; mime: string }>;
  openBlob(path: string): Promise<{ objectUrl: string; mime: string; size: number }>;
  revokeBlob(objectUrl: string): void;
};

type ExternalPreviewLink = {
  url: string;
  label: string;
};

type SafePreviewDocument = {
  html: string;
  externalLinks: ExternalPreviewLink[];
};

const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  'media-src data:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ');
const MAX_PREVIEW_RESOURCES = 128;
const MAX_PREVIEW_RESOURCE_BYTES = 10 * 1024 * 1024;
const MAX_EXTERNAL_LINKS = 20;

type ResourceBudget = {
  remaining: number;
  remainingBytes: number;
};

export function HtmlPreview(props: {
  name: string;
  path: string;
  content: string;
  resources?: HtmlPreviewResources;
  onOpenExternal?(url: string): void;
}) {
  const [document, setDocument] = useState<SafePreviewDocument>(() => ({
    html: loadingDocument(),
    externalLinks: []
  }));

  useEffect(() => {
    let canceled = false;

    void buildSafePreviewDocument(props.content, props.path, props.resources)
      .then(nextDocument => {
        if (!canceled) setDocument(nextDocument);
      });

    return () => {
      canceled = true;
    };
  }, [props.content, props.path, props.resources]);

  return (
    <div className="file-preview file-preview-html">
      <iframe
        title={`${props.name} HTML 预览`}
        srcDoc={document.html}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
      {document.externalLinks.length > 0 && props.onOpenExternal !== undefined ? (
        <div className="html-preview-external-links" aria-label="预览外链">
          {document.externalLinks.map(link => (
            <button
              key={link.url}
              type="button"
              aria-label={`外部打开 ${link.label}`}
              title={link.url}
              onClick={() => props.onOpenExternal?.(link.url)}
            >
              <ExternalLink aria-hidden="true" size={13} />
              <span>{link.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

async function buildSafePreviewDocument(
  content: string,
  documentPath: string,
  resources?: HtmlPreviewResources
): Promise<SafePreviewDocument> {
  const parsed = new DOMParser().parseFromString(content, 'text/html');
  const externalLinks = collectAndDisableLinks(parsed);
  const blobCache = new Map<string, Promise<string | undefined>>();
  const resourceBudget: ResourceBudget = {
    remaining: MAX_PREVIEW_RESOURCES,
    remainingBytes: MAX_PREVIEW_RESOURCE_BYTES
  };

  removeDangerousContent(parsed);
  await rewriteInlineStyles(parsed, documentPath, resources, blobCache, resourceBudget);
  await inlineStylesheets(parsed, documentPath, resources, blobCache, resourceBudget);
  await rewriteMediaSources(parsed, documentPath, resources, blobCache, resourceBudget);
  installContentSecurityPolicy(parsed);

  return {
    html: `<!doctype html>\n${parsed.documentElement.outerHTML}`,
    externalLinks
  };
}

function removeDangerousContent(document: Document): void {
  document.querySelectorAll(
    'script[src], iframe, frame, frameset, object, embed, portal, base, meta[http-equiv], link[rel~="import"]'
  ).forEach(node => node.remove());

  document.querySelectorAll('form').forEach(form => {
    const replacement = document.createElement('div');
    while (form.firstChild) replacement.append(form.firstChild);
    form.replaceWith(replacement);
  });

  document.querySelectorAll('*').forEach(element => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith('on')
        || name === 'srcdoc'
        || name === 'action'
        || name === 'formaction'
        || name === 'ping'
        || name === 'nonce'
      ) {
        element.removeAttribute(attribute.name);
      }
      if (
        (name === 'href' || name === 'xlink:href')
        && element.tagName.toLowerCase() !== 'a'
        && element.tagName.toLowerCase() !== 'link'
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  document.querySelectorAll<HTMLElement>('[hidden]').forEach(element => {
    element.removeAttribute('hidden');
  });
  document.querySelectorAll<HTMLElement>('img[loading], iframe[loading]').forEach(element => {
    element.setAttribute('loading', 'eager');
  });
}

function collectAndDisableLinks(document: Document): ExternalPreviewLink[] {
  const links = new Map<string, ExternalPreviewLink>();
  document.querySelectorAll('a[href]').forEach(anchor => {
    const href = anchor.getAttribute('href')?.trim() ?? '';
    if (href.startsWith('#')) return;

    const externalUrl = parseExternalUrl(href);
    anchor.removeAttribute('href');
    anchor.removeAttribute('target');
    anchor.removeAttribute('download');
    anchor.setAttribute('aria-disabled', 'true');
    if (externalUrl === undefined) return;

    const label = anchor.textContent?.trim() || externalUrl;
    if (links.size < MAX_EXTERNAL_LINKS || links.has(externalUrl)) {
      links.set(externalUrl, { url: externalUrl, label });
    }
  });
  return [...links.values()];
}

async function inlineStylesheets(
  document: Document,
  documentPath: string,
  resources: HtmlPreviewResources | undefined,
  blobCache: Map<string, Promise<string | undefined>>,
  resourceBudget: ResourceBudget
): Promise<void> {
  const stylesheets = [...document.querySelectorAll('link[rel~="stylesheet"][href]')];
  await Promise.all(stylesheets.map(async link => {
    const href = link.getAttribute('href') ?? '';
    const path = resolveWorkspacePreviewPath(documentPath, href);
    if (path === undefined || resources === undefined) {
      link.remove();
      return;
    }
    if (resourceBudget.remaining <= 0) {
      link.remove();
      return;
    }
    resourceBudget.remaining -= 1;
    try {
      const stylesheet = await resources.openText(path);
      if (stylesheet.mime.toLowerCase().split(';', 1)[0]?.trim() !== 'text/css') {
        link.remove();
        return;
      }
      const style = document.createElement('style');
      style.textContent = await rewriteCssUrls(
        stylesheet.content,
        path,
        resources,
        blobCache,
        resourceBudget
      );
      link.replaceWith(style);
    } catch {
      link.remove();
    }
  }));
}

async function rewriteInlineStyles(
  document: Document,
  documentPath: string,
  resources: HtmlPreviewResources | undefined,
  blobCache: Map<string, Promise<string | undefined>>,
  resourceBudget: ResourceBudget
): Promise<void> {
  const styles = [...document.querySelectorAll('style')];
  await Promise.all(styles.map(async style => {
    style.textContent = await rewriteCssUrls(
      style.textContent ?? '',
      documentPath,
      resources,
      blobCache,
      resourceBudget
    );
  }));

  const styledElements = [...document.querySelectorAll<HTMLElement>('[style]')];
  await Promise.all(styledElements.map(async element => {
    element.setAttribute('style', await rewriteCssUrls(
      element.getAttribute('style') ?? '',
      documentPath,
      resources,
      blobCache,
      resourceBudget
    ));
  }));
}

async function rewriteMediaSources(
  document: Document,
  documentPath: string,
  resources: HtmlPreviewResources | undefined,
  blobCache: Map<string, Promise<string | undefined>>,
  resourceBudget: ResourceBudget
): Promise<void> {
  document.querySelectorAll('[srcset]').forEach(element => element.removeAttribute('srcset'));
  const sources = [
    ...document.querySelectorAll<HTMLElement>('img[src], source[src], audio[src], video[src], video[poster]')
  ];
  await Promise.all(sources.map(async element => {
    const attribute = element.hasAttribute('src') ? 'src' : 'poster';
    const reference = element.getAttribute(attribute) ?? '';
    if (isSafeEmbeddedResource(reference)) return;
    const path = resolveWorkspacePreviewPath(documentPath, reference);
    if (path === undefined || resources === undefined) {
      element.removeAttribute(attribute);
      return;
    }
    const dataUrl = await loadBlobUrl(path, resources, blobCache, resourceBudget);
    if (dataUrl === undefined) element.removeAttribute(attribute);
    else element.setAttribute(attribute, dataUrl);
  }));
}

async function rewriteCssUrls(
  css: string,
  stylesheetPath: string,
  resources: HtmlPreviewResources | undefined,
  blobCache: Map<string, Promise<string | undefined>>,
  resourceBudget: ResourceBudget
): Promise<string> {
  const withoutImports = css.replace(/@import\s+(?:url\()?[^;]+;?/gi, '');
  const matches = [...withoutImports.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)];
  if (matches.length === 0) return withoutImports;

  let result = '';
  let cursor = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    result += withoutImports.slice(cursor, index);
    const reference = match[2]?.trim() ?? '';
    if (isSafeEmbeddedResource(reference)) {
      result += match[0];
    } else {
      const path = resolveWorkspacePreviewPath(stylesheetPath, reference);
      const dataUrl = path === undefined || resources === undefined
        ? undefined
        : await loadBlobUrl(path, resources, blobCache, resourceBudget);
      result += dataUrl === undefined ? 'url("")' : `url("${dataUrl}")`;
    }
    cursor = index + match[0].length;
  }
  return result + withoutImports.slice(cursor);
}

async function loadBlobUrl(
  path: string,
  resources: HtmlPreviewResources,
  blobCache: Map<string, Promise<string | undefined>>,
  resourceBudget: ResourceBudget
): Promise<string | undefined> {
  const existing = blobCache.get(path);
  if (existing !== undefined) return existing;
  if (resourceBudget.remaining <= 0) return undefined;
  resourceBudget.remaining -= 1;

  const pending = resources.openBlob(path)
    .then(async resource => {
      const mime = normalizePreviewResourceMime(resource.mime);
      if (
        mime === undefined
        || resource.size > resourceBudget.remainingBytes
      ) {
        resources.revokeBlob(resource.objectUrl);
        return undefined;
      }
      resourceBudget.remainingBytes -= resource.size;
      try {
        return await objectUrlToDataUrl(resource.objectUrl, mime);
      } finally {
        resources.revokeBlob(resource.objectUrl);
      }
    })
    .catch(() => undefined);
  blobCache.set(path, pending);
  return pending;
}

function installContentSecurityPolicy(document: Document): void {
  document.querySelectorAll('meta[http-equiv]').forEach(meta => meta.remove());
  const meta = document.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', PREVIEW_CSP);
  document.head.prepend(meta);
  const previewOverrides = document.createElement('style');
  previewOverrides.setAttribute('data-clawee-preview', 'true');
  previewOverrides.textContent = `
    html, body {
      min-height: 100%;
      opacity: 1 !important;
      visibility: visible !important;
    }
    body { overflow: auto !important; }
    body > :not(script):not(style):not(link),
    [data-reveal],
    .reveal,
    .fade-in,
    .animate-in,
    .opacity-0,
    .invisible,
    [style*="opacity: 0"],
    [style*="opacity:0"],
    [style*="visibility: hidden"],
    [style*="visibility:hidden"] {
      opacity: 1 !important;
      visibility: visible !important;
      transform: none !important;
      animation: none !important;
    }
  `;
  document.head.append(previewOverrides);
}

function parseExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function isSafeEmbeddedResource(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('data:image/')
    || normalized.startsWith('data:font/')
    || normalized.startsWith('data:audio/')
    || normalized.startsWith('data:video/');
}

function normalizePreviewResourceMime(value: string): string | undefined {
  const mime = value.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  return /^(image|font|audio|video)\/[a-z0-9.+-]+$/.test(mime) ? mime : undefined;
}

async function objectUrlToDataUrl(objectUrl: string, mime: string): Promise<string> {
  const response = await fetch(objectUrl);
  if (!response.ok) throw new Error('无法读取预览资源');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export function resolveWorkspacePreviewPath(
  documentPath: string,
  reference: string
): string | undefined {
  const trimmed = reference.trim();
  if (
    trimmed.length === 0
    || trimmed.startsWith('#')
    || trimmed.startsWith('//')
    || trimmed.includes('\\')
    || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  ) {
    return undefined;
  }

  const pathOnly = trimmed.split(/[?#]/, 1)[0] ?? '';
  const baseSegments = pathOnly.startsWith('/')
    ? []
    : documentPath.split('/').slice(0, -1);
  for (const rawSegment of pathOnly.split('/')) {
    if (rawSegment.length === 0 || rawSegment === '.') continue;
    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      return undefined;
    }
    if (segment === '..') {
      if (baseSegments.length === 0) return undefined;
      baseSegments.pop();
      continue;
    }
    if (
      segment.length === 0
      || segment === '.'
      || segment.includes('/')
      || segment.includes('\\')
      || segment.includes('\0')
    ) {
      return undefined;
    }
    baseSegments.push(segment);
  }
  return baseSegments.length === 0 ? undefined : baseSegments.join('/');
}

function loadingDocument(): string {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"></head><body></body></html>`;
}

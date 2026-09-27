import type {
  CreatorArtifact,
  WechatArticleLayoutStyleId
} from '@opencreator/protocol';
import { existsSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { finished } from 'node:stream/promises';
import type { Token, Tokens } from 'marked';

type ArticleImageSource = {
  path: string;
  mimeType: string;
};

type ArticleDocumentInput = {
  markdown: string;
  title: string;
  layoutStyleId: WechatArticleLayoutStyleId;
  artifacts: CreatorArtifact[];
};

type PdfFont = {
  regular: PdfFontSource;
  bold: PdfFontSource;
};

type PdfFontSource = {
  path: string;
  family?: string;
};

const layoutAccents: Record<WechatArticleLayoutStyleId, string> = {
  minimal: '#1f2937',
  business: '#0f766e',
  editorial: '#b42318',
  vibrant: '#2563eb',
  technical: '#4338ca',
  podcast: '#7c3aed',
  newsroom: '#b45309'
};

export async function writeArticleHtml(
  path: string,
  input: ArticleDocumentInput
): Promise<number> {
  const { marked, Renderer } = await import('marked');
  const images = await imageSources(input.artifacts);
  const renderer = new Renderer();
  renderer.html = token => `<pre>${escapeHtml(token.text)}</pre>`;
  renderer.image = token => {
    const source = images.get(normalizeHref(token.href));
    const src = source?.dataUri ?? safeRemoteImageUrl(token.href);
    if (!src) return `<p class="missing-image">${escapeHtml(token.text || 'Image')}</p>`;
    const caption = token.text.trim()
      ? `<figcaption>${escapeHtml(token.text)}</figcaption>`
      : '';
    return `<figure><img src="${escapeAttribute(src)}" alt="${escapeAttribute(token.text)}">${caption}</figure>`;
  };
  renderer.link = token => {
    const href = safeLinkUrl(token.href);
    const label = marked.parseInline(token.text, { renderer }) as string;
    return href
      ? `<a href="${escapeAttribute(href)}">${label}</a>`
      : label;
  };
  const body = marked.parse(input.markdown, {
    gfm: true,
    renderer
  }) as string;
  const accent = layoutAccents[input.layoutStyleId];
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
:root { color-scheme: light; --accent: ${accent}; }
* { box-sizing: border-box; }
body { margin: 0; background: #f3f4f6; color: #202124; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; }
article { width: min(100% - 32px, 760px); margin: 32px auto; padding: 52px 58px 64px; background: #fff; }
h1, h2, h3, h4 { color: #111827; line-height: 1.35; }
h1 { margin: 0 0 32px; font-size: 32px; }
h2 { margin: 42px 0 18px; padding-left: 12px; border-left: 4px solid var(--accent); font-size: 23px; }
h3 { margin: 30px 0 14px; font-size: 18px; }
p, li { font-size: 16px; line-height: 1.85; }
p { margin: 0 0 18px; }
ul, ol { margin: 0 0 22px; padding-left: 28px; }
blockquote { margin: 26px 0; padding: 16px 20px; border-left: 4px solid var(--accent); background: #f7f7f8; color: #4b5563; }
blockquote p { margin: 0; }
figure { margin: 30px 0; }
img { display: block; width: 100%; height: auto; }
figcaption { margin-top: 9px; color: #6b7280; font-size: 13px; text-align: center; }
pre { overflow-x: auto; margin: 22px 0; padding: 16px; background: #111827; color: #f9fafb; font-size: 13px; line-height: 1.65; white-space: pre-wrap; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
table { width: 100%; margin: 24px 0; border-collapse: collapse; font-size: 14px; }
th, td { padding: 10px 12px; border: 1px solid #d1d5db; text-align: left; }
th { background: #f3f4f6; }
hr { margin: 34px 0; border: 0; border-top: 1px solid #d1d5db; }
a { color: var(--accent); }
.missing-image { padding: 18px; background: #f3f4f6; color: #6b7280; text-align: center; }
@media (max-width: 640px) { article { width: 100%; margin: 0; padding: 30px 22px 48px; } h1 { font-size: 27px; } }
@media print { body { background: #fff; } article { width: auto; margin: 0 auto; padding: 0; } }
</style>
</head>
<body><article data-layout="${input.layoutStyleId}">${body}</article></body>
</html>
`;
  await writeFile(path, html, 'utf8');
  return Buffer.byteLength(html, 'utf8');
}

export async function writeArticlePdf(
  path: string,
  input: ArticleDocumentInput
): Promise<number> {
  const [{ marked }, { default: PDFDocument }] = await Promise.all([
    import('marked'),
    import('pdfkit')
  ]);
  const fonts = resolvePdfFonts();
  const images = await imageSources(input.artifacts);
  const document = new PDFDocument({
    size: 'A4',
    margins: { top: 58, right: 62, bottom: 58, left: 62 },
    bufferPages: true,
    info: { Title: input.title, Creator: 'OpenCreator' }
  });
  document.registerFont('ArticleRegular', fonts.regular.path, fonts.regular.family);
  document.registerFont('ArticleBold', fonts.bold.path, fonts.bold.family);
  const output = createWriteStream(path, { mode: 0o600 });
  document.pipe(output);
  const accent = layoutAccents[input.layoutStyleId];
  renderPdfTokens(document, marked.lexer(input.markdown, { gfm: true }), images, accent);
  const pages = document.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    document.switchToPage(index);
    document.font('ArticleRegular').fontSize(8).fillColor('#8a8f98').text(
      String(index - pages.start + 1),
      document.page.margins.left,
      document.page.height - document.page.margins.bottom - 20,
      { width: contentWidth(document), align: 'center', lineBreak: false }
    );
  }
  document.end();
  await finished(output);
  return (await readFile(path)).byteLength;
}

function renderPdfTokens(
  document: PDFKit.PDFDocument,
  tokens: Token[],
  images: Map<string, ArticleImageSource & { dataUri: string }>,
  accent: string
): void {
  for (const token of tokens) {
    if (token.type === 'space' || token.type === 'def') continue;
    if (token.type === 'heading') {
      const heading = token as Tokens.Heading;
      const sizes = [25, 19, 15, 13, 12, 11];
      ensurePdfSpace(document, heading.depth === 1 ? 58 : 42);
      document
        .font('ArticleBold')
        .fontSize(sizes[heading.depth - 1] ?? 11)
        .fillColor(heading.depth === 2 ? accent : '#17191c')
        .text(inlineText(heading.tokens), { lineGap: 4 });
      document.moveDown(heading.depth === 1 ? 0.85 : 0.55);
      continue;
    }
    if (token.type === 'paragraph' || token.type === 'text') {
      const inlineTokens = (token as Tokens.Paragraph | Tokens.Text).tokens ?? [];
      const imageTokens = collectInlineImages(inlineTokens);
      const text = inlineText(inlineTokens).trim();
      if (text) {
        document.font('ArticleRegular').fontSize(11).fillColor('#2f3338').text(text, {
          lineGap: 5,
          paragraphGap: 9
        });
      }
      for (const image of imageTokens) renderPdfImage(document, image, images);
      continue;
    }
    if (token.type === 'blockquote') {
      const text = blockText((token as Tokens.Blockquote).tokens);
      ensurePdfSpace(document, 52);
      const startY = document.y;
      document.font('ArticleRegular').fontSize(10.5).fillColor('#50545a').text(text, {
        indent: 14,
        lineGap: 4,
        paragraphGap: 8
      });
      document.save().strokeColor(accent).lineWidth(3)
        .moveTo(document.page.margins.left, startY)
        .lineTo(document.page.margins.left, document.y - 5).stroke().restore();
      document.moveDown(0.5);
      continue;
    }
    if (token.type === 'list') {
      const list = token as Tokens.List;
      for (const [index, item] of list.items.entries()) {
        const marker = list.ordered ? `${Number(list.start || 1) + index}.` : '-';
        document.font('ArticleRegular').fontSize(11).fillColor('#2f3338').text(
          `${marker} ${blockText(item.tokens)}`,
          { indent: 8, lineGap: 4, paragraphGap: 6 }
        );
      }
      document.moveDown(0.4);
      continue;
    }
    if (token.type === 'code') {
      const code = token as Tokens.Code;
      ensurePdfSpace(document, 70);
      const top = document.y;
      const height = document.heightOfString(code.text, { width: contentWidth(document) - 24, lineGap: 3 }) + 22;
      document.save().fillColor('#f1f3f5').roundedRect(document.page.margins.left, top, contentWidth(document), height, 4).fill().restore();
      document.font('ArticleRegular').fontSize(9).fillColor('#333840').text(code.text, document.page.margins.left + 12, top + 10, {
        width: contentWidth(document) - 24,
        lineGap: 3
      });
      document.y = top + height + 12;
      continue;
    }
    if (token.type === 'table') {
      const table = token as Tokens.Table;
      ensurePdfSpace(document, 65);
      const rows = [table.header, ...table.rows];
      for (const [index, row] of rows.entries()) {
        document
          .font(index === 0 ? 'ArticleBold' : 'ArticleRegular')
          .fontSize(9.5)
          .fillColor('#30343a')
          .text(row.map(cell => inlineText(cell.tokens)).join(' | '), { lineGap: 3, paragraphGap: 5 });
        document.moveTo(document.page.margins.left, document.y - 2)
          .lineTo(document.page.width - document.page.margins.right, document.y - 2)
          .strokeColor('#d7d9dd').lineWidth(0.5).stroke();
      }
      document.moveDown(0.6);
      continue;
    }
    if (token.type === 'hr') {
      document.moveDown(0.5);
      document.moveTo(document.page.margins.left, document.y)
        .lineTo(document.page.width - document.page.margins.right, document.y)
        .strokeColor('#d7d9dd').lineWidth(0.7).stroke();
      document.moveDown(1);
      continue;
    }
    if (token.type === 'html') {
      document.font('ArticleRegular').fontSize(9.5).fillColor('#555b63').text((token as Tokens.HTML).text, { lineGap: 3, paragraphGap: 8 });
    }
  }
}

function renderPdfImage(
  document: PDFKit.PDFDocument,
  token: Tokens.Image,
  images: Map<string, ArticleImageSource & { dataUri: string }>
): void {
  const source = images.get(normalizeHref(token.href));
  if (source === undefined || source.mimeType === 'image/webp') {
    document.font('ArticleRegular').fontSize(9).fillColor('#737981').text(`[${token.text || 'Image'}]`, {
      align: 'center',
      paragraphGap: 8
    });
    return;
  }
  try {
    const width = contentWidth(document);
    const height = Math.min(width * 2 / 3, document.page.height * 0.56);
    ensurePdfSpace(document, height + 24);
    document.image(source.path, document.page.margins.left, document.y, {
      fit: [width, height],
      align: 'center',
      valign: 'center'
    });
    document.y += height + 8;
    if (token.text.trim()) {
      document.font('ArticleRegular').fontSize(8.5).fillColor('#777d85').text(token.text, { align: 'center', paragraphGap: 10 });
    }
  } catch {
    document.font('ArticleRegular').fontSize(9).fillColor('#737981').text(`[${token.text || 'Image'}]`, { align: 'center', paragraphGap: 8 });
  }
}

function collectInlineImages(tokens: Token[]): Tokens.Image[] {
  return tokens.flatMap(token => {
    if (token.type === 'image') return [token as Tokens.Image];
    const nested = 'tokens' in token && Array.isArray(token.tokens) ? token.tokens : [];
    return collectInlineImages(nested);
  });
}

function inlineText(tokens: Token[]): string {
  return tokens.map(token => {
    if (token.type === 'image') return '';
    if (token.type === 'br') return '\n';
    if (token.type === 'codespan') return (token as Tokens.Codespan).text;
    if (token.type === 'text' || token.type === 'escape' || token.type === 'html') {
      const nested = 'tokens' in token && Array.isArray(token.tokens) ? token.tokens : [];
      return nested.length > 0 ? inlineText(nested) : ('text' in token && typeof token.text === 'string' ? token.text : '');
    }
    if ('tokens' in token && Array.isArray(token.tokens)) return inlineText(token.tokens);
    return 'text' in token && typeof token.text === 'string' ? token.text : '';
  }).join('');
}

function blockText(tokens: Token[]): string {
  return tokens.map(token => {
    if (token.type === 'paragraph' || token.type === 'text' || token.type === 'heading') {
      const nested = 'tokens' in token && Array.isArray(token.tokens) ? token.tokens : [];
      return inlineText(nested);
    }
    if (token.type === 'list') return (token as Tokens.List).items.map(item => blockText(item.tokens)).join('\n');
    if (token.type === 'code') return (token as Tokens.Code).text;
    if (token.type === 'html') return (token as Tokens.HTML).text;
    if (token.type === 'blockquote') return blockText((token as Tokens.Blockquote).tokens);
    return '';
  }).filter(Boolean).join('\n');
}

function ensurePdfSpace(document: PDFKit.PDFDocument, height: number): void {
  if (document.y + height <= document.page.height - document.page.margins.bottom) return;
  document.addPage();
}

function contentWidth(document: PDFKit.PDFDocument): number {
  return document.page.width - document.page.margins.left - document.page.margins.right;
}

async function imageSources(artifacts: CreatorArtifact[]): Promise<Map<string, ArticleImageSource & { dataUri: string }>> {
  const sources = new Map<string, ArticleImageSource & { dataUri: string }>();
  for (const artifact of [...artifacts].reverse()) {
    if (artifact.kind !== 'article_image' || artifact.status !== 'completed' || artifact.path === null) continue;
    const fileName = metadataString(artifact.metadata.fileName);
    if (!fileName || sources.has(fileName)) continue;
    const mimeType = metadataString(artifact.metadata.mimeType) || imageMimeType(fileName);
    const content = await readFile(artifact.path).catch(() => undefined);
    if (content === undefined) continue;
    const source = {
      path: artifact.path,
      mimeType,
      dataUri: `data:${mimeType};base64,${content.toString('base64')}`
    };
    sources.set(fileName, source);
    sources.set(`./${fileName}`, source);
  }
  return sources;
}

function resolvePdfFonts(): PdfFont {
  const candidates: PdfFont[] = process.platform === 'darwin'
    ? [
        {
          regular: { path: '/Library/Fonts/RODE Noto Sans CJK SC R.otf' },
          bold: { path: '/Library/Fonts/RODE Noto Sans CJK SC B.otf' }
        },
        {
          regular: {
            path: '/System/Library/Fonts/STHeiti Light.ttc',
            family: 'STHeitiSC-Light'
          },
          bold: {
            path: '/System/Library/Fonts/STHeiti Medium.ttc',
            family: 'STHeitiSC-Medium'
          }
        }
      ]
    : process.platform === 'win32'
      ? [
          {
            regular: {
              path: 'C:\\Windows\\Fonts\\msyh.ttc',
              family: 'MicrosoftYaHei'
            },
            bold: {
              path: 'C:\\Windows\\Fonts\\msyhbd.ttc',
              family: 'MicrosoftYaHei-Bold'
            }
          },
          {
            regular: { path: 'C:\\Windows\\Fonts\\simhei.ttf' },
            bold: { path: 'C:\\Windows\\Fonts\\simhei.ttf' }
          }
        ]
      : [
          {
            regular: {
              path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
              family: 'NotoSansCJKsc-Regular'
            },
            bold: {
              path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
              family: 'NotoSansCJKsc-Bold'
            }
          },
          {
            regular: {
              path: '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
              family: 'NotoSansCJKsc-Regular'
            },
            bold: {
              path: '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
              family: 'NotoSansCJKsc-Bold'
            }
          },
          {
            regular: { path: '/usr/share/fonts/opentype/source-han-sans/SourceHanSansSC-Regular.otf' },
            bold: { path: '/usr/share/fonts/opentype/source-han-sans/SourceHanSansSC-Bold.otf' }
          }
        ];
  const selected = candidates.find(candidate => existsSync(candidate.regular.path));
  if (selected === undefined) {
    throw new Error('No CJK font is available for PDF generation');
  }
  return {
    regular: selected.regular,
    bold: existsSync(selected.bold.path) ? selected.bold : selected.regular
  };
}

function metadataString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function imageMimeType(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'image/png';
}

function normalizeHref(value: string): string {
  return decodeURIComponent(value).replace(/^\.\//u, '');
}

function safeRemoteImageUrl(value: string): string {
  return /^https?:\/\//iu.test(value) ? value : '';
}

function safeLinkUrl(value: string): string {
  return /^(?:https?:\/\/|mailto:)/iu.test(value) ? value : '';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]!);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

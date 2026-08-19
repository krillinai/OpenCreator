(() => {
  const runtimeAttribute = 'data-opencreator-preview-runtime';
  const ignoredTags = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);
  const visualSelector = 'img, svg, canvas, video, picture, [role="img"]';
  let completed = false;

  function setState(state) {
    document.documentElement.setAttribute('data-opencreator-preview-state', state);
  }

  function isRuntimeNode(node) {
    const element = node.nodeType === Node.ELEMENT_NODE
      ? node
      : node.parentElement;
    return element?.closest(`[${runtimeAttribute}]`) != null;
  }

  function colorAlpha(value) {
    if (value === 'transparent') return 0;
    const legacy = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+%?)\s*\)$/.exec(value);
    const modern = /^rgba?\([^/]+\/\s*([\d.]+%?)\s*\)$/.exec(value);
    const alpha = legacy?.[1] ?? modern?.[1];
    if (alpha === undefined) return 1;
    return alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha);
  }

  function rectIsVisible(rect) {
    const viewportWidth = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const viewportHeight = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
    return rect.width > 1
      && rect.height > 1
      && rect.right > 0
      && rect.bottom > 0
      && rect.left < viewportWidth
      && rect.top < viewportHeight;
  }

  function chainIsVisible(element) {
    let current = element;
    while (current) {
      const style = getComputedStyle(current);
      const opacity = Number(style.opacity);
      if (
        style.display === 'none'
        || style.visibility === 'hidden'
        || style.visibility === 'collapse'
        || style.contentVisibility === 'hidden'
        || (Number.isFinite(opacity) && opacity <= 0.01)
        || /opacity\(\s*0(?:[.)]|\s)/.test(style.filter)
      ) {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  }

  function textNodeIsVisible(node) {
    const parent = node.parentElement;
    if (
      !parent
      || ignoredTags.has(parent.tagName)
      || isRuntimeNode(parent)
      || !node.textContent?.trim()
      || !chainIsVisible(parent)
      || colorAlpha(getComputedStyle(parent).color) <= 0.01
    ) {
      return false;
    }

    const range = document.createRange();
    range.selectNodeContents(node);
    return Array.from(range.getClientRects()).some(rectIsVisible);
  }

  function elementPaintsVisibleContent(element) {
    if (isRuntimeNode(element) || !chainIsVisible(element)) return false;
    if (!Array.from(element.getClientRects()).some(rectIsVisible)) return false;
    if (element.matches(visualSelector)) return true;

    const style = getComputedStyle(element);
    return style.backgroundImage !== 'none'
      || colorAlpha(style.backgroundColor) > 0.01
      || style.boxShadow !== 'none'
      || Number(style.borderTopWidth.replace('px', '')) > 0
      || Number(style.borderRightWidth.replace('px', '')) > 0
      || Number(style.borderBottomWidth.replace('px', '')) > 0
      || Number(style.borderLeftWidth.replace('px', '')) > 0;
  }

  function hasVisibleContent() {
    const body = document.body;
    if (!body) return false;

    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      if (textNodeIsVisible(textNode)) return true;
      textNode = walker.nextNode();
    }

    const candidates = Array.from(body.querySelectorAll('*')).slice(0, 1000);
    return candidates.some(element => (
      !ignoredTags.has(element.tagName)
      && elementPaintsVisibleContent(element)
    ));
  }

  function collectMeaningfulElements() {
    const elements = new Set();
    const body = document.body;
    if (!body) return [];

    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      const parent = textNode.parentElement;
      if (
        parent
        && !ignoredTags.has(parent.tagName)
        && !isRuntimeNode(parent)
        && textNode.textContent?.trim()
      ) {
        elements.add(parent);
      }
      textNode = walker.nextNode();
    }

    body.querySelectorAll(visualSelector).forEach(element => {
      if (!isRuntimeNode(element)) elements.add(element);
    });
    return Array.from(elements);
  }

  function forceVisible(element) {
    let current = element;
    while (current && current !== document.documentElement) {
      if (isRuntimeNode(current)) break;
      const style = getComputedStyle(current);
      const rect = current.getBoundingClientRect();
      const inline = current.style;
      current.setAttribute('data-opencreator-preview-force-visible', 'true');

      if (style.display === 'none') inline.setProperty('display', 'revert', 'important');
      inline.setProperty('visibility', 'visible', 'important');
      inline.setProperty('opacity', '1', 'important');
      inline.setProperty('content-visibility', 'visible', 'important');
      inline.setProperty('transform', 'none', 'important');
      inline.setProperty('translate', 'none', 'important');
      inline.setProperty('scale', '1', 'important');
      inline.setProperty('rotate', 'none', 'important');
      inline.setProperty('filter', 'none', 'important');
      inline.setProperty('clip', 'auto', 'important');
      inline.setProperty('clip-path', 'none', 'important');
      inline.setProperty('max-width', 'none', 'important');
      inline.setProperty('max-height', 'none', 'important');

      if (style.overflow === 'hidden' || style.overflow === 'clip') {
        inline.setProperty('overflow', 'visible', 'important');
      }
      if (rect.width <= 1) inline.setProperty('width', 'auto', 'important');
      if (rect.height <= 1) inline.setProperty('height', 'auto', 'important');
      if (
        !rectIsVisible(rect)
        && (style.position === 'fixed' || style.position === 'absolute')
      ) {
        inline.setProperty('position', 'relative', 'important');
        inline.setProperty('inset', 'auto', 'important');
      }
      if (colorAlpha(style.color) <= 0.01) {
        inline.setProperty('color', 'CanvasText', 'important');
      }
      if (Number(style.fontSize.replace('px', '')) <= 1) {
        inline.setProperty('font-size', '16px', 'important');
      }
      if (Math.abs(Number(style.textIndent.replace('px', ''))) > 1000) {
        inline.setProperty('text-indent', '0', 'important');
      }
      if (Number(style.zIndex) < 0) inline.setProperty('z-index', 'auto', 'important');
      current = current.parentElement;
    }
  }

  function showBlankNotice(hasSourceContent) {
    if (document.querySelector(`[${runtimeAttribute}="notice"]`)) return;
    const notice = document.createElement('div');
    notice.setAttribute(runtimeAttribute, 'notice');
    notice.setAttribute('role', 'status');
    notice.textContent = hasSourceContent
      ? 'HTML 未渲染出可见内容，可能依赖预览中已禁用的外部脚本或资源。'
      : 'HTML 文件没有可显示的内容。';
    notice.style.cssText = [
      'box-sizing:border-box',
      'max-width:560px',
      'margin:32px auto',
      'padding:14px 16px',
      'border:1px solid #d7d7d7',
      'border-radius:6px',
      'background:#fff',
      'color:#333',
      'font:14px/1.6 system-ui,sans-serif'
    ].join(';');
    document.body.append(notice);
  }

  function finishRecovery(elements) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (hasVisibleContent()) {
          setState('recovered');
        } else {
          showBlankNotice(elements.length > 0);
          setState('blank');
        }
        completed = true;
      });
    });
  }

  function check(finalCheck) {
    if (completed) return;
    if (hasVisibleContent()) {
      setState('ready');
      completed = true;
      return;
    }
    if (!finalCheck) return;

    const elements = collectMeaningfulElements();
    if (elements.length === 0) {
      showBlankNotice(false);
      setState('blank');
      completed = true;
      return;
    }

    setState('recovering');
    document.querySelectorAll('[hidden]').forEach(element => element.removeAttribute('hidden'));
    elements.forEach(forceVisible);
    finishRecovery(elements);
  }

  function start() {
    setState('checking');
    [0, 120, 600].forEach(delay => window.setTimeout(() => check(false), delay));
    window.setTimeout(() => check(true), 1800);
    window.addEventListener('load', () => check(false), { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

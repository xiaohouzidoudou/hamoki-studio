/* 2026-11-05 type scale: a global floor that preserves hierarchy.
   Component CSS sets 9–12px in dozens of places (dialogs, panels, cards built at
   runtime), so a pure stylesheet cannot reach all of them. This pass lifts the
   small sizes onto readable steps instead of one flat size:

        < 10px   -> 11px
      10 – 10.8  -> 11.5px
      10.9 – 11.3 -> 12px
      11.4 – 11.8 -> 12.5px
      11.9 – 12.4 -> 13px
      >= 12.5       untouched (titles keep their size)

   Elements inside canvas notes, code samples and the wordmark are skipped so
   user content and artwork keep their own metrics. */

(() => {
  const BODY_LIMIT = 12.5;

  const step = size => {
    if (size < 10) return 11;
    if (size < 10.9) return 11.5;
    if (size < 11.4) return 12;
    if (size < 11.9) return 12.5;
    if (size < BODY_LIMIT) return 13;
    return size;
  };

  const SKIP = '.canvas-node, .canvas-rich-node, svg, code, pre, kbd, .logo, .svg-sprites';
  const TEXTUAL = new Set([
    'P','SPAN','SMALL','STRONG','EM','B','I','LABEL','BUTTON','A','LI','TD','TH',
    'SUMMARY','FIGCAPTION','INPUT','TEXTAREA','SELECT','OPTION',
    'H1','H2','H3','H4','H5','H6','DIV'
  ]);

  const hasOwnText = el => {
    for (const node of el.childNodes) {
      if (node.nodeType === 3 && node.textContent.trim()) return true;
    }
    return false;
  };

  const fix = el => {
    if (!(el instanceof HTMLElement)) return;
    if (el.dataset.typeScaled) return;
    if (!TEXTUAL.has(el.tagName)) return;
    if (!hasOwnText(el)) return;
    if (el.closest(SKIP)) return;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (!Number.isFinite(size) || size >= BODY_LIMIT) return;
    el.style.fontSize = step(size) + 'px';
    el.dataset.typeScaled = '1';
  };

  const sweep = root => {
    if (!(root instanceof Element)) return;
    fix(root);
    for (const el of root.querySelectorAll('*')) fix(el);
  };

  const run = () => {
    sweep(document.body);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) sweep(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();

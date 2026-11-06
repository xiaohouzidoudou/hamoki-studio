/* Hamoki Studio | Global Border Trace
 * A single SVG overlay traces the currently hovered/focused control.
 * Delegated events cover dynamically rendered menus without creating an SVG per button.
 * No click interception, DOM reparenting of controls, or layout/transform changes.
 */
(() => {
  'use strict';

  const INTERACTIVE = [
    'button', 'a[href]', 'summary', '[role="button"]', '[role="tab"]',
    '[role="option"]', '[role="menuitem"]', '[role="switch"]',
    '.model-picker-option', '.work-card', '.hmt-card', '.hmt-cat',
    '.template-card', '.project-card', '.style-card', '.asset-card',
    '.reference-thumb', '.queue-item', '.project-row', '.layer-row',
    '.project-item', '.layer-item', '.recent-item', '.flow-node',
    '.flow-card', '.hmt-template-card', '.hmt-category-card',
    '.ng-flow-page .node-card'
  ].join(',');
  const FOCUS_ONLY = 'input:not([type="hidden"]):not([type="file"]),textarea,select,[contenteditable="true"]';
  const EXCLUDED = '.canvas-selection-handle,.canvas-border-trace,[data-hm-no-border-trace]';
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

  let overlay = null;
  let outline = null;
  let hovered = null;
  let focused = null;
  let active = null;
  let sequence = 0;
  let motionFrame = 0;
  let geometry = '';
  let paused = false;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function enabled(target) {
    if (paused || document.body?.classList.contains('haop-open')) return false;
    if (!target || !target.isConnected || target.matches(EXCLUDED)) return false;
    if (target.closest('[inert],[hidden],[aria-hidden="true"],[data-hm-no-border-trace]')) return false;
    if (target.matches(':disabled,[disabled],[aria-disabled="true"]')) return false;
    // Image canvases retain their own local trace (and native drag/resize behavior).
    if (target.matches('.canvas-node,.generation-frame')) return false;
    if (target.closest('.canvas-node') && !target.matches('button,a[href],[role="button"]')) return false;

    const box = target.getBoundingClientRect();
    if (box.width < 22 || box.height < 18 ||
        box.width > Math.max(850, window.innerWidth * .78) ||
        box.height > Math.max(570, window.innerHeight * .7) ||
        box.bottom < 0 || box.right < 0 ||
        box.left > window.innerWidth || box.top > window.innerHeight) return false;

    const style = getComputedStyle(target);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function candidate(node, allowInputs = false) {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    if (!el?.closest) return null;
    const target = el.closest(allowInputs ? INTERACTIVE + ',' + FOCUS_ONLY : INTERACTIVE);
    return enabled(target) ? target : null;
  }

  function createOverlay() {
    if (overlay) return;
    const ns = 'http://www.w3.org/2000/svg';
    overlay = document.createElementNS(ns, 'svg');
    overlay.classList.add('hm-global-trace');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('focusable', 'false');
    outline = document.createElementNS(ns, 'rect');
    outline.setAttribute('pathLength', '100');
    outline.setAttribute('fill', 'none');
    overlay.append(outline);
    document.body.append(overlay);
  }

  function hostFor(target) {
    // Native dialog/popover top layers paint above body-level overlays.
    return target.closest('dialog[open],[popover]') || document.body;
  }

  function syncGeometry() {
    if (!active || !active.isConnected || !overlay) return;
    const box = active.getBoundingClientRect();
    const host = hostFor(active);
    if (overlay.parentNode !== host) {
      host.append(overlay);
      geometry = '';
    }

    const hostBox = host === document.body ? null : host.getBoundingClientRect();
    const posX = hostBox ? box.left - hostBox.left + host.scrollLeft - host.clientLeft : box.left;
    const posY = hostBox ? box.top - hostBox.top + host.scrollTop - host.clientTop : box.top;
    const radius = Math.max(2, Math.min(parseFloat(getComputedStyle(active).borderTopLeftRadius) || 8,
      box.width / 2, box.height / 2));
    const w = Math.max(2, box.width);
    const h = Math.max(2, box.height);
    const coords = [posX,posY,w,h,radius,host===document.body?'viewport':'layer']
      .map(v => typeof v === 'number' ? v.toFixed(1) : v).join(':');
    if (geometry === coords) return;
    geometry = coords;

    overlay.dataset.host = host === document.body ? 'viewport' : 'layer';
    overlay.style.left = posX + 'px';
    overlay.style.top = posY + 'px';
    overlay.style.width = w + 'px';
    overlay.style.height = h + 'px';
    outline.setAttribute('x','0.9');
    outline.setAttribute('y','0.9');
    outline.setAttribute('width',String(Math.max(1,w - 1.8)));
    outline.setAttribute('height',String(Math.max(1,h - 1.8)));
    outline.setAttribute('rx',String(Math.max(1,radius - .5)));
    outline.style.strokeWidth = (w < 46 || h < 30) ? '1.2px' : '1.55px';
  }

  function trackGeometry(startTime) {
    cancelAnimationFrame(motionFrame);
    function step(now) {
      if (!active || !overlay?.classList.contains('is-active')) return;
      syncGeometry();
      if (now - startTime < 720) motionFrame = requestAnimationFrame(step);
    }
    motionFrame = requestAnimationFrame(step);
  }

  function activate(target) {
    if (active === target) return;
    active = target;
    sequence++;
    cancelAnimationFrame(motionFrame);
    if (!target) {
      overlay?.classList.remove('is-active','is-resetting');
      return;
    }

    createOverlay();
    overlay.dataset.tone = target.matches('[class*="danger"],[class*="delete"],[class*="remove"],[class*="trash"]')
      ? 'danger' : 'mint';

    // Reset old animation BEFORE moving to another element, then begin at one corner.
    overlay.classList.remove('is-active');
    overlay.classList.add('is-resetting');
    geometry = '';
    syncGeometry();
    void getComputedStyle(outline).strokeDashoffset;
    const id = sequence;
    requestAnimationFrame(() => {
      if (id !== sequence || target !== active) return;
      overlay.classList.remove('is-resetting');
      requestAnimationFrame(() => {
        if (id !== sequence || target !== active) return;
        overlay.classList.add('is-active');
        syncGeometry();
        if (!reduceMotion.matches) trackGeometry(performance.now());
      });
    });
  }

  function refresh() {
    activate(hovered || focused);
  }

  document.addEventListener('pointerover', event => {
    if (!finePointer.matches) return;
    const next = candidate(event.target);
    if (next === hovered) return;
    hovered = next;
    refresh();
  }, true);

  document.addEventListener('pointerout', event => {
    if (!hovered || !hovered.contains(event.target) ||
        (event.relatedTarget && hovered.contains(event.relatedTarget))) return;
    hovered = null;
    refresh();
  }, true);

  document.addEventListener('focusin', event => {
    const target = candidate(event.target, true);
    if (!target) return;
    // Avoid a persistent ring after clicking buttons; inputs still show focus.
    if (target.matches(FOCUS_ONLY) || target.matches(':focus-visible')) {
      focused = target;
      refresh();
    }
  }, true);

  document.addEventListener('focusout', event => {
    if (!focused || !focused.contains(event.target)) return;
    focused = null;
    refresh();
  }, true);

  function refreshPosition() {
    if (active) {
      if (!enabled(active)) {
        if (active === hovered) hovered = null;
        if (active === focused) focused = null;
        refresh();
      } else syncGeometry();
    }
  }
  window.addEventListener('scroll', refreshPosition, {capture:true, passive:true});
  window.addEventListener('resize', refreshPosition, {passive:true});
  // Route changes and closing menus can remove the hovered element mid-click.
  document.addEventListener('click', () => requestAnimationFrame(refreshPosition), true);
  window.visualViewport?.addEventListener('resize',refreshPosition,{passive:true});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {hovered = null; focused = null; refresh();}
  });

  // A modal must cover the previous trace immediately, not after its 600ms animation.
  function pause() {
    paused = true;
    hovered = null;
    focused = null;
    activate(null);
    if (overlay) {
      overlay.classList.add('is-resetting');
      overlay.style.display = 'none';
    }
  }
  function resume() {
    if (!paused) return;
    paused = false;
    hovered = null;
    focused = null;
    if (overlay) {
      overlay.classList.remove('is-active', 'is-resetting');
      overlay.style.removeProperty('display');
    }
  }
  window.HamokiGlobalBorderTrace = {
    pause, resume,
    getState: () => ({
      paused,

      active: Boolean(active),
      tag: active?.tagName || null,
      id: active?.id || null,
      offset: outline ? getComputedStyle(outline).strokeDashoffset : null,
      duration: outline ? getComputedStyle(outline).transitionDuration : null,
      overlayCount: document.querySelectorAll('.hm-global-trace').length
    })
  };
})();

/* Lightweight UI-only state. Does not alter canvas world coordinates,
   pointer capture, scroll position, or generation workflows. */
(() => {
  'use strict';
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let pointer = null;

  function stopPointer() {
    if (!pointer) return;
    pointer.node.classList.remove('hm-motion-dragging', 'hm-motion-resizing');
    pointer = null;
  }

  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.shiftKey || !event.target?.closest) return;
    const card = event.target.closest('.canvas-node');
    if (!card || event.target.closest('input,textarea,select,[contenteditable],a')) return;
    const handle = event.target.closest('.canvas-selection-handle');
    if (!handle && event.target.closest('button')) return;
    stopPointer();
    pointer = {
      node: card, id: event.pointerId, x: event.clientX, y: event.clientY,
      className: handle ? 'hm-motion-resizing' : 'hm-motion-dragging',
      activated: false
    };
    // Resize has a dedicated hit target; drag activates after an actual move,
    // so a normal click never looks like a card is being moved.
    if (handle) {
      card.classList.add(pointer.className);
      pointer.activated = true;
    }
  }, true);

  document.addEventListener('pointermove', event => {
    if (!pointer || event.pointerId !== pointer.id || pointer.activated) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (dx * dx + dy * dy < 16) return;
    if (pointer.node.isConnected) pointer.node.classList.add(pointer.className);
    pointer.activated = true;
  }, true);

  document.addEventListener('pointerup', stopPointer, true);
  document.addEventListener('pointercancel', stopPointer, true);
  window.addEventListener('blur', stopPointer);

  // Animate view presentation only after its existing navigation handler
  // finishes. Do not mount/unmount panels, or interfere with text input.
  document.querySelector('.sidebar-nav')?.addEventListener('click', event => {
    const nav = event.target.closest('.nav-icon-btn');
    if (!nav || nav.dataset.view === 'settings' || reducedMotion?.matches) return;
    requestAnimationFrame(() => {
      if (document.body.classList.contains('hamoki-templates-mode')) return;
      const panel = document.getElementById('params-panel');
      if (!panel || getComputedStyle(panel).display === 'none') return;
      panel.classList.remove('hm-motion-view-enter');
      void panel.offsetWidth;
      panel.classList.add('hm-motion-view-enter');
      panel.addEventListener('animationend', e => {
        if (e.target === panel) panel.classList.remove('hm-motion-view-enter');
      }, {once:true});
    });
  });
})();

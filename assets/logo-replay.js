// Hamoki plush logo plays once when the page opens, then once per minute.
'use strict';
(() => {
  const INTERVAL_MS = 60_000;
  const logo = document.querySelector('img.hamoki-wordmark');
  if (!logo) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let timer = null;
  let sequence = 0;
  let lastPlay = Date.now(); // The initial <img> begins playing during page load.

  function replay() {
    if (document.hidden || reducedMotion.matches) return;
    const url = new URL('assets/hamoki-intro-once.webp', document.baseURI);
    url.searchParams.set('replay', Date.now() + '-' + (++sequence));
    logo.src = url.pathname + url.search; // Unique URL restarts the one-shot animation.
    lastPlay = Date.now();
  }
  function schedule() {
    if (timer !== null) window.clearInterval(timer);
    timer = reducedMotion.matches ? null : window.setInterval(replay, INTERVAL_MS);
  }

  // A restored back/forward cache page keeps the old last frame.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    replay();
    schedule();
  });
  // Skip work in hidden tabs; resume the animation when the user returns.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastPlay >= INTERVAL_MS) {
      replay();
      schedule();
    }
  });
  reducedMotion.addEventListener?.('change', () => {
    if (!reducedMotion.matches) replay();
    schedule();
  });
  schedule();
})();

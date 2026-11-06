/* Keep the existing generation canvas intact; mount the workflow as a sibling view. */
'use strict';
(() => {
  let host = null;
  let expandedBefore = null;
  function openWorkflow() {
    // Close the in-app game tool catalog before presenting the workflow iframe.
    window.HamokiGameToolPlaza?.close?.();
    if (!host) {
      host = document.createElement('div');
      host.id = 'flow-host';
      host.className = 'flow-host';
      host.hidden = true;
      const frame = document.createElement('iframe');
      frame.title = 'Hamoki Studio · 游戏 UI 工作流画布';
      frame.src = 'gameui-flow.html';
      frame.loading = 'eager';
      host.append(frame);
      document.querySelector('.main-content')?.append(host);
    }
    const sidebar = document.getElementById('sidebar');
    if (expandedBefore === null) expandedBefore = !!sidebar?.classList.contains('expanded');
    if (sidebar) sidebar.classList.remove('expanded');
    if (typeof state !== 'undefined') {
      state.sidebarExpanded = false;
      state.currentView = 'game-ui-flow';
    }
    host.hidden = false;
    document.body.classList.add('flow-mode');
    document.querySelectorAll('.nav-icon-btn').forEach(btn => {
      const on = btn.dataset.view === 'game-ui-flow';
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-current', on ? 'page' : 'false');
    });
    host.querySelector('iframe')?.contentWindow?.postMessage({type:'flow-activate'},location.origin);
  }
  function closeWorkflow() {
    if (!document.body.classList.contains('flow-mode')) return;
    document.body.classList.remove('flow-mode');
    if (host) host.hidden = true;
    const sidebar = document.getElementById('sidebar');
    if (sidebar && expandedBefore !== null) sidebar.classList.toggle('expanded',expandedBefore);
    if (typeof state !== 'undefined' && expandedBefore !== null) state.sidebarExpanded = expandedBefore;
    expandedBefore = null;
  }
  document.addEventListener('click',event => {
    const nav = event.target.closest?.('.nav-icon-btn');
    if (!nav) return;
    if (nav.dataset.view === 'game-ui-flow') {
      event.preventDefault();
      event.stopImmediatePropagation();
      openWorkflow();
      return;
    }
    if (nav.dataset.view !== 'settings') closeWorkflow();
  },true);
  document.addEventListener('DOMContentLoaded',() => {
    if (new URLSearchParams(location.search).get('view') === 'game-ui-flow') openWorkflow();
  });
  window.HamokiGameFlow = {open:openWorkflow,close:closeWorkflow};
})();
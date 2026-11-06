/* Hamoki Studio | glass select enhancement
   Keeps the original <select> in the form and forwards native input/change.
   Progressive enhancement: if JS cannot initialize, the native control remains. */
(() => {
  'use strict';
  if (!document.documentElement.classList.contains('glass-landing')) return;
  const HOST = 'hm-glass-select-host';
  const SELECTED = 'hm-glass-select-selected';
  let active = null;
  let scanQueued = false;
  let idCounter = 0;

  const labelFor = (option) => option?.textContent?.trim() || option?.label || '请选择';
  const visible = (el) => {
    if (!el?.isConnected) return false;
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 12 && box.height > 12 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const selectedOption = (select) => select.selectedOptions?.[0] || select.options?.[select.selectedIndex];
  function sync(select) {
    const host = select.closest('.' + HOST);
    if (!host) return;
    const trigger = host.querySelector('.hm-glass-select-trigger');
    if (!trigger) return;
    const label = trigger.querySelector('.hm-glass-select-label');
    const nextLabel = labelFor(selectedOption(select));
    if (label && label.textContent !== nextLabel) label.textContent = nextLabel;
    trigger.disabled = select.disabled;
    if (trigger.title !== nextLabel) trigger.title = nextLabel;
  }
  function close(returnFocus = false) {
    if (!active) return;
    const {trigger, menu} = active;
    menu.remove();
    trigger.setAttribute('aria-expanded', 'false');
    active = null;
    if (returnFocus && trigger.isConnected) trigger.focus({preventScroll:true});
  }
  function positionMenu() {
    if (!active) return;
    const {trigger, menu} = active;
    if (!trigger.isConnected || !visible(trigger)) return close();
    const r = trigger.getBoundingClientRect();
    // A closed dialog or scrolled-away field must not leave a menu stranded
    // off screen; the next user click opens it from its new visible position.
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return close();
    const pad = 9;
    const w = Math.max(172, Math.min(innerWidth - pad * 2, r.width));
    const h = menu.getBoundingClientRect().height;
    const below = innerHeight - r.bottom - pad - 5;
    const above = r.top - pad - 5;
    const flip = below < Math.min(h, 180) && above > below;
    const x = Math.max(pad, Math.min(innerWidth - w - pad, r.left));
    const y = flip ? Math.max(pad, r.top - h - 6) : Math.min(innerHeight - h - pad, r.bottom + 6);
    menu.style.left = Math.round(x) + 'px';
    menu.style.top = Math.max(pad, Math.round(y)) + 'px';
    menu.style.width = Math.round(w) + 'px';
  }
  function choose(optionIndex, preserveFocus = false) {
    if (!active) return;
    const {select, trigger} = active;
    const option = select.options[optionIndex];
    if (!option || option.disabled) return;
    close(!preserveFocus);
    if (select.selectedIndex !== optionIndex) {
      select.selectedIndex = optionIndex;
      select.dispatchEvent(new Event('input', {bubbles:true}));
      select.dispatchEvent(new Event('change', {bubbles:true}));
    }
    sync(select);
    if (preserveFocus && trigger.isConnected) trigger.focus({preventScroll:true});
  }
  function open(select, trigger) {
    if (active?.trigger === trigger) return close(true);
    close();
    sync(select);
    const menu = document.createElement('div');
    const menuId = 'hm-glass-select-menu-' + (++idCounter);
    menu.className = 'hm-glass-select-popover';
    menu.id = menuId;
    menu.setAttribute('role','listbox');
    menu.setAttribute('aria-label', select.getAttribute('aria-label') || select.name || '选项');
    const chosen = select.selectedIndex;
    const rows = [];
    for (let i = 0; i < select.options.length; ++i) {
      const option = select.options[i];
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'hm-glass-select-option' + (i === chosen ? ' is-selected' : '');
      row.setAttribute('role','option');
      row.setAttribute('aria-selected',String(i === chosen));
      row.dataset.index = String(i);
      row.disabled = option.disabled;
      const txt = document.createElement('span');
      txt.textContent = labelFor(option);
      row.append(txt);
      const check = document.createElement('span');
      check.className = 'hm-glass-select-check';
      check.setAttribute('aria-hidden','true');
      check.textContent = '✓';
      row.append(check);
      row.addEventListener('click',() => choose(i));
      rows.push(row);
      menu.append(row);
    }
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'hm-glass-select-empty';
      empty.textContent = '暂无可选项';
      menu.append(empty);
    }
    trigger.setAttribute('aria-expanded','true');
    trigger.setAttribute('aria-controls',menuId);
    document.body.append(menu);
    active = {select,trigger,menu,rows};
    menu.style.maxHeight = Math.max(112,Math.min(316,innerHeight-24)) + 'px';
    positionMenu();
    const focusRow = rows[chosen]?.disabled ? rows.find(x=>!x.disabled) : rows[chosen] || rows.find(x=>!x.disabled);
    focusRow?.focus({preventScroll:true});
    focusRow?.scrollIntoView({block:'nearest'});
    menu.addEventListener('keydown',(ev)=>{
      if (!active || active.menu !== menu) return;
      const current = Math.max(0,rows.indexOf(document.activeElement));
      if (ev.key === 'Escape') {ev.preventDefault();close(true);return;}
      if (ev.key === 'Tab') {close();return;}
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        let index = current;
        for (let attempt=0;attempt<rows.length;attempt++) {
          index = (index + (ev.key==='ArrowDown'?1:-1) + rows.length) % rows.length;
          if (!rows[index].disabled) break;
        }
        rows[index]?.focus({preventScroll:true});
        rows[index]?.scrollIntoView({block:'nearest'});
        return;
      }
      if (ev.key==='Home'||ev.key==='End') {
        ev.preventDefault();
        const eligible = rows.filter(row=>!row.disabled);
        const row = ev.key==='Home' ? eligible[0] : eligible.at(-1);
        row?.focus({preventScroll:true});
        row?.scrollIntoView({block:'nearest'});
        return;
      }
      if ((ev.key==='Enter'||ev.key===' ') && document.activeElement?.dataset.index) {
        ev.preventDefault();
        choose(Number(document.activeElement.dataset.index));
      }
    });
  }
  function enhance(select) {
    if (select.dataset.hmGlassEnhanced || select.multiple || select.size > 1 || !visible(select)) return;
    const parent = select.parentElement;
    if (!parent) return;
    const r = select.getBoundingClientRect();
    const pcs = getComputedStyle(parent);
    const own = getComputedStyle(select);
    const wide = parent.tagName === 'LABEL' || (r.width > 110 && parent.clientWidth > 0 && r.width / parent.clientWidth > .83);
    const host = document.createElement('span');
    host.className = HOST;
    host.style.width = wide ? '100%' : Math.round(r.width) + 'px';
    host.style.maxWidth = '100%';
    host.style.flex = own.flex;
    if (pcs.display.includes('flex') && own.alignSelf !== 'auto') host.style.alignSelf = own.alignSelf;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'hm-glass-select-trigger';
    trigger.setAttribute('aria-haspopup','listbox');
    trigger.setAttribute('aria-expanded','false');
    trigger.setAttribute('aria-label', select.getAttribute('aria-label') || select.id || '选择选项');
    const text = document.createElement('span');
    text.className = 'hm-glass-select-label';
    const chevron = document.createElement('span');
    chevron.className = 'hm-glass-select-chevron';
    chevron.setAttribute('aria-hidden','true');
    chevron.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="m5 7 5 5 5-5"/></svg>';
    trigger.append(text, chevron);
    parent.insertBefore(host,select);
    host.append(select,trigger);
    select.dataset.hmGlassEnhanced = '1';
    select.tabIndex = -1;
    trigger.addEventListener('click', () => select.disabled ? null : open(select,trigger));
    trigger.addEventListener('keydown',(ev)=>{
      if (ev.key==='ArrowDown' || ev.key==='ArrowUp' || ev.key==='Enter' || ev.key===' ') {
        ev.preventDefault();
        if (!select.disabled) open(select,trigger);
      }
    });
    select.addEventListener('change',()=>sync(select));
    sync(select);
  }
  function scan() {
    scanQueued = false;
    if (!document.documentElement.classList.contains('glass-landing')) return;
    for (const select of document.querySelectorAll('select')) {
      if (select.dataset.hmGlassEnhanced) sync(select);
      else enhance(select);
    }
  }
  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(scan);
  }
  document.addEventListener('pointerdown',e=>{
    if (!active) return;
    if (active.menu.contains(e.target) || active.trigger.contains(e.target)) return;
    close();
  },true);
  document.addEventListener('click',scheduleScan,false);
  document.addEventListener('focusin',e=>{
    if (e.target instanceof HTMLSelectElement && !e.target.dataset.hmGlassEnhanced) scheduleScan();
  },true);
  window.addEventListener('resize',positionMenu,{passive:true});
  window.addEventListener('scroll',positionMenu,{capture:true,passive:true});
  const observer = new MutationObserver(mutations=>{
    if (active && !active.trigger.isConnected) close();
    if (mutations.some(m=>m.addedNodes.length || m.removedNodes.length)) scheduleScan();
  });
  function init() {
    scan();
    observer.observe(document.body,{subtree:true,childList:true});
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();

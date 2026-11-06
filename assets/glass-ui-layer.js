/* Hamoki Studio: site-owned confirmations and image context menus.
   The browser's native confirm() UI cannot be themed, so callers await this. */
(() => {
  'use strict';
  let activeDialog = null;
  let activeMenu = null;
  const mk = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = String(text);
    return e;
  };

  function closeMenu(restoreFocus = false) {
    if (!activeMenu) return;
    const {root,previous} = activeMenu;
    activeMenu = null;
    root.remove();
    if (restoreFocus && previous?.isConnected) previous.focus?.({preventScroll:true});
  }
  const menuIcons={
    download:'M12 3v12m-5-5 5 5 5-5M4 17v3h16v-3',
    trash:'M4.5 7h15M9 7V4.5h6V7M7 7l.8 13h8.4L17 7M10 10v7m4-7v7',
    fit:'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M8 8h8v8H8z',
    zoomout:'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM16 16l5 5M7.5 10.5h6'
  };
  function showMenu({x = 0,y = 0,items = [],ariaLabel='画布操作'} = {}) {
    closeMenu();
    if (!Array.isArray(items) || !items.length) return;
    const root = mk('div','hm-context-menu');
    root.setAttribute('role','menu');
    root.setAttribute('aria-label',ariaLabel);
    root.tabIndex = -1;
    const previous = document.activeElement;
    const buttons = [];
    for (const item of items) {
      const button = mk('button','hm-context-item'+(item.danger?' is-danger':''));
      button.type='button';
      button.setAttribute('role','menuitem');
      button.disabled=!!item.disabled;
      if(menuIcons[item.icon]){
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');
        svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');
        svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
        svg.setAttribute('aria-hidden','true');
        const path=document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d',menuIcons[item.icon]);svg.append(path);button.append(svg);
      }
      button.append(mk('span','hm-context-label',item.label));
      button.addEventListener('click',ev=>{
        ev.preventDefault();ev.stopPropagation();
        closeMenu();
        try {Promise.resolve(item.onClick?.()).catch(error=>console.error('图片菜单操作失败',error));}
        catch(error){console.error('图片菜单操作失败',error);}
      });
      root.append(button);
      buttons.push(button);
    }
    document.body.append(root);
    const rect=root.getBoundingClientRect();
    root.style.left=Math.max(8,Math.min(innerWidth-rect.width-8,x))+'px';
    root.style.top=Math.max(8,Math.min(innerHeight-rect.height-8,y))+'px';
    activeMenu={root,previous};
    const enabled=buttons.find(x=>!x.disabled);
    enabled?.focus({preventScroll:true});
  }
  document.addEventListener('pointerdown',ev=>{
    if(activeMenu && !activeMenu.root.contains(ev.target)) closeMenu();
  },true);
  document.addEventListener('keydown',ev=>{
    if(!activeMenu || !activeMenu.root.contains(document.activeElement)) return;
    if(ev.key==='Escape'){ev.preventDefault();closeMenu(true);return;}
    if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){
      ev.preventDefault();
      const items=[...activeMenu.root.querySelectorAll('button:not(:disabled)')];
      if(!items.length)return;
      let index=items.indexOf(document.activeElement);
      index=(index+(ev.key==='ArrowDown'?1:-1)+items.length)%items.length;
      items[index].focus({preventScroll:true});
    }
  });
  window.addEventListener('scroll',()=>closeMenu(),true);
  window.addEventListener('resize',()=>closeMenu(),{passive:true});
  window.addEventListener('blur',()=>closeMenu());

  function ask(message,{title='确认操作',confirmLabel='确定',cancelLabel='取消',danger=false,alert=false}={}) {
    closeMenu();
    return new Promise(resolve=>{
      if(activeDialog) activeDialog(false);
      const dialog=mk('dialog','hm-glass-dialog');
      dialog.setAttribute('aria-label',title);
      const head=mk('div','hm-glass-dialog-head');
      const label=mk('h2','hm-glass-dialog-title',title);
      const content=mk('p','hm-glass-dialog-copy',String(message ?? ''));
      const foot=mk('div','hm-glass-dialog-actions');
      const cancel=mk('button','hm-dialog-cancel',cancelLabel);
      const okay=mk('button','hm-dialog-confirm'+(danger?' is-danger':''),confirmLabel);
      cancel.type=okay.type='button';
      head.append(label);
      foot.append(...(alert?[]:[cancel]),okay);
      dialog.append(head,content,foot);
      document.body.append(dialog);
      let settled=false;
      const finish=value=>{
        if(settled)return;
        settled=true;
        if(activeDialog===finish)activeDialog=null;
        if(dialog.open)dialog.close();
        dialog.remove();
        resolve(!!value);
      };
      activeDialog=finish;
      okay.addEventListener('click',()=>finish(true));
      cancel.addEventListener('click',()=>finish(false));
      dialog.addEventListener('cancel',ev=>{ev.preventDefault();finish(false);});
      dialog.addEventListener('close',()=>finish(false));
      dialog.addEventListener('click',ev=>{if(ev.target===dialog)finish(false);});
      try{
        dialog.showModal();
        (alert?okay:cancel).focus({preventScroll:true});
      }catch(error){
        console.error('站内确认框打开失败',error);
        finish(false);
      }
    });
  }
  window.HamokiGlassUI=Object.freeze({
    confirm:(message,options)=>ask(message,options),
    alert:(message,options)=>ask(message,{title:'提示',confirmLabel:'知道了',...options,alert:true}),
    menu:showMenu,
    closeMenu
  });
})();

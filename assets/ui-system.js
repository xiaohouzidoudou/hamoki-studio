/* Hamoki Studio accessibility / overlay coordination.
   Enhances the existing UI without replacing its application event handlers. */
(()=>{
 'use strict';
 const overlays=[...document.querySelectorAll('.modal-back')];
 if(!overlays.length)return;
 const selectors='button:not(:disabled):not([hidden]),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
 const previous=new WeakMap(),wasOpen=new WeakMap();
 const visible=el=>el.getClientRects().length>0&&!el.closest('.hidden,[inert]');
 const top=()=>overlays.filter(x=>!x.classList.contains('hidden')).at(-1);
 const focusables=m=>[...m.querySelectorAll(selectors)].filter(visible);
 for(const overlay of overlays){
  const modal=overlay.querySelector('.modal');
  if(!modal)continue;
  modal.setAttribute('role','dialog');
  modal.setAttribute('aria-modal','true');
  if(!modal.hasAttribute('aria-label')&&!modal.hasAttribute('aria-labelledby')){
   const heading=modal.querySelector('h2,h3');
   if(heading){if(!heading.id)heading.id='ui-dialog-title-'+overlay.id;modal.setAttribute('aria-labelledby',heading.id)}
   else modal.setAttribute('aria-label','操作对话框');
  }
  if(!modal.hasAttribute('tabindex'))modal.tabIndex=-1;
  wasOpen.set(overlay,!overlay.classList.contains('hidden'));
  new MutationObserver(()=>{
   const now=!overlay.classList.contains('hidden');
   if(wasOpen.get(overlay)===now)return;
   wasOpen.set(overlay,now);
   if(now){
    previous.set(overlay,document.activeElement);
    requestAnimationFrame(()=>{
     if(top()!==overlay)return;
     const list=focusables(overlay);
     (list[0]||modal).focus({preventScroll:true});
    });
   }else{
    requestAnimationFrame(()=>{
     const prior=previous.get(overlay);
     const remaining=top();
     if(prior?.isConnected&&(!remaining||remaining.contains(prior))&&typeof prior.focus==='function')prior.focus({preventScroll:true});
     else if(remaining) (focusables(remaining)[0]||remaining.querySelector('.modal'))?.focus({preventScroll:true});
    });
   }
  }).observe(overlay,{attributes:true,attributeFilter:['class']});
 }
 document.addEventListener('keydown',e=>{
  const overlay=top();
  if(!overlay)return;
  if(e.key==='Escape'){
   if(overlay.id==='loginModal'){e.preventDefault();e.stopImmediatePropagation();return}
   e.preventDefault();e.stopImmediatePropagation();
   const close=overlay.querySelector('[data-close],#localClose');
   if(close)close.click();
   else overlay.classList.add('hidden');
   return;
  }
  if(e.key==='Tab'){
   const items=focusables(overlay);
   if(!items.length){e.preventDefault();overlay.querySelector('.modal')?.focus();return}
   const first=items[0],last=items.at(-1);
   if(e.shiftKey&&(document.activeElement===first||!overlay.contains(document.activeElement))){e.preventDefault();last.focus()}
   else if(!e.shiftKey&&(document.activeElement===last||!overlay.contains(document.activeElement))){e.preventDefault();first.focus()}
  }
  // Prevent canvas shortcuts (V/H/N/Delete) from firing behind a dialog.
  e.stopPropagation();
 },true);
})();

(() => {
  if (document.getElementById('hamoki-account-entry')) return;
  const style=document.createElement('style');
  style.textContent=`
    #hamoki-account-entry{position:fixed;left:17px;bottom:18px;z-index:2147481000;display:grid;place-items:center;width:40px;height:40px;border:1px solid rgba(175,231,208,.28);border-radius:12px;background:rgba(25,49,46,.77);color:#b9e5d3;cursor:pointer;box-shadow:0 6px 24px #0005;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);transition:background .2s,transform .2s,border-color .2s}
    #hamoki-account-entry:hover{background:rgba(50,92,77,.9);border-color:rgba(138,232,187,.57)}
    #hamoki-account-entry:active{transform:scale(.97)}
    #hamoki-account-layer[hidden]{display:none!important}
    #hamoki-account-layer{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:22px;background:rgba(3,12,13,.65);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
    #hamoki-account-dialog{display:flex;flex-direction:column;width:min(770px,100%);height:min(740px,calc(100dvh - 44px));min-height:250px;border:1px solid rgba(170,230,205,.25);border-radius:20px;background:#0c1e20;box-shadow:0 28px 100px #000a;overflow:hidden}
    #hamoki-account-dialog-header{height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 15px 0 22px;border-bottom:1px solid rgba(200,240,218,.1);color:#dbf2e8;font:600 14px system-ui}
    #hamoki-account-close{width:32px;height:32px;display:grid;place-items:center;background:transparent;border:1px solid rgba(200,240,218,.13);border-radius:9px;color:#c0d8ce;cursor:pointer;font-size:23px}
    #hamoki-account-close:hover{background:rgba(255,255,255,.1)}
    #hamoki-account-frame{border:0;width:100%;min-height:0;flex:1;background:#0c1e20}
    @media(max-width:500px){#hamoki-account-entry{left:12px;bottom:12px}#hamoki-account-layer{padding:9px}#hamoki-account-dialog{height:calc(100dvh - 18px);border-radius:15px}}
    @media(prefers-reduced-motion:reduce){#hamoki-account-entry{transition:none}}
  `;
  document.head.append(style);
  const entry=document.createElement('button');
  entry.type='button';entry.id='hamoki-account-entry';entry.title='账号管理';entry.setAttribute('aria-label','账号管理');
  entry.innerHTML='<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20v-1.5c0-3 3-5.2 7.5-5.2s7.5 2.2 7.5 5.2V20"/></svg>';
  const layer=document.createElement('div');layer.id='hamoki-account-layer';layer.hidden=true;
  layer.setAttribute('role','presentation');
  const dialog=document.createElement('section');dialog.id='hamoki-account-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','账号管理');
  const header=document.createElement('div');header.id='hamoki-account-dialog-header';
  const name=document.createElement('span');name.textContent='账号管理';
  const close=document.createElement('button');close.id='hamoki-account-close';close.type='button';close.setAttribute('aria-label','关闭账号管理');close.textContent='×';
  header.append(name,close);
  const frame=document.createElement('iframe');frame.id='hamoki-account-frame';frame.title='账号与管理';frame.referrerPolicy='same-origin';
  dialog.append(header,frame);layer.append(dialog);document.body.append(entry,layer);
  let previousFocus=null;
  function shut(){layer.hidden=true;document.body.style.removeProperty('overflow');frame.removeAttribute('src');(previousFocus||entry).focus();}
  function open(){previousFocus=document.activeElement;frame.src='/account?embed=1';layer.hidden=false;document.body.style.overflow='hidden';close.focus();}
  entry.addEventListener('click',open);close.addEventListener('click',shut);
  layer.addEventListener('click',e=>{if(e.target===layer)shut()});
  document.addEventListener('keydown',e=>{if(layer.hidden)return;if(e.key==='Escape'){e.preventDefault();shut()}else if(e.key==='Tab'&&document.activeElement===close&&!e.shiftKey){e.preventDefault();frame.focus()}});
})();
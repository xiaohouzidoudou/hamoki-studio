(() => {
  'use strict';
  if (document.getElementById('hamoki-account-entry')) return;

  const sidebar=document.getElementById('sidebar');
  const nav=sidebar?.querySelector('.sidebar-nav');
  if (!nav) return;

  const style=document.createElement('style');
  style.textContent=[
    '.sidebar .sidebar-nav{flex-grow:1!important;}',
    '#hamoki-account-entry{margin-top:auto!important;margin-bottom:12px;min-height:45px;height:45px;flex-shrink:0;color:#b2d6c6!important;font-size:14px;}',
    '#hamoki-account-entry svg{width:23px;height:23px;flex:none;}',
    '.sidebar:not(.expanded) #hamoki-account-entry{width:52px;height:52px;margin-left:auto;margin-right:auto;padding:0;justify-content:center;}',
    '.sidebar:not(.expanded) #hamoki-account-entry span{display:none;}',
    '.sidebar.expanded #hamoki-account-entry{width:100%;padding-left:17px;gap:14px;justify-content:flex-start;}',
    '.sidebar.expanded #hamoki-account-entry span{display:inline;}',
    '#hamoki-account-layer[hidden]{display:none!important;}',
    '#hamoki-account-layer{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(3,14,17,.7);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);}',
    '#hamoki-account-dialog{display:flex;flex-direction:column;box-sizing:border-box;width:min(650px,100%);max-height:min(740px,calc(100dvh - 40px));border:1px solid rgba(154,224,199,.24);border-radius:19px;background:linear-gradient(145deg,rgba(28,58,56,.97),rgba(12,30,33,.985) 60%);box-shadow:0 28px 100px #000a, inset 0 1px 0 #ffffff13;overflow:hidden;color:#dfefe8;font:13px system-ui,"Microsoft YaHei",sans-serif;animation:hm-account-show .24s cubic-bezier(.22,1,.36,1) both;}',
    '@keyframes hm-account-show{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}',
    '#hamoki-account-head{display:flex;align-items:center;justify-content:space-between;flex-shrink:0;height:52px;padding:0 16px 0 23px;border-bottom:1px solid #b0e5d91b;font-weight:650;font-size:15px;}',
    '#hamoki-account-close{display:grid;place-items:center;width:32px;height:32px;border:1px solid #ffffff20;border-radius:9px;background:#ffffff0b;color:#d7e7e2;cursor:pointer;font-size:22px;line-height:1;}',
    '#hamoki-account-close:hover{background:#ffffff1a;}',
    '#hamoki-account-content{padding:17px 20px 24px;overflow-y:auto;min-height:0;scrollbar-width:thin;}',
    '#hamoki-account-content section{margin:0 0 14px;padding:17px 18px;border:1px solid #b9e7d21d;border-radius:14px;background:#ffffff08;}',
    '#hamoki-account-content h3{font-size:14px;font-weight:650;margin:0 0 13px;color:#e7f7ec;}',
    '#hamoki-account-content .hm-account-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #ffffff10;}',
    '#hamoki-account-content .hm-account-row:last-child{border-bottom:0;padding-bottom:1px;}',
    '#hamoki-account-content .hm-account-row strong{font-weight:550;overflow-wrap:anywhere;}',
    '#hamoki-account-content .hm-account-muted{color:#92b0a5;font-size:12px;line-height:1.6;}',
    '#hamoki-account-content .hm-account-stack{display:flex;min-width:0;flex-direction:column;gap:5px;}',
    '#hamoki-account-content .hm-account-status{min-height:17px;color:#e8a9a6;white-space:pre-wrap;margin:0 0 10px;}',
    '#hamoki-account-content button{font:inherit;flex-shrink:0;cursor:pointer;color:#d6f5e6;border:1px solid #70bba13e;border-radius:9px;padding:7px 11px;background:rgba(81,170,119,.2);transition:background .2s,transform .15s;}',
    '#hamoki-account-content button:hover{background:rgba(86,174,125,.32);}',
    '#hamoki-account-content button:active{transform:scale(.985);}',
    '#hamoki-account-content button:disabled{opacity:.5;cursor:wait;}',
    '#hamoki-account-content button.hm-account-secondary{background:#ffffff08;border-color:#ffffff25;color:#bfdbce;}',
    '#hamoki-account-content .hm-account-admin[hidden]{display:none!important;}',
    '@media(max-width:720px){.sidebar .sidebar-nav{flex:1 0 auto!important;}#hamoki-account-entry{margin:0 0 0 auto!important;height:44px!important;width:auto!important;min-width:44px;padding:0 9px!important;gap:6px!important;justify-content:center!important;}.sidebar #hamoki-account-entry span{display:inline!important;font-size:12px;}.sidebar:not(.expanded) #hamoki-account-entry{margin-left:auto!important;} }',
    '@media(max-width:480px){#hamoki-account-layer{padding:8px;}#hamoki-account-dialog{max-height:calc(100dvh - 16px);border-radius:14px;}#hamoki-account-content{padding:14px 11px 18px;}#hamoki-account-content section{padding:13px 12px;}#hamoki-account-content .hm-account-row{align-items:flex-start;} }',
    '@media(prefers-reduced-motion:reduce){#hamoki-account-dialog{animation:none!important;}#hamoki-account-content button{transition:none!important;}}'
  ].join('\n');
  document.head.append(style);

  const entry=document.createElement('button');
  entry.type='button';entry.className='nav-icon-btn';
  entry.id='hamoki-account-entry';entry.title='账号管理';entry.setAttribute('aria-label','账号管理');
  entry.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20v-1.5c0-3 3-5.2 7.5-5.2s7.5 2.2 7.5 5.2V20"/></svg><span>账号管理</span>';
  nav.appendChild(entry);

  const layer=document.createElement('div');
  layer.id='hamoki-account-layer';layer.hidden=true;
  const dialog=document.createElement('section');
  dialog.id='hamoki-account-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','账号管理');
  const head=document.createElement('header');head.id='hamoki-account-head';
  const title=document.createElement('strong');title.textContent='账号管理';
  const close=document.createElement('button');close.id='hamoki-account-close';close.type='button';close.setAttribute('aria-label','关闭账号管理');close.textContent='×';
  head.append(title,close);
  const content=document.createElement('main');content.id='hamoki-account-content';
  dialog.append(head,content);layer.append(dialog);document.body.append(layer);

  let focusBefore=null,scrollBefore='',loadVersion=0;
  const button=(text,secondary=false)=>{
    const el=document.createElement('button');el.type='button';el.textContent=text;
    if(secondary)el.className='hm-account-secondary';return el;
  };
  const element=(tag,cls,value)=>{
    const el=document.createElement(tag);if(cls)el.className=cls;
    if(value!==undefined)el.textContent=String(value);return el;
  };
  const row=(left,right)=>{
    const el=element('div','hm-account-row');el.append(left);
    if(right)el.append(right);return el;
  };
  const stack=(label,text)=>{
    const wrap=element('div','hm-account-stack');
    wrap.append(element('span','hm-account-muted',label),element('strong','',text));
    return wrap;
  };
  async function api(url,method='GET',body){
    const res=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:{'X-Studio-Request':'1','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'请求失败（'+res.status+'）');
    return data;
  }
  async function loadUsers(list,notice,version){
    try{
      const {users}=await api('/api/admin/users');
      if(layer.hidden||version!==loadVersion)return;
      list.replaceChildren();
      for(const user of users||[]){
        const amount=Number(user.quota?.usedBytes||0)/1048576;
        const info=stack(user.username+(user.role==='admin'?' · 管理员':''), (user.status==='active'?'正常':'已禁用')+' · '+amount.toFixed(1)+' MiB');
        if(user.role==='admin'){list.append(row(info));continue;}
        const change=button(user.status==='active'?'禁用':'恢复',true);
        change.addEventListener('click',async()=>{
          if(user.status==='active'&&!window.confirm('确认禁用 '+user.username+' 的 Studio 访问？'))return;
          change.disabled=true;notice.textContent='';
          try{
            await api('/api/admin/users/'+encodeURIComponent(user.id)+'/disable','POST',{disabled:user.status==='active'});
            await loadUsers(list,notice,version);
          }catch(error){notice.textContent=error.message;change.disabled=false;}
        });
        list.append(row(info,change));
      }
    }catch(error){notice.textContent='读取用户列表失败：'+error.message;}
  }
  async function render(version){
    content.replaceChildren();
    const notice=element('p','hm-account-status');notice.setAttribute('role','alert');
    const account=element('section');
    account.append(element('h3','','当前账号'));
    const who=stack('账号','读取中…');
    const logout=button('退出登录',true);logout.disabled=true;
    account.append(row(who,logout));
    const quota=stack('个人空间','读取中…');
    account.append(row(quota));
    const sub2=element('section');
    sub2.append(element('h3','','Sub2 生图账号'));
    const balance=stack('账号余额','读取中…');
    const refresh=button('刷新余额',true);refresh.disabled=true;
    sub2.append(row(balance,refresh));
    sub2.append(element('p','hm-account-muted','使用当前 Sub2 登录账号；API Key 仅保存在服务器的个人空间。'));
    const admin=element('section','hm-account-admin');admin.hidden=true;
    admin.append(element('h3','','用户管理'));
    admin.append(element('p','hm-account-muted','仅管理员可见。可以禁用或恢复用户在 Studio 的访问。'));
    const list=element('div');admin.append(list);
    content.append(notice,account,sub2,admin);

    try{
      const me=await api('/api/account/me');
      if(layer.hidden||version!==loadVersion)return;
      who.querySelector('strong').textContent=me.user?.username||'未知用户';
      who.querySelector('.hm-account-muted').textContent=me.user?.role==='admin'?'管理员账号':'当前登录账号';
      quota.querySelector('strong').textContent=(Number(me.quota?.usedBytes||0)/1048576).toFixed(1)+' MiB / 1024 MiB';
      logout.disabled=false;refresh.disabled=false;
      logout.addEventListener('click',async()=>{
        logout.disabled=true;
        try{await api('/api/auth/logout','POST');window.location.assign('/login');}
        catch(error){notice.textContent=error.message;logout.disabled=false;}
      });
      async function readBalance(){
        refresh.disabled=true;balance.querySelector('strong').textContent='读取中…';
        try{const info=await api('/api/account/sub2/balance');if(layer.hidden||version!==loadVersion)return;
          balance.querySelector('strong').textContent=info.balance==null?'余额暂不可用':'$'+info.balance+' USD';
        }catch(error){if(version===loadVersion&&!layer.hidden)balance.querySelector('strong').textContent='读取失败：'+error.message;}
        finally{refresh.disabled=false;}
      }
      refresh.addEventListener('click',readBalance);
      void readBalance();
      if(me.user?.role==='admin'){admin.hidden=false;void loadUsers(list,notice,version);}
    }catch(error){
      if(layer.hidden||version!==loadVersion)return;
      notice.textContent='无法读取账号信息：'+error.message;
      const login=button('重新登录');login.addEventListener('click',()=>window.location.assign('/login'));
      account.append(login);
    }
  }
  function shut(){
    if(layer.hidden)return;
    layer.hidden=true;loadVersion++;
    document.body.style.overflow=scrollBefore;
    content.replaceChildren();
    (focusBefore?.isConnected?focusBefore:entry).focus({preventScroll:true});
  }
  function open(){
    if(!layer.hidden)return;
    focusBefore=document.activeElement;scrollBefore=document.body.style.overflow;
    layer.hidden=false;document.body.style.overflow='hidden';close.focus();
    void render(++loadVersion);
  }
  entry.addEventListener('click',open);
  close.addEventListener('click',shut);
  layer.addEventListener('pointerdown',event=>{if(event.target===layer)shut();});
  document.addEventListener('keydown',event=>{
    if(layer.hidden)return;
    if(event.key==='Escape'){event.preventDefault();shut();return;}
    if(event.key!=='Tab')return;
    const possible=[...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled)')].filter(el=>el.getClientRects().length);
    const first=possible[0],last=possible[possible.length-1];
    if(!first)return;
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
})();

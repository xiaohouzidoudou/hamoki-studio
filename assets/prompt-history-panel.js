/* Hamoki Studio prompt history drawer. User prompts only, no external requests. */
(() => {
  'use strict';
  let drawer=null,trigger=null,opened=false,inputTimer=0,currentPanel=null;
  const icon={
    copy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
    close:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m5 5 14 14M19 5 5 19"/></svg>'
  };
  const make=(tag,cls,text)=>{
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(text!==undefined)el.textContent=String(text);
    return el;
  };
  function projectId(){return window.HamokiCanvas?.getProjectId?.()||'all';}
  function storageKey(){return 'hamoki-prompt-drafts-v1:'+projectId();}
  function drafts(){
    try{const parsed=JSON.parse(localStorage.getItem(storageKey())||'[]');
      return Array.isArray(parsed)?parsed.filter(x=>x&&typeof x.text==='string').slice(0,100):[];
    }catch{return [];}
  }
  function remember(text){
    text=String(text||'').trim();if(text.length<5)return;
    try{
      const old=drafts().filter(x=>x.text!==text);
      localStorage.setItem(storageKey(),JSON.stringify([{text,time:new Date().toISOString(),source:'输入记录'},...old].slice(0,65)));
    }catch{}
  }
  function onPromptInput(e){
    if(e.target.id!=='prompt-input')return;
    clearTimeout(inputTimer);
    inputTimer=setTimeout(()=>remember(e.target.value),1200);
  }
  function position(){
    if(!drawer||!currentPanel)return;
    const rect=currentPanel.getBoundingClientRect();
    if(rect.width<120)return;
    const width=Math.min(328,Math.max(238,rect.width*.87));
    let left=rect.left-width-12,top=rect.top+8;
    if(left<10)left=Math.max(10,Math.min(innerWidth-width-10,rect.left-12));
    Object.assign(drawer.style,{left:Math.round(left)+'px',top:Math.max(10,Math.round(top))+'px',
      width:Math.round(width)+'px',height:Math.min(Math.max(260,rect.height-16),innerHeight-top-10)+'px'});
  }
  function close(){
    opened=false;trigger?.setAttribute('aria-expanded','false');
    drawer?.classList.remove('open');drawer?.setAttribute('aria-hidden','true');
    setTimeout(()=>{if(!opened)drawer?.remove();},280);
  }
  function normalize(text){
    return String(text||'').trim().replace(/\r\n/g,'\n').slice(0,1000);
  }
  async function loadEntries(){
    const id=projectId(),list=[];
    let response=[];
    try{
      const recent=await fetch('/api/history'+(id!=='all'?'?projectId='+encodeURIComponent(id):''),{credentials:'same-origin'});
      if(recent.ok)response=(await recent.json()).history||[];
    }catch{}
    for(const h of response){
      const text=normalize(h.editInstruction||h.prompt);
      if(text)list.push({text,time:h.createdAt||'',source:'已生成作品',sort:Date.parse(h.createdAt)||0});
    }
    try{
      if(id!=='all'){
        const response=await fetch('/api/projects/'+encodeURIComponent(id),{credentials:'same-origin'});
        if(response.ok){
          const info=(await response.json()).project;
          for(const m of info?.messages||[]){
            if(m.role!=='user')continue;
            const text=normalize(m.content);
            if(text)list.push({text,time:m.createdAt||'',source:'提交记录',sort:Date.parse(m.createdAt)||0});
          }
        }
      }
    }catch{}
    for(const item of drafts())list.push({text:normalize(item.text),time:item.time,source:'手动输入',sort:Date.parse(item.time)||0});
    list.sort((a,b)=>b.sort-a.sort);
    const used=new Set();
    return list.filter(e=>{if(!e.text||used.has(e.text))return false;used.add(e.text);return true}).slice(0,120);
  }
  function apply(text){
    const input=document.getElementById('prompt-input');
    if(!input)return;
    const value=String(text||'').slice(0,input.maxLength||1000);
    input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
    void navigator.clipboard?.writeText?.(text).catch(()=>{});
    input.focus({preventScroll:true});
    if(value.length<text.length)window.HamokiCanvas?.toast?.('已填入前1000字符，剩余内容仍可从历史复制');
    remember(value);close();
  }
  async function draw(){
    if(!drawer)return;
    const content=drawer.querySelector('.hm-prompt-history-list');
    content.replaceChildren(make('p','hm-history-loading','正在读取历史记录…'));
    const entries=await loadEntries();
    if(!opened||!content.isConnected)return;
    content.replaceChildren();
    if(!entries.length){
      content.append(make('p','hm-history-empty','还没有提示词记录。你输入或生成的提示词会自动出现在这里。'));
      return;
    }
    for(const item of entries){
      const row=make('article','hm-history-item');
      const meta=make('div','hm-history-meta');
      meta.append(make('span','hm-history-source',item.source));
      if(item.time){
        const time=Date.parse(item.time);
        if(Number.isFinite(time))meta.append(make('time','hm-history-time',new Date(time).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})));
      }
      const body=make('p','hm-history-copy-text',item.text);
      body.title=item.text;
      const copy=make('button','hm-history-copy-button');
      copy.type='button';copy.title='复制并填入提示词框';
      copy.setAttribute('aria-label','复制并填入提示词框');
      copy.innerHTML=icon.copy;
      copy.onclick=()=>apply(item.text);
      row.append(meta,body,copy);content.append(row);
    }
  }
  function open(){
    if(opened){close();return;}
    opened=true;trigger?.setAttribute('aria-expanded','true');
    drawer=make('section','hm-prompt-history open');
    drawer.id='hamoki-prompt-history';drawer.setAttribute('aria-label','提示词历史');
    drawer.setAttribute('aria-hidden','false');
    const head=make('header','hm-history-head');
    head.append(make('strong','', '提示词历史'));
    const shut=make('button','hm-history-close');shut.type='button';shut.title='关闭历史';
    shut.setAttribute('aria-label','关闭历史');shut.innerHTML=icon.close;shut.onclick=close;
    head.append(shut);
    drawer.append(head,make('div','hm-prompt-history-list'));
    document.body.append(drawer);position();void draw();
  }
  function mount(panel){
    if(opened)close();
    currentPanel=panel;
    trigger=panel?.querySelector('#prompt-history-trigger');
    trigger?.addEventListener('click',open);
  }
  document.addEventListener('input',onPromptInput,true);
  document.addEventListener('focusout',e=>{
    if(e.target?.id==='prompt-input'){clearTimeout(inputTimer);remember(e.target.value);}
  },true);
  document.addEventListener('pointerdown',e=>{
    if(opened&&!drawer?.contains(e.target)&&!trigger?.contains(e.target))close();
  },true);
  document.addEventListener('keydown',e=>{if(opened&&e.key==='Escape')close();},true);
  window.addEventListener('resize',position,{passive:true});
  window.HamokiPromptHistory={mount,remember,close};
})();

/* Hamoki Studio canvas rich-text notes.
   Uses existing project note storage (max 1600 chars); all displayed HTML
   is rebuilt from a strict allow-list. No model calls or external dependencies. */
(() => {
  'use strict';
  const PREFIX='HAMOKI_RICH_TEXT_V1:';
  const SOURCE_ID=/^[a-f0-9-]{36}$/i;
  const SOURCE_MARKER=/^\{\{reverse_source:([a-f0-9-]{36})\}\}/i;
  const ALLOWED=new Set(['P','DIV','B','STRONG','I','EM','H1','H2','H3','UL','OL','LI','BR','HR']);
  const entries=new Map();
  let layer=null,toolbar=null,selected=null,frame=0,moveTimer=0;
  const make=(tag,cls,txt)=>{
    const element=document.createElement(tag);
    if(cls)element.className=cls;
    if(txt!==undefined)element.textContent=txt;
    return element;
  };
  const isRich=value=>String(value||'').startsWith(PREFIX);
  const sourceId=value=>{
    if(!isRich(value))return null;
    return String(value).slice(PREFIX.length).match(SOURCE_MARKER)?.[1]||null;
  };
  const htmlOf=value=>String(value||'').slice(PREFIX.length).replace(SOURCE_MARKER,'');
  function sanitize(html){
    const parsed=new DOMParser().parseFromString('<body>'+String(html||'')+'</body>','text/html');
    const root=make('div');
    function safeCopy(parent,child){
      if(child.nodeType===Node.TEXT_NODE){
        parent.append(document.createTextNode(child.textContent||''));return;
      }
      if(child.nodeType!==Node.ELEMENT_NODE)return;
      const tag=child.tagName.toUpperCase();
      const target=ALLOWED.has(tag)?document.createElement(tag.toLowerCase()):parent;
      if(target!==parent)parent.append(target);
      if(tag==='BR'||tag==='HR')return;
      for(const item of [...child.childNodes])safeCopy(target,item);
    }
    for(const child of [...parsed.body.childNodes])safeCopy(root,child);
    return root.innerHTML;
  }
  function pack(html,source=null){
    const marker=SOURCE_ID.test(String(source||''))?'{{reverse_source:'+source+'}}':'';
    const value=PREFIX+marker+sanitize(html);
    return value.length<=1600?value:null;
  }
  function fromPlain(raw,source=null){
    const wrap=make('p');
    wrap.textContent=String(raw||'').trim().slice(0,1350)||'输入或粘贴反推提示词…';
    return pack(wrap.outerHTML,source);
  }
  function ensureLayer(){
    if(layer)return layer;
    layer=make('div','hamoki-richnote-float-layer');
    layer.setAttribute('aria-label','画布富文本操作栏');
    document.body.append(layer);
    toolbar=make('div','hamoki-richnote-toolbar');
    toolbar.setAttribute('role','toolbar');
    toolbar.setAttribute('aria-label','反推提示词格式工具栏');
    layer.append(toolbar);
    const tools=[
      ['clear','⊘','清除格式'],['separator'],['h1','H1','标题一'],['h2','H2','标题二'],
      ['h3','H3','标题三'],['p','¶','段落'],['separator'],
      ['bold','B','加粗'],['italic','I','斜体'],['separator'],
      ['ul','☷','无序列表'],['ol','1☷','有序列表'],['separator'],
      ['hr','—','插入分割线'],['separator'],
      ['copy','▢','复制文本'],['expand','⤢','展开或收起']
    ];
    for(const [action,label,title] of tools){
      if(action==='separator'){toolbar.append(make('span','hamoki-richnote-separator'));continue;}
      const b=make('button','hamoki-richnote-format hamoki-fmt-'+action,label);
      b.type='button';b.dataset.action=action;b.title=title;b.setAttribute('aria-label',title);
      const icons={
        clear:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>',
        ul:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/><path d="M9 6h12M9 12h12M9 18h12"/></svg>',
        ol:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h3v5M3 14h3v2l-3 2h3M10 6h11M10 12h11M10 18h11"/></svg>',
        copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" fill="#74D2A4" opacity=".18"/><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
        expand:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/></svg>'
      };
      if(icons[action])b.innerHTML=icons[action];
      b.addEventListener('pointerdown',e=>e.preventDefault());
      b.addEventListener('mousedown',e=>e.preventDefault());
      b.addEventListener('click',()=>run(action));
      toolbar.append(b);
    }
    const view=document.getElementById('canvas-viewport');
    view?.addEventListener('scroll',schedule,{passive:true});
    view?.addEventListener('wheel',schedule,{passive:true});
    window.addEventListener('resize',schedule,{passive:true});
    document.addEventListener('pointerdown',e=>{
      if(!selected||e.target.closest('.hamoki-richnote-toolbar'))return;
      if(e.target.closest('.canvas-viewport')&&!e.target.closest('.hamoki-richnote-editor')){
        toolbar.style.visibility='hidden';
        clearTimeout(moveTimer);
      }
    },true);
    document.addEventListener('pointerup',()=>{
      clearTimeout(moveTimer);
      moveTimer=setTimeout(schedule,120);
    },true);
    layer.hidden=true;
    return layer;
  }
  function schedule(){
    if(frame)return;
    frame=requestAnimationFrame(()=>{frame=0;position();});
  }
  function position(){
    if(!selected||!selected.card.isConnected||!layer||!toolbar){if(layer)layer.hidden=true;return;}
    const viewport=document.getElementById('canvas-viewport');
    if(!viewport){layer.hidden=true;return;}
    const v=viewport.getBoundingClientRect(),r=selected.card.getBoundingClientRect();
    layer.hidden=false;
    Object.assign(layer.style,{
      left:Math.round(v.left)+'px',top:Math.round(v.top)+'px',
      width:Math.round(v.width)+'px',height:Math.round(v.height)+'px'
    });
    const usable=toolbar.offsetWidth||530;
    toolbar.style.left=Math.round(Math.max(7,Math.min(v.width-usable-7,
      r.left-v.left+r.width/2-usable/2)))+'px';
    toolbar.style.top=Math.round(r.top-v.top-(toolbar.offsetHeight||43)-12)+'px';
    toolbar.style.visibility='visible';
  }
  function select(id){
    ensureLayer();
    if(selected&&selected.node.id!==id)selected.endEdit?.();
    selected=entries.get(id)||null;
    if(!selected){layer.hidden=true;return;}
    schedule();
  }
  function resetNodes(){
    for(const item of entries.values()){
      clearTimeout(item.timer);
      if(item.editing)item.endEdit();
      else if(item.card?.isConnected)void item.saveNow();
      item.dispose?.();
    }
    entries.clear();
    selected=null;
    if(layer)layer.hidden=true;
  }
  async function run(action){
    const item=selected;
    if(!item)return;
    const {editor,card,node,ctx}=item;
    if(action==='copy'){
      try{
        await navigator.clipboard.writeText(editor.innerText);
        ctx.toast('反推提示词已复制');
      }catch{
        const range=document.createRange();range.selectNodeContents(editor);
        const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
        const copied=document.execCommand('copy');
        selection.removeAllRanges();
        ctx.toast(copied?'反推提示词已复制':'复制失败，请手动选择文字',!copied);
      }
      return;
    }
    if(action==='expand'){
      const original=item.previousSize;
      if(original){
        card.style.width=original.w+'px';card.style.height=original.h+'px';
        item.previousSize=null;
        card.classList.remove('is-expanded');
      }else{
        item.previousSize={w:parseFloat(card.style.width)||node.w,h:parseFloat(card.style.height)||node.h};
        card.style.width=Math.min(900,Math.max(610,item.previousSize.w))+'px';
        card.style.height=Math.min(700,Math.max(460,item.previousSize.h))+'px';
        card.classList.add('is-expanded');
      }
      const w=parseFloat(card.style.width),h=parseFloat(card.style.height);
      Object.assign(node,{w,h});
      await ctx.saveGeometry({w,h}).catch(e=>ctx.toast('保存展开状态失败：'+e.message,true));
      window.HamokiViewport?.syncBounds?.();
      schedule();
      return;
    }
    if(!item.editing){
      ctx.toast('双击文本块正文后才能编辑格式');
      return;
    }
    editor.focus({preventScroll:true});
    const commands={
      clear:['removeFormat',null],h1:['formatBlock','h1'],h2:['formatBlock','h2'],
      h3:['formatBlock','h3'],p:['formatBlock','p'],bold:['bold',null],
      italic:['italic',null],ul:['insertUnorderedList',null],ol:['insertOrderedList',null],
      hr:['insertHorizontalRule',null]
    };
    const [cmd,value]=commands[action]||[];
    if(cmd){
      const result=document.execCommand(cmd,false,value);
      if(action==='clear')document.execCommand('formatBlock',false,'p');
      if(action==='hr'&&!result)document.execCommand('insertHTML',false,'<hr>');
      item.scheduleSave();
    }
  }
  function mount(card,node,ctx){
    if(!isRich(node.text))return false;
    ensureLayer();
    card.classList.add('canvas-rich-node');
    const label=make('div','hamoki-richnote-label','☰ 反推提示词');
    label.title='按住拖动文本块，双击正文进入编辑';
    const editor=make('div','hamoki-richnote-editor');
    // Noneditable by default. The canvas' pointer handler can now capture
    // a drag started anywhere on the text instead of treating it as typing.
    editor.removeAttribute('contenteditable');
    editor.spellcheck=false;
    editor.setAttribute('role','group');
    editor.setAttribute('aria-label','反推提示词：按住拖动，双击进入文字编辑');
    editor.title='拖动移动 · 双击编辑';
    editor.innerHTML=sanitize(htmlOf(node.text));
    editor.dataset.placeholder='输入或粘贴反推提示词…';
    card.append(label,editor);
    let lastSaved=node.text,saving=false,pending=false;
    const item={card,node,ctx,editor,sourceId:sourceId(node.text),timer:0,previousSize:null,editing:false,scheduleSave,saveNow,endEdit};
    function beginEdit(event){
      if(item.editing)return;
      item.editing=true;
      card.classList.add('is-editing');
      editor.contentEditable='true';
      editor.setAttribute('role','textbox');
      editor.setAttribute('aria-multiline','true');
      editor.setAttribute('aria-label','反推提示词正文，编辑后点击外部保存');
      editor.title='编辑中 · 点击外部保存';
      editor.focus({preventScroll:true});
      // A drag begins on a passive element; edit mode is entered only once
      // the browser has dispatched the explicit double-click event.
      if(event && Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)){
        const range=document.caretRangeFromPoint?.(event.clientX,event.clientY);
        if(range&&editor.contains(range.startContainer)){
          const selection=window.getSelection();
          selection?.removeAllRanges();selection?.addRange(range);
        }
      }
    }
    function endEdit(){
      if(!item.editing)return;
      item.editing=false;
      editor.removeAttribute('contenteditable');
      editor.setAttribute('role','group');
      editor.removeAttribute('aria-multiline');
      editor.setAttribute('aria-label','反推提示词：按住拖动，双击进入文字编辑');
      editor.title='拖动移动 · 双击编辑';
      card.classList.remove('is-editing');
      void saveNow();
    }
    async function saveNow(){
      clearTimeout(item.timer);
      const text=pack(editor.innerHTML,item.sourceId);
      if(!text){ctx.toast('文本或格式已超过1600字符，暂未保存。请缩短内容。',true);return;}
      if(text===lastSaved)return;
      if(saving){pending=true;return;}
      saving=true;
      try{await ctx.saveText(text);lastSaved=text;node.text=text;}
      catch(e){ctx.toast('保存反推提示词失败：'+e.message,true);}
      finally{
        saving=false;
        if(pending){pending=false;void saveNow();}
      }
    }
    function scheduleSave(){
      clearTimeout(item.timer);
      item.timer=setTimeout(()=>void saveNow(),650);
    }
    editor.addEventListener('input',scheduleSave);
    editor.addEventListener('blur',endEdit);
    editor.addEventListener('pointerdown',e=>{
      if(item.editing)e.stopPropagation();
    });
    editor.addEventListener('dblclick',e=>{
      e.preventDefault();e.stopPropagation();
      beginEdit(e);
    });
    // Browser pointer-capture can retarget a double click to the card.
    // Keep card-level fallback so double-clicking the label/body works.
    card.addEventListener('dblclick',e=>{
      if(e.target.closest('button,.canvas-selection-handle'))return;
      e.preventDefault();e.stopPropagation();
      beginEdit(e);
    });
    function exitOnOutsidePointer(e){
      if(!item.editing||editor.contains(e.target))return;
      // Toolbar controls intentionally preserve the text selection.
      if(e.target.closest('.hamoki-richnote-toolbar'))return;
      endEdit();
    }
    function exitOnEscape(e){
      if(e.key!=='Escape'||!item.editing)return;
      e.preventDefault();e.stopPropagation();
      endEdit();
      editor.blur();
    }
    document.addEventListener('pointerdown',exitOnOutsidePointer,true);
    editor.addEventListener('keydown',exitOnEscape);
    item.dispose=()=>document.removeEventListener('pointerdown',exitOnOutsidePointer,true);
    editor.addEventListener('paste',e=>{
      if(!item.editing)return;
      if(e.clipboardData?.files?.length)return;
      const text=e.clipboardData?.getData('text/plain');
      if(typeof text==='string'){
        e.preventDefault();document.execCommand('insertText',false,text);
      }
    });
    entries.set(node.id,item);
    return true;
  }
  window.HamokiRichNote={PREFIX,isRich,sourceId,sanitize,pack,fromPlain,mount,select,resetNodes,reflow:schedule};
})();
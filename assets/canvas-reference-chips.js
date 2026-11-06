/* Rich in-line canvas reference chips for text prompts.
   DOM displays image pills; backing textarea carries internal reference ids.
   No external libraries, no HTML string injection. */
'use strict';
(() => {
  const re=/\{\{canvas_ref:([A-Za-z0-9_-]{1,140})\}\}/g;
  const marker=id=>'{{canvas_ref:'+id+'}}';
  const plain=value=>String(value||'').replace(re,'').replace(/ {2,}/g,' ').trimEnd();
  const validId=id=>/^[A-Za-z0-9_-]{1,140}$/.test(String(id||''));
  const mk=(tag,cls,text)=>{
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(text!==undefined)el.textContent=String(text);
    return el;
  };
  function create(input,{targetClass='',resolve=()=>null,onChange=()=>{},onReveal=()=>{},onRemove=()=>{},keepMarkers=true}={}){
    if(!input || !input.parentNode)throw Error('找不到提示词输入区域');
    const rich=mk('div','hamoki-rich-prompt '+targetClass);
    rich.contentEditable='true';
    rich.setAttribute('role','textbox');
    rich.setAttribute('aria-multiline','true');
    rich.setAttribute('aria-label',input.getAttribute('aria-label')||'生成提示词');
    rich.dataset.placeholder=input.placeholder||'描述你的图片创作要求…';
    rich.spellcheck=false;
    input.before(rich);
    input.classList.add('hamoki-ref-backing');
    input.setAttribute('aria-hidden','true');
    input.tabIndex=-1;
    let ignoreChange=false;
    function chip(id) {
      const ref=resolve(id)||{};
      const name=String(ref.title||ref.name||'画布图片').trim();
      const root=mk('span','hamoki-ref-chip');
      root.dataset.canvasRef=id;
      root.contentEditable='false';
      root.title='引用：'+name+'（双击定位原图）';
      if(ref.url){
        const img=mk('img','hamoki-ref-chip-image');
        img.src=ref.url;img.alt='';
        img.draggable=false;
        root.append(img);
      } else root.append(mk('span','hamoki-ref-chip-icon','▧'));
      root.append(mk('span','hamoki-ref-chip-name',name));
      const remove=mk('button','hamoki-ref-chip-remove','×');
      remove.type='button';
      remove.tabIndex=-1;
      remove.setAttribute('aria-label','取消引用 '+name);
      remove.title='删除这条图片引用';
      remove.addEventListener('pointerdown',event=>event.stopPropagation());
      remove.addEventListener('click',event=>{
        event.preventDefault();event.stopPropagation();
        root.remove();
        sync();onRemove(id);
      });
      root.append(remove);
      root.addEventListener('dblclick',event=>{
        event.preventDefault();event.stopPropagation();onReveal(id);
      });
      return root;
    }
    function render(raw){
      const str=String(raw||'');
      const nodes=[];
      let end=0,match;
      re.lastIndex=0;
      while((match=re.exec(str))!==null){
        if(match.index>end)nodes.push(document.createTextNode(str.slice(end,match.index)));
        nodes.push(chip(match[1]));
        end=re.lastIndex;
      }
      if(end<str.length)nodes.push(document.createTextNode(str.slice(end)));
      rich.replaceChildren(...nodes);
      return rich;
    }
    function serialize(){
      const read=node=>{
        if(node.nodeType===Node.TEXT_NODE)return node.textContent||'';
        if(node.nodeType!==Node.ELEMENT_NODE)return '';
        if(node.dataset?.canvasRef)return marker(node.dataset.canvasRef);
        if(node.tagName==='BR')return '\n';
        const body=Array.from(node.childNodes,read).join('');
        return ['DIV','P'].includes(node.tagName) ? body+'\n' : body;
      };
      return Array.from(rich.childNodes,read).join('');
    }
    function sync(){
      const raw=serialize();
      const value=keepMarkers?raw:plain(raw);
      input.value=value;
      if(!ignoreChange){
        internalChange=true;
        try{onChange(raw,value);}finally{internalChange=false;}
      }
      return raw;
    }
    function append(ref){
      const id=String(ref?.id||'');
      if(!validId(id))return false;
      if(rich.querySelector('[data-canvas-ref="'+id+'"]')){
        rich.focus();return false;
      }
      const spacer=document.createTextNode(rich.childNodes.length?' ':'');
      const pill=chip(id);
      rich.append(spacer,pill,document.createTextNode(' '));
      const selection=window.getSelection();
      const range=document.createRange();
      range.selectNodeContents(rich);
      range.collapse(false);
      rich.focus({preventScroll:true});
      selection?.removeAllRanges();selection?.addRange(range);
      sync();
      return true;
    }
    function remove(id,{notify=true}={}){
      const found=Array.from(rich.querySelectorAll('[data-canvas-ref]')).filter(x=>x.dataset.canvasRef===id);
      if(!found.length)return false;
      for(const item of found)item.remove();
      sync();if(notify)onRemove(id);
      return true;
    }
    function ids(){return Array.from(rich.querySelectorAll('[data-canvas-ref]')).map(x=>x.dataset.canvasRef);}
    function replace(raw,{notify=false}={}){
      ignoreChange=!notify;
      render(raw);
      sync();
      ignoreChange=false;
    }
    let internalChange=false;
    input.addEventListener('input',()=>{
      if(!internalChange&&document.activeElement!==rich)render(input.value);
    });
    rich.addEventListener('input',()=>sync());
    rich.addEventListener('paste',event=>{
      if(event.clipboardData?.files?.length)return;
      const content=event.clipboardData?.getData('text/plain');
      if(content!==undefined){
        event.preventDefault();
        document.execCommand('insertText',false,content);
      }
    });
    rich.addEventListener('keydown',event=>{
      if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){
        // The parent composer handles Ctrl+Enter.
        return;
      }
    });
    render(input.value);
    return {rich,input,append,remove,ids,replace,sync,plain,focus:()=>rich.focus()};
  }
  window.HamokiRefChips={create,plain,marker,validId};
})();
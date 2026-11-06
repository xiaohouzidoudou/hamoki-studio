/* Hamoki Studio: tool-specific image input and honest illustrative previews. */
(() => {
  'use strict';
  const $ = query => document.querySelector(query);
  const BYTES_PER_IMAGE = 12 * 1024 * 1024;
  const BYTES_TOTAL = 40 * 1024 * 1024;
  const NATIVE_LIMIT = 5;
  const MIME_TYPES = new Set(['image/png','image/jpeg','image/webp']);
  const drafts = new Map();
  const replacementById = new Map();
  let tools = new Map();
  let watchGrid;
  let activeToolId = null;
  let toastTimer = 0;

  function make(tag, className, content) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (content !== undefined) n.textContent = String(content);
    return n;
  }
  function notify(message) {
    let node = $('#hgStage2Toast');
    if (!node) {
      node = make('div','hg-stage2-toast');
      node.id = 'hgStage2Toast';
      node.setAttribute('role','status');
      node.setAttribute('aria-live','polite');
      document.body.append(node);
    }
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 3200);
  }
  function incomingFiles(id) {
    if (!drafts.has(id)) drafts.set(id,[]);
    return drafts.get(id);
  }
  function nativeFiles() {
    const api = window.HamokiReferences;
    try { return Array.from(api?.files?.() || []); }
    catch { return []; }
  }
  function countLimit(t) {
    return Math.min(Math.max(Number(t?.maxImages) || 0,0),NATIVE_LIMIT);
  }
  function formatBytes(size) {
    return size < 1024*1024 ? (Math.round(size/1024)+' KB') : (size/(1024*1024)).toFixed(1)+' MB';
  }
  function previewImage(tool, large) {
    if (!/^assets\/ui-tool-[A-Za-z0-9-]+\.webp$/.test(tool?.preview || '')) return null;
    const image = document.createElement('img');
    image.src = tool.preview;
    image.alt = tool.name + '的原创游戏美术效果示意，并非模型实际生成结果';
    image.decoding = 'async';
    if (!large) image.loading = 'lazy';
    image.className = large ? 'hg-stage2-large-preview' : 'hg-stage2-card-preview';
    return image;
  }
  function hydrateCards() {
    for (const card of document.querySelectorAll('#hgGrid .hg-card')) {
      if (card.dataset.stage2Preview === '1') continue;
      const t = tools.get(card.dataset.id);
      if (!t) continue;
      const frame = card.querySelector('.hg-card-preview');
      if (!frame) continue;
      // The base catalog now loads its cover directly; do not insert a duplicate image.
      if (frame.querySelector('img.hg-stage2-card-preview')) {
        if (!frame.querySelector('.hg-stage2-preview-badge'))
          frame.append(make('span','hg-stage2-preview-badge','效果示意'));
        card.dataset.stage2Preview = '1';
        continue;
      }
      const image = previewImage(t,false);
      if (!image) continue;
      const diagram = frame.querySelector('.hg-art');
      if (diagram) diagram.hidden = true;
      image.addEventListener('error', () => {
        image.remove();
        if (diagram) diagram.hidden = false;
      },{once:true});
      frame.prepend(image);
      const badge = make('span','hg-stage2-preview-badge','效果示意');
      frame.append(badge);
      card.dataset.stage2Preview = '1';
    }
  }
  function syncUploader() {
    const t = tools.get(activeToolId);
    if (!t) return;
    const wrap = $('#hgStage2Upload');
    if (!wrap) return;
    const list = incomingFiles(t.id);
    const original = nativeFiles();
    const cap = countLimit(t);
    const nativeMode = replacementById.get(t.id) || false;
    const count = $('#hgStage2Count');
    if (count) count.textContent = '本工具已选 ' + list.length + ' / '+cap + ' 张 · 生图工作台现有 ' + original.length + ' 张';
    const tip = $('#hgStage2Limit');
    if (tip) {
      tip.textContent = t.maxImages > NATIVE_LIMIT
        ? '此工具设计最多 ' + t.maxImages + ' 张；当前 Hamoki 生图引擎一次最多 ' + NATIVE_LIMIT + ' 张，不会自动舍弃多余图片。'
        : '支持 PNG / JPG / WebP；每张不超过 12 MB，总计不超过 40 MB。';
    }
    const replaceBox = $('#hgStage2ReplaceRow');
    if (replaceBox) replaceBox.hidden = original.length===0;
    const replaceInput = $('#hgStage2Replace');
    if (replaceInput) replaceInput.checked = nativeMode;
    const status = $('#hgStage2ReferenceStatus');
    if (status) {
      const effective = (nativeMode?0:original.length)+list.length;
      status.textContent = effective < t.requiredImages
        ? '还需要 ' + (t.requiredImages-effective) + ' 张参考图才能使用这个工具。'
        : effective > Math.min(cap,NATIVE_LIMIT)
          ? '当前总数超过工具或模型上限，请勾选替换现有参考图或删除部分图片。'
          : effective>0
            ? '满足数量要求。点击使用后会将已选图片加入原生参考图区。'
            : '无需参考图，可以直接生成。';
      status.classList.toggle('hg-stage2-invalid',effective<t.requiredImages||effective>cap);
    }
    const region = $('#hgStage2Thumbs');
    if (!region) return;
    region.replaceChildren();
    for (let i=0;i<list.length;i++) {
      const f = list[i];
      const card = make('div','hg-stage2-thumb');
      const img = document.createElement('img');
      const url = URL.createObjectURL(f);
      img.src = url;
      img.alt = '本工具第 '+(i+1)+' 张参考图';
      img.onload = img.onerror = () => URL.revokeObjectURL(url);
      const remove = make('button','hg-stage2-remove');
      remove.type = 'button';
      remove.dataset.removeDraft = String(i);
      remove.setAttribute('aria-label','删除第 '+(i+1)+' 张参考图：'+f.name);
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19"/></svg>';
      const label = make('span','hg-stage2-filename',f.name);
      card.append(img,label,remove);
      region.append(card);
    }
  }

  function addToolFiles(list) {
    const tool = tools.get(activeToolId);
    if (!tool) return;
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    const existing = incomingFiles(tool.id);
    const cap = countLimit(tool);
    let total = existing.reduce((s,f)=>s+f.size,0);
    let added=0;
    let error = '';
    for (const file of incoming) {
      if (!MIME_TYPES.has(file.type)) { error = '仅支持 PNG、JPG 和 WebP 格式'; continue; }
      if (!file.size || file.size > BYTES_PER_IMAGE) { error = file.name+' 超过单张 12 MB 限制'; continue; }
      if (existing.length >= cap) { error = '本工具当前最多能选择 '+cap+' 张图片'; break; }
      if (total + file.size > BYTES_TOTAL) { error = '上传的参考图合计超过 40 MB'; break; }
      existing.push(file);
      total += file.size;
      added++;
    }
    syncUploader();
    if (error) notify(error);
    else notify('已加入 '+added+' 张参考图');
  }
  function uploadPanel(t) {
    const panel = make('section','hg-stage2-upload');
    panel.id='hgStage2Upload';
    const zone = make('div','hg-stage2-drop');
    zone.setAttribute('role','button');
    zone.tabIndex=0;
    zone.setAttribute('aria-label','选择、拖入或粘贴本工具的参考图片');
    zone.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5" stroke="#74D2A4"/><path d="M4 17v3h16v-3"/></svg><span>点击选择、拖入或 <kbd>Ctrl+V</kbd> 粘贴图片</span>';
    const input = document.createElement('input');
    input.type='file';
    input.id='hgStage2Input';
    input.hidden=true;
    input.accept='image/png,image/jpeg,image/webp';
    input.multiple=true;
    input.addEventListener('change',()=>{
      addToolFiles(input.files);
      input.value='';
    });
    zone.addEventListener('click',()=>input.click());
    zone.addEventListener('keydown', e=>{
      if (e.key==='Enter'||e.key===' ') {e.preventDefault();input.click();}
    });
    zone.addEventListener('dragover', e=>{
      e.preventDefault();
      e.dataTransfer.dropEffect='copy';
      zone.classList.add('hg-stage2-drag');
    });
    zone.addEventListener('dragleave',()=>zone.classList.remove('hg-stage2-drag'));
    zone.addEventListener('drop',e=>{
      e.preventDefault();
      zone.classList.remove('hg-stage2-drag');
      addToolFiles(e.dataTransfer.files);
    });
    const count = make('div','hg-stage2-count');
    count.id='hgStage2Count';
    const limit = make('p','hg-stage2-limit');
    limit.id='hgStage2Limit';
    const thumbs = make('div','hg-stage2-thumbs');
    thumbs.id='hgStage2Thumbs';
    thumbs.addEventListener('click',e=>{
      const button = e.target.closest('[data-remove-draft]');
      if (!button) return;
      const index = Number(button.dataset.removeDraft);
      const current = incomingFiles(t.id);
      if(index<0||index>=current.length)return;
      current.splice(index,1);
      syncUploader();
    });
    const replacement = make('label','hg-stage2-replace');
    replacement.id='hgStage2ReplaceRow';
    const check = document.createElement('input');
    check.type='checkbox';
    check.id='hgStage2Replace';
    check.checked=!!replacementById.get(t.id);
    check.addEventListener('change',()=>{
      replacementById.set(t.id,check.checked);
      syncUploader();
    });
    replacement.append(check,document.createTextNode('替换生图工作台已有参考图（否则追加）'));
    const status=make('p','hg-stage2-ref-status');
    status.id='hgStage2ReferenceStatus';
    panel.append(zone,input,count,limit,thumbs,replacement,status);
    syncUploader();
    return panel;
  }
  function expandEditor(t) {
    const editor = $('#hgEditor');
    if (!editor || !editor.querySelector('h2')) return;
    // The base editor is rebuilt on every open, even for the same tool.
    // A remembered id alone cannot prove that its preview/uploader still exist.
    if (editor.dataset.stage2Tool===t.id && editor.querySelector('#hgStage2Upload') && editor.querySelector('.hg-stage2-feature')) return;
    activeToolId=t.id;
    editor.dataset.stage2Tool=t.id;
    const image=previewImage(t,true);
    if (image) {
      const frame=make('div','hg-stage2-feature');
      frame.append(image,make('span','hg-stage2-feature-caption','原创效果示意 · 非实际生成结果'));
      editor.querySelector('h2').after(frame);
    }
    const refNote=editor.querySelector('.hg-tip');
    if (refNote) {
      refNote.textContent=t.requiredImages
        ? '需至少 '+t.requiredImages+' 张，工具上限 '+t.maxImages+' 张。图片可在这里上传并自动带入现有生图器。'
        : '可选参考图，工具设计上限 '+t.maxImages+' 张。支持上传、拖入和粘贴。';
      const upload=uploadPanel(t);
      refNote.after(upload);
      syncUploader();
    }
    if (t.taskType==='processing'||t.taskType==='review') {
      const button=editor.querySelector('.hg-submit');
      if(button)button.textContent='复制任务配置 · 专用引擎未接入';
    }
    const instruction = make('details','hg-stage2-prompt-preview');
    instruction.id='hgStage2PromptDetails';
    const summary=make('summary','','查看生成指令');
    const chars=make('span','hg-stage2-prompt-length','');
    chars.id='hgStage2PromptLength';
    const readonly=document.createElement('textarea');
    readonly.id='hgStage2PromptPreview';
    readonly.readOnly=true;
    readonly.rows=7;
    readonly.setAttribute('aria-label','根据工具参数生成的完整提示词预览');
    instruction.append(summary,chars,readonly);
    instruction.addEventListener('toggle',()=>{
      if(instruction.open) updatePromptPreview();
    });
    editor.querySelector('.hg-submit')?.before(instruction);
    const ratio = t.ratio;
    if (ratio==='5:4') {
      const notice = make('p','hg-stage2-ratio-tip','此工具使用 5:4 比例；当前生图器没有该比例，带入时将改用最接近的 4:3，并提示你。');
      editor.querySelector('.hg-editor-meta')?.after(notice);
    }
  }
  function fieldValues() {
    const values={};
    for(const input of document.querySelectorAll('#hgEditor [data-field]')) values[input.dataset.field]=input.value;
    return values;
  }
  function updatePromptPreview() {
    const t=tools.get(activeToolId);
    const preview=$('#hgStage2PromptPreview');
    if(!t||!preview)return;
    const text=window.HamokiGameToolPlaza?.buildPrompt?.(t,fieldValues())||'';
    preview.value=text;
    const counter=$('#hgStage2PromptLength');
    if(counter){
      counter.textContent=text.length+' / 1000 字';
      counter.classList.toggle('hg-stage2-too-long',text.length>1000);
    }
  }
  function validateFiles(t){
    const api=window.HamokiReferences;
    if(!api?.files||!api?.add||!api?.clear){
      notify('原生参考图接口尚未就绪，请先打开 AI 生图再尝试');
      return null;
    }
    const incoming=incomingFiles(t.id);
    const replacing=!!replacementById.get(t.id);
    const current=replacing?[]:nativeFiles();
    const totalCount=current.length+incoming.length;
    const cap=countLimit(t);
    if(totalCount>cap){
      notify('原生工作台与本工具合计 '+totalCount+' 张，上限 '+cap+' 张。请勾选替换或删除多余图片。');
      $('#hgStage2Replace')?.focus();
      return null;
    }
    if(totalCount<t.requiredImages){
      notify('此工具至少需要 '+t.requiredImages+' 张参考图，当前只有 '+totalCount+' 张');
      $('#hgStage2Input')?.focus();
      return null;
    }
    const images=current.concat(incoming);
    const totalBytes=images.reduce((s,f)=>s+f.size,0);
    if(totalBytes>BYTES_TOTAL){notify('参考图合计不能超过 40 MB，请删除多余图片');return null;}
    for(const f of images){
      if(!MIME_TYPES.has(f.type)||!f.size||f.size>BYTES_PER_IMAGE){
        notify('图片类型或大小不符合要求：'+f.name);return null;
      }
    }
    return {api, incoming, replacing, totalCount};
  }
  async function useTool(id){
    const t = tools.get(id);
    if(!t)return;
    activeToolId=id;
    const values=fieldValues();
    const fieldList=t.fields.length?t.fields:[{key:'additional',label:'具体制作要求',required:false}];
    for(const f of fieldList) {
      const v=String(values[f.key]||'');
      if(f.required && !v.trim()) {
        notify('请填写「'+f.label+'」');
        document.getElementById('hg-f-'+f.key)?.focus();
        return;
      }
      if(f.maxLength && v.length>f.maxLength){
        notify(f.label+' 不得超过 '+f.maxLength+' 字');
        return;
      }
    }
    // Validate common grid parameters instead of generating an impossible sheet.
    if(Object.hasOwn(values,'grid_rows') && Object.hasOwn(values,'grid_cols')) {
      const rows=Number(values.grid_rows), cols=Number(values.grid_cols);
      if(!Number.isInteger(rows)||!Number.isInteger(cols)||rows<1||cols<1||rows>9||cols>9) {
        notify('网格行数和列数必须是 1～9 的整数');
        return;
      }
      if(Object.hasOwn(values,'element_count')) {
        const count=Number(values.element_count);
        if(Number.isFinite(count)&&count>rows*cols) {
          notify('你选择了 '+count+' 个元素，但 '+rows+'×'+cols+' 的网格只有 '+rows*cols+' 格，请调整网格');
          return;
        }
      }
    }
    const refs=validateFiles(t);
    if(!refs)return;
    let prompt=window.HamokiGameToolPlaza?.buildPrompt?.(t,values);
    if(typeof prompt!=='string'||!prompt.trim()) {
      notify('生成提示词失败，请刷新工具页面');return;
    }
    if(prompt.length>1000){
      notify('提示词共 '+prompt.length+' 字，超出模型的 1000 字限制。请精简工具参数后再使用。');
      return;
    }
    if(t.taskType==='processing'||t.taskType==='review') {
      const config={
        toolId:t.id, name:t.name,category:t.category,ratio:t.ratio,
        fields:values, referenceFileNames:refs.incoming.map(f=>f.name),
        requiresSpecialEngine:true, prompt
      };
      try {
        if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
        await navigator.clipboard.writeText(JSON.stringify(config,null,2));
        notify('已复制任务配置，但尚未实现真正的拆件或质检');
      }catch{
        notify('该工具需要专用处理引擎，目前尚不能执行');
      }
      return;
    }

    const nav=$('.nav-icon-btn[data-view="image-generate"]');
    if(!nav){notify('原生生图入口暂不可用');return;}
    nav.click();
    const promptInput=$('#prompt-input');
    if(!promptInput || !document.querySelector('#ratio-group')) {
      notify('生图编辑器没有成功切换，未传递图片');
      return;
    }
    const api=refs.api;
    if(refs.replacing) api.clear(); // User explicitly opted in, never silently clears images.
    const countBefore=nativeFiles().length;
    const added=refs.incoming.length?api.add(refs.incoming):0;
    if(added!==refs.incoming.length || nativeFiles().length!==countBefore+refs.incoming.length){
      notify('部分参考图未能加入生图工作台，请检查参考图列表再提交');
      return;
    }
    drafts.delete(t.id);
    promptInput.value=prompt;
    promptInput.dispatchEvent(new Event('input',{bubbles:true}));
    let selectedRatio=t.ratio==='smart'?'auto':t.ratio;
    let ratioMessage='';
    if(selectedRatio==='5:4'){
      selectedRatio='4:3';
      ratioMessage=' · 5:4 暂不支持，已选 4:3';
    }
    const matching=[...document.querySelectorAll('#ratio-group .ratio-button')]
      .find(button=>button.dataset.value===selectedRatio);
    if(matching) matching.click();
    else if(selectedRatio!=='auto') ratioMessage=' · 当前比例暂不可用，请手动选择';
    let note=$('#hgToolNotice');
    const pane=$('#params-panel .panel-content');
    if(pane){
      if(!note){
        note=make('div','hg-import-note');
        note.id='hgToolNotice';
        note.setAttribute('role','status');
        pane.prepend(note);
      }
      note.textContent='已载入「'+t.name+'」'+(refs.totalCount
        ?'，参考图 '+nativeFiles().length+' 张已经加入原生生图器。':'，无需参考图。')
        +ratioMessage+' 你可以修改提示词后再加入队列。';
    }
    promptInput.focus({preventScroll:true});
    notify('已完成工具参数与参考图传递，没有自动生成或扣费');
  }
  async function loadData(){
    const r=await fetch('assets/game-ui-tools.json?v=3',{cache:'no-cache'});
    if(!r.ok)throw Error('HTTP '+r.status);
    const result=await r.json();
    if(!Array.isArray(result.items)||result.items.length!==221)
      throw Error('工具数据不完整');
    tools=new Map(result.items.map(t=>[t.id,t]));
    hydrateCards();
  }
  function init(){
    const grid=$('#hgGrid');
    if(grid){
      watchGrid=new MutationObserver(hydrateCards);
      watchGrid.observe(grid,{childList:true});
    }
    document.addEventListener('click', e=>{
      const open=e.target.closest('#hgPlaza [data-open]');
      if(open){
        const t=tools.get(open.dataset.open);
        // The old app recreates all cards during the click. Capture the id
        // before that detached DOM node loses its #hgPlaza ancestor.
        if(t) setTimeout(()=>expandEditor(t),0);
      }
      const close=e.target.closest('#hgPlaza [data-close]');
      if(close){
        activeToolId=null;
        $('#hgEditor')?.removeAttribute('data-stage2-tool');
      }
    },true);
    // Intercept exactly the tool's apply action; do not change other navigation or generation actions.
    document.addEventListener('click',e=>{
      const button=e.target.closest('#hgPlaza #hgEditor [data-use]');
      if(!button)return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      void useTool(button.dataset.use);
    },true);
    document.addEventListener('paste',e=>{
      if(!document.body.classList.contains('hg-tools-active'))return;
      if(!activeToolId)return;
      const images=Array.from(e.clipboardData?.items||[])
        .filter(item=>MIME_TYPES.has(item.type))
        .map(item=>item.getAsFile()).filter(Boolean);
      if(!images.length)return;
      e.preventDefault();
      e.stopImmediatePropagation();
      addToolFiles(images);
    },true);
    document.addEventListener('input',e=>{
      if(e.target.matches?.('#hgEditor [data-field]') && $('#hgStage2PromptDetails')?.open)
        updatePromptPreview();
    });
    document.addEventListener('change',e=>{
      if(e.target.matches?.('#hgEditor [data-field]') && $('#hgStage2PromptDetails')?.open)
        updatePromptPreview();
    });
    loadData().catch(error=>{
      console.error('[Hamoki stage2 tools]',error);
      notify('高级工具预览和参考图界面加载失败');
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();

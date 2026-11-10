'use strict';
(() => {
  let projectId = null, projectNodes = [], projectGroups = [], historyItems = [], dragging = false, selectedId = null;
  const selectedNodeIds = new Set();
  const expandedStacks = new Set();
  let canvasViewportSignature = '', viewportRefreshFrame = 0, animatedStackKey = '';
  let suppressCardClickId = null;
  const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  let entryViewApplied = false;
  const ENTRY_VIEW_ZOOM = 0.5;
  let selectionCenterTimer = 0;
  const undoStack = [], redoStack = [];
  const rectOf = node => ({x:Math.round(node.x),y:Math.round(node.y),w:Math.round(node.w),h:Math.round(node.h)});
  function syncUndoControls() {
    const controls=document.querySelectorAll('.right-section > .icon-btn');
    if(controls[0]) controls[0].disabled=undoStack.length===0;
    if(controls[1]) controls[1].disabled=redoStack.length===0;
  }
  function rememberGeometry(nodeId,before,after) {
    if (['x','y','w','h'].every(key=>before[key]===after[key])) return;
    undoStack.push({nodeId,before:{...before},after:{...after}});
    if(undoStack.length>75) undoStack.shift();
    redoStack.length=0;
    syncUndoControls();
  }
  async function stepHistory(reverse) {
    if(!projectId)return;
    const source=reverse?undoStack:redoStack, dest=reverse?redoStack:undoStack;
    const entry=source[source.length-1];
    if(!entry)return;
    const node=projectNodes.find(item=>item.id===entry.nodeId);
    if(!node){source.pop();syncUndoControls();return;}
    const payload=reverse?entry.before:entry.after;
    try {
      await api('/api/projects/'+projectId+'/nodes/'+entry.nodeId,{
        method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
      });
      source.pop();dest.push(entry);Object.assign(node,payload);
      selectedId=entry.nodeId;
      await refresh();syncUndoControls();
    } catch(error){toast((reverse?'撤销':'重做')+'失败：'+error.message,true);}
  }
  const canvas = () => document.getElementById('canvas');
  const panel = () => document.getElementById('params-panel');
  const make = (tag, className, text) => {
    const elem = document.createElement(tag);
    if (className) elem.className = className;
    if (text !== undefined) elem.textContent = text;
    return elem;
  };
  async function api(url, options = {}) {
    const response = await fetch(url, {cache:'no-store', ...options});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || ('HTTP ' + response.status));
    return data;
  }
  const payload = obj => ({method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(obj)});
  const NATIVE_RATIOS = ['1:1','3:2','2:3','16:9','9:16','4:3','3:4'];
  const ratioValue = text => Number(text.split(':')[0])/Number(text.split(':')[1]);
  const nearestRatio = (width,height) => {
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return '1:1';
    const v = width/height;
    return NATIVE_RATIOS.reduce((a,b)=>
      Math.abs(Math.log(ratioValue(b)/v))<Math.abs(Math.log(ratioValue(a)/v))?b:a);
  };
  const imageDims = src => new Promise((ok,fail) => {
    const im = new Image();
    im.onload = () => ok([im.naturalWidth, im.naturalHeight]);
    im.onerror = () => fail(Error('读取图片比例失败'));
    im.src = src;
  });
  const urlFor = node => node.kind === 'generated'
    ? historyItems.find(h => h.id === node.historyId)?.url
    : node.kind === 'reference' ? node.url : null;
  // Canvas cards use cached 480px WebP previews. Original URLs are only used
  // for explicit double-click, download, copy, reference and image editing.
  const previewFor = node => node.kind === 'generated'
    ? findHistory(node.historyId)?.previewUrl
    : node.kind === 'reference' ? node.previewUrl : null;
  let canvasPreviewObserver = null;
  const canObserveCanvasImages = typeof IntersectionObserver === 'function';
  function watchCanvasImage(image, node, original) {
    const preview = previewFor(node) || original;
    image.decoding = 'async';
    image.loading = 'lazy';
    image.dataset.preview = preview;
    // A missing/broken thumbnail must not make an image disappear forever.
    image.addEventListener('error', () => {
      if (image.getAttribute('src') === preview && preview !== original)
        image.src = original;
    });
    if (!canObserveCanvasImages) {image.src = preview;return;}
    if (!canvasPreviewObserver) {
      canvasPreviewObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const img = entry.target;
          if (!img.isConnected) continue;
          if (entry.isIntersecting) {
            if (!img.hasAttribute('src')) img.src = img.dataset.preview;
          } else if (img.hasAttribute('src')) {
            // Dropping the resource reference gives the browser permission to
            // reclaim decoded pixels. The node and metadata remain intact.
            img.removeAttribute('src');
          }
        }
      }, {root: document.getElementById('canvas-viewport'),rootMargin:'650px'});
    }
    canvasPreviewObserver.observe(image);
  }
  function findHistory(id) {return historyItems.find(h => h.id === id);}
  // Keep all node metadata; only render artwork inside the current viewport.
  function worldViewport(margin=360) {
    const viewport=document.getElementById('canvas-viewport');
    if(!viewport)return {x0:-Infinity,y0:-Infinity,x1:Infinity,y1:Infinity};
    const zoom=state.zoom||1;
    const origin=window.HamokiViewport?.worldOrigin?.()||{left:0,top:0};
    return {x0:(viewport.scrollLeft-origin.left-margin)/zoom,
      y0:(viewport.scrollTop-origin.top-margin)/zoom,
      x1:(viewport.scrollLeft+viewport.clientWidth-origin.left+margin)/zoom,
      y1:(viewport.scrollTop+viewport.clientHeight-origin.top+margin)/zoom};
  }
  function touchesViewport(node,bounds) {
    return Number(node.x)+Number(node.w)>bounds.x0 && Number(node.x)<bounds.x1 &&
      Number(node.y)+Number(node.h)>bounds.y0 && Number(node.y)<bounds.y1;
  }
  function stackRelations() {
    const byId=new Map(projectNodes.map(node=>[node.id,node]));
    const byHistory=new Map(projectNodes.filter(n=>n.kind==='generated').map(n=>[n.historyId,n]));
    const historyParents=new Map(historyItems.map(h=>[h.id,h.parentId]));
    const byChild=new Map(),groups=new Map();
    for(const node of projectNodes) {
      if(node.kind==='note'||(node.groupId&&projectGroups.some(g=>g.id===node.groupId)))continue;
      const parent=byId.get(node.parentNodeId)||
        (node.kind==='generated'?byHistory.get(historyParents.get(node.historyId)):null);
      if(!parent || parent.id===node.id || parent.kind==='note')continue;
      const dx=(node.x+node.w/2)-(parent.x+parent.w/2);
      const dy=(node.y+node.h/2)-(parent.y+parent.h/2);
      // Only vertically derived images form stacks. Side-by-side work stays free.
      if(Math.abs(dx)>Math.max(parent.w,node.w)*.82 ||
          Math.abs(dy)<Math.min(parent.h,node.h)*.68)continue;
      const direction=dy<0?'above':'below',key=parent.id+':'+direction;
      if(!groups.has(key))groups.set(key,{key,parent,direction,nodes:[]});
      groups.get(key).nodes.push(node);
      byChild.set(node.id,{key,parent});
    }
    const hiddenCache=new Map();
    function hidden(node,seen=new Set()) {
      if(hiddenCache.has(node.id))return hiddenCache.get(node.id);
      const rel=byChild.get(node.id);
      if(!rel || seen.has(node.id))return false;
      seen.add(node.id);
      const value=!expandedStacks.has(rel.key)||hidden(rel.parent,seen);
      hiddenCache.set(node.id,value);
      return value;
    }
    return {groups,byChild,hidden};
  }
  function canvasDisplayModel() {
    const bounds=worldViewport(),relations=stackRelations();
    // All images remain visible; viewport virtualization still avoids offscreen DOM work.
    const nodes=projectNodes.filter(node=>touchesViewport(node,bounds));
    const signature=nodes.map(n=>n.id).join('|');
    return {nodes,stacks:[],relations,signature};
  }
  function scheduleVirtualCanvas() {
    if(viewportRefreshFrame || dragging)return;
    viewportRefreshFrame=requestAnimationFrame(()=>{
      viewportRefreshFrame=0;
      if(!projectId||dragging)return;
      if(canvasDisplayModel().signature!==canvasViewportSignature)renderCanvas('viewport');
    });
  }
  function visibleAncestor(node) { return node; }
  function allCanvasExtent() {
    let maxX=0,maxY=0;
    for(const node of projectNodes){
      maxX=Math.max(maxX,(Number(node.x)||0)+(Number(node.w)||288));
      maxY=Math.max(maxY,(Number(node.y)||0)+(Number(node.h)||288));
    }
    return {maxX,maxY};
  }
  function canvasFitBounds() {
    const selected=selectedNodeIds.size;
    const nodes=projectNodes.filter(node=>!selected||selectedNodeIds.has(node.id));
    if(!nodes.length)return null;
    return {minX:Math.min(...nodes.map(n=>Number(n.x)||0)),
      minY:Math.min(...nodes.map(n=>Number(n.y)||0)),
      maxX:Math.max(...nodes.map(n=>(Number(n.x)||0)+(Number(n.w)||288))),
      maxY:Math.max(...nodes.map(n=>(Number(n.y)||0)+(Number(n.h)||288)))};
  }
  function unfoldAncestors(node) {
    const relations=stackRelations(),seen=new Set();
    let current=node,changed=false;
    while(current&&!seen.has(current.id)){
      seen.add(current.id);
      const rel=relations.byChild.get(current.id);
      if(!rel)break;
      if(!expandedStacks.has(rel.key)){expandedStacks.add(rel.key);changed=true;}
      current=rel.parent;
    }
    if(changed)renderCanvas('viewport');
  }
  const stackBusy=new Set();
  function positionStack(group,button,open) {
    const width=open?43:108,height=open?27:43;
    button.style.left=Math.round(group.parent.x+group.parent.w/2-width/2)+'px';
    // Always outside the source image. Even expanded controls fit in the gap.
    button.style.top=Math.round(group.direction==='above'
      ?group.parent.y-height-13:group.parent.y+group.parent.h+10)+'px';
  }
  function makeStack(group) {
    const open=expandedStacks.has(group.key);
    const button=make('button','canvas-derived-stack'+(open?' expanded':''));
    button.type='button';button.dataset.stackKey=group.key;
    button.title=(open?'收起':'展开')+(group.direction==='above'?'上方':'下方')+'的'+group.nodes.length+'张衍生图';
    button.setAttribute('aria-expanded',String(open));
    button.setAttribute('aria-label',button.title);
    positionStack(group,button,open);
    const pile=make('span','canvas-derived-thumbs');
    for(const node of group.nodes.slice(0,3)){
      const img=make('img','canvas-derived-thumb');
      img.src=previewFor(node)||urlFor(node);img.loading='lazy';img.decoding='async';img.alt='';
      img.draggable=false;pile.append(img);
    }
    const text=make('span','canvas-derived-count',String(group.nodes.length));
    const direction=make('span','canvas-derived-chevron');
    direction.textContent=group.direction==='above'?'⌃':'⌄';
    button.append(pile,text,direction);
    button.addEventListener('pointerdown',event=>event.stopPropagation());
    button.addEventListener('dblclick',event=>event.stopPropagation());
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();void toggleStack(group.key);});
    return button;
  }
  function branchTravel(card,button) {
    const a=card.getBoundingClientRect(),b=button.getBoundingClientRect(),zoom=state.zoom||1;
    return {x:((b.left+b.right)-(a.left+a.right))/2/zoom,
            y:((b.top+b.bottom)-(a.top+a.bottom))/2/zoom};
  }
  async function toggleStack(key) {
    if(stackBusy.has(key))return;
    const group=stackRelations().groups.get(key);
    if(!group)return;
    if(!expandedStacks.has(key)){
      expandedStacks.add(key);renderCanvas('viewport');
      if(prefersReducedMotion())return;
      const button=document.querySelector('.canvas-derived-stack[data-stack-key="'+key+'"]');
      if(!button)return;
      const cards=group.nodes.map(n=>document.querySelector('.canvas-node[data-id="'+n.id+'"]')).filter(Boolean);
      const anims=cards.map((card,i)=>{
        card.classList.remove('canvas-branch-appear');
        const delta=branchTravel(card,button);
        return card.animate([
          {opacity:0,transform:'translate3d('+delta.x+'px,'+delta.y+'px,0) scale(.28)'},
          {opacity:1,transform:'translate3d(0,0,0) scale(1)'}],
          {duration:480+Math.min(i,5)*38,delay:Math.min(170,i*34),
            easing:'cubic-bezier(.22,1,.36,1)',fill:'both'});
      });
      await Promise.allSettled(anims.map(a=>a.finished));
      anims.forEach(a=>a.cancel());
      return;
    }
    const button=document.querySelector('.canvas-derived-stack[data-stack-key="'+key+'"]');
    const cards=group.nodes.map(n=>document.querySelector('.canvas-node[data-id="'+n.id+'"]')).filter(Boolean);
    const commit=()=>{
      expandedStacks.delete(key);
      if(group.nodes.some(n=>selectedNodeIds.has(n.id)))focusNode(group.parent.id);
      renderCanvas('viewport');
      stackBusy.delete(key);
    };
    if(!button||!cards.length||prefersReducedMotion()){commit();return;}
    stackBusy.add(key);
    button.setAttribute('aria-busy','true');
    const anims=cards.map((card,i)=>{
      const delta=branchTravel(card,button);
      return card.animate([
        {opacity:1,transform:'translate3d(0,0,0) scale(1)'},
        {opacity:0,transform:'translate3d('+delta.x+'px,'+delta.y+'px,0) scale(.28)'}],
        {duration:340+Math.min(i,5)*25,delay:Math.min(130,i*22),
          easing:'cubic-bezier(.4,0,.65,1)',fill:'forwards'});
    });
    await Promise.allSettled(anims.map(a=>a.finished));
    commit();
  }

  async function downloadCanvasImage(node,button) {
    const source=urlFor(node);
    if(!source){toast('没有找到这张图片的原图文件',true);return false;}
    if(button)button.disabled=true;
    try {
      // Download the original response bytes, not a canvas screenshot or
      // thumbnail. Blob URLs also work if the source is served as an image.
      const response=await fetch(source,{credentials:'same-origin'});
      if(!response.ok)throw Error('图片读取失败（HTTP '+response.status+'）');
      const blob=await response.blob();
      if(!blob.size)throw Error('图片文件为空');
      if(blob.type && !blob.type.startsWith('image/'))throw Error('源文件不是图片');
      const type=blob.type.split(';')[0].toLowerCase();
      const ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp',
        'image/gif':'gif','image/avif':'avif','image/svg+xml':'svg'})[type]||'png';
      const history=node.kind==='generated'?findHistory(node.historyId):null;
      const suggested=node.title||node.name||history?.fileName||history?.name||'Hamoki-'+node.id.slice(0,8);
      const safe=String(suggested).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim().slice(0,72)||'Hamoki-image';
      const stem=safe.replace(/\.(png|jpe?g|webp|gif|avif|svg)$/i,'');
      const link=make('a');
      const objectUrl=URL.createObjectURL(blob);
      link.href=objectUrl;
      link.download=stem+'.'+ext;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
      toast('已开始下载原图');
      return true;
    }catch(error){
      toast('下载原图失败：'+error.message,true);
      return false;
    }finally{
      if(button)button.disabled=false;
    }
  }
  function toast(message, bad = false) {
    let note = document.getElementById('canvas-message');
    if (!note) {
      note = make('div','canvas-message');note.id = 'canvas-message';
      document.getElementById('canvas-viewport')?.appendChild(note);
    }
    note.textContent = message;note.classList.toggle('error',bad);
    note.hidden = !message;
    clearTimeout(toast.timeout);
    if (message) toast.timeout = setTimeout(() => {note.hidden = true;},4500);
  }
  async function refresh() {
    if (dragging) return;
    try {
      const projects = await api('/api/projects');
      const chosen = (projects.projects || []).find(p => !p.archived);
      if (!chosen) {toast('尚未创建画布',true);return;}
      if(projectId!==chosen.id){
        expandedStacks.clear();selectedNodeIds.clear();
        selectedId=null;canvasViewportSignature='';entryViewApplied=false;
      }
      projectId = chosen.id;
      const [details, recent] = await Promise.all([
        api('/api/projects/' + projectId),
        api('/api/history')
      ]);
      projectNodes = details.project?.nodes || [];
      projectGroups = details.project?.groups || [];
      // A fresh visit shows the clean board. Floating tools appear only after selection.
      for(const id of [...selectedNodeIds])if(!projectNodes.some(item=>item.id===id))selectedNodeIds.delete(id);
      if (!projectNodes.some(item => item.id === selectedId)) selectedId = null;
      if(selectedId&&!selectedNodeIds.has(selectedId)&&selectedNodeIds.size<=1){
        selectedNodeIds.clear();selectedNodeIds.add(selectedId);
      }
      historyItems = recent.history || [];
      renderCanvas();
      applyEntryView();
      if (state.currentView === 'works') showWorks();
      if (state.currentView === 'library') showLibrary();
    } catch(e) {toast('同步画布失败：' + e.message,true);}
  }
  // The history API is newest-first, so the first generated node that still exists
  // on this canvas is the latest generated artwork.
  function latestCanvasArtwork() {
    for (const item of historyItems) {
      const node = projectNodes.find(n => n.kind === 'generated' && n.historyId === item.id);
      if (node) return node;
    }
    return projectNodes
      .filter(n => n.kind === 'generated' && urlFor(n))
      .sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null;
  }
  // A fresh visit opens at 50% and puts the newest generated artwork in the middle of
  // the canvas instead of leaving the user on an empty corner far away from it.
  function applyEntryView() {
    if (entryViewApplied) return;
    const viewport = document.getElementById('canvas-viewport');
    const host = window.HamokiViewport;
    if (!viewport || !host) return;
    entryViewApplied = true;
    const latestArtwork = latestCanvasArtwork();
    const latest = latestArtwork && visibleAncestor(latestArtwork);
    if (!latest) {host.setZoom?.(ENTRY_VIEW_ZOOM);return;}
    const centerX = (Number(latest.x) || 0) + (Number(latest.w) || 288) / 2;
    const centerY = (Number(latest.y) || 0) + (Number(latest.h) || 288) / 2;
    const recenter = () => host.centerOnWorld?.(ENTRY_VIEW_ZOOM, centerX, centerY);
    recenter();
    // The sidebar and panels finish their opening CSS transitions a few hundred ms
    // after the board renders, which resizes the viewport under the canvas. Follow
    // those layout changes briefly so the artwork really ends up centered, then stop
    // as soon as the user starts working with the canvas.
    let watching = true, timer = null;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(recenter) : null;
    const stop = () => {
      if (!watching) return;
      watching = false;
      try {observer?.disconnect();} catch {}
      clearTimeout(timer);
      window.removeEventListener('pointerdown', stop, true);
      window.removeEventListener('wheel', stop, true);
    };
    try {observer?.observe(viewport);} catch {}
    // Guarantee the extra passes even where ResizeObserver is unavailable.
    requestAnimationFrame(() => {if (watching) recenter();});
    for (const delay of [120, 320, 700, 1200])
      setTimeout(() => {if (watching) recenter();}, delay);
    timer = setTimeout(stop, 1600);
    window.addEventListener('pointerdown', stop, true);
    window.addEventListener('wheel', stop, true);
  }
  function cancelSelectionCenter() {
    clearTimeout(selectionCenterTimer);
    selectionCenterTimer = 0;
  }
  // A selected image must be visible without changing its world position or zoom.
  // Run after a click (not pointerdown), so selecting never disrupts free dragging.
  function centerClippedSelection(node, card) {
    const viewport = document.getElementById('canvas-viewport');
    if (!viewport || !card?.isConnected || selectedId !== node.id || node.kind === 'note') return;
    const visible = viewport.getBoundingClientRect();
    const image = card.getBoundingClientRect();
    const marginX = Math.min(36, visible.width * .07);
    const marginY = Math.min(42, visible.height * .07);
    if (image.left >= visible.left + marginX && image.right <= visible.right - marginX &&
        image.top >= visible.top + marginY && image.bottom <= visible.bottom - marginY) return;
    // A picture larger than the viewport cannot fit completely; avoid
    // re-scrolling it when its center is already where the user expects.
    if (Math.abs((image.left + image.right - visible.left - visible.right) / 2) < 3 &&
        Math.abs((image.top + image.bottom - visible.top - visible.bottom) / 2) < 3) return;
    const zoom = state.zoom || 1;
    const x = (parseFloat(card.style.left) || 0) + (card.offsetWidth || node.w || 288) / 2;
    const y = (parseFloat(card.style.top) || 0) + (card.offsetHeight || node.h || 288) / 2;
    const pan = window.HamokiViewport?.scrollToWorld;
    if (!pan) return;
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (resultPopovers?.nodeId === node.id) resultPopovers.anchorOffsetX = null;
    noteViewportMotion();
    pan(x - viewport.clientWidth / (2 * zoom), y - viewport.clientHeight / (2 * zoom), zoom, motion);
  }
  function scheduleSelectionCenter(node, card, delay = 260) {
    cancelSelectionCenter();
    selectionCenterTimer = setTimeout(() => {
      selectionCenterTimer = 0;
      centerClippedSelection(node, card);
    }, delay);
  }
  function updateMultiSelectionHud() {
    const viewport=document.getElementById('canvas-viewport');
    if(!viewport)return;
    let hud=document.body.querySelector('.canvas-multi-hud');
    if(selectedNodeIds.size<2){hud?.remove();return;}
    if(!hud){
      hud=make('div','canvas-multi-hud');hud.setAttribute('role','status');
      const count=make('span','canvas-multi-count'),group=make('button','canvas-multi-group','打组');
      const remove=make('button','canvas-multi-remove','删除选中');
      const cancel=make('button','canvas-multi-cancel','取消选择');
      group.type=remove.type=cancel.type='button';
      group.onclick=()=>void window.HamokiCanvasGroups?.create?.({
        projectId,nodes:projectNodes,groups:projectGroups,selectedIds:new Set(selectedNodeIds),
        refresh,toast,clearSelection:()=>focusNode(null)
      });
      remove.onclick=()=>void deleteSelectedNodes([...selectedNodeIds]);
      cancel.onclick=()=>focusNode(null);
      hud.append(count,group,remove,cancel);document.body.append(hud);
    }
    hud.querySelector('.canvas-multi-count').textContent='已选 '+selectedNodeIds.size+' 张';
    const rect=viewport.getBoundingClientRect();
    hud.style.left=Math.round(rect.left+14)+'px';
    hud.style.top=Math.round(rect.top+14)+'px';
  }
  function focusNode(id,additive=false) {
    if (selectedId !== id || id === null || additive)cancelSelectionCenter();
    if(!additive)selectedNodeIds.clear();
    if(id){
      if(additive&&selectedNodeIds.has(id))selectedNodeIds.delete(id);
      else selectedNodeIds.add(id);
    }
    selectedId=selectedNodeIds.size===1?[...selectedNodeIds][0]:null;
    if(selectedId)window.HamokiReturnNodes?.remember?.(selectedId);
    document.querySelectorAll('.canvas-node[data-id]').forEach(item=>
      item.classList.toggle('selected',selectedNodeIds.has(item.dataset.id)));
    renderResultPopovers();
    window.HamokiRichNote?.select(selectedId);
    updateMultiSelectionHud();
  }
  function selectedImageHistory(node) {
    if(!node)return null;
    if(node.kind==='generated')return findHistory(node.historyId);
    let parent=projectNodes.find(n=>n.id===node.parentNodeId),steps=0;
    while(parent&&steps++<8){
      if(parent.kind==='generated')return findHistory(parent.historyId);
      parent=projectNodes.find(n=>n.id===parent.parentNodeId);
    }
    return null;
  }
  function carryPreviousPrompt(node){
    const history=selectedImageHistory(node),input=document.getElementById('prompt-input');
    if(!history||!input)return;
    const text=String(history.editInstruction||history.prompt||'').trim();
    if(!text)return;
    input.value=text.slice(0,input.maxLength||1000);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    window.HamokiPromptHistory?.remember?.(text);
  }
  function resolveCanvasRef(id) {
    const n=projectNodes.find(item=>item.id===id&&item.kind!=='note');
    if(!n)return null;
    const url=urlFor(n);
    if(!url)return null;
    const h=n.kind==='generated'?findHistory(n.historyId):null;
    return {
      id:n.id,url,
      title:n.title||n.name||h?.fileName||h?.name||h?.title||
        (n.kind==='generated'?'生成图片 '+n.id.slice(-6):'画布参考 '+n.id.slice(-6))
    };
  }
  function revealCanvasNode(id) {
    const node=projectNodes.find(n=>n.id===id);
    const viewport=document.getElementById('canvas-viewport');
    if(!node||!viewport){toast('这张引用图已不在当前画布，请从素材库重新添加',true);return false;}
    const zoom=state.zoom||1;
    const origin=window.HamokiViewport?.worldOrigin?.()||{left:0,top:0};
    const x=origin.left+(node.x+node.w/2)*zoom-viewport.clientWidth/2;
    const y=origin.top+(node.y+node.h/2)*zoom-viewport.clientHeight/2;
    unfoldAncestors(node);
    focusNode(node.id);
    const motion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
    (window.HamokiViewport?.scrollToVirtual||((left,top)=>viewport.scrollTo({left,top,behavior:motion})))(x,y,motion);
    const target=Array.from(document.querySelectorAll('.canvas-node[data-id]')).find(x=>x.dataset.id===node.id);
    if(target){
      target.classList.remove('canvas-reference-jump');
      void target.offsetWidth;
      target.classList.add('canvas-reference-jump');
      setTimeout(()=>target.classList.remove('canvas-reference-jump'),1100);
    }
    scheduleResultPosition();
    return true;
  }

  function revealHistory(historyId, completedZoom = null) {
    const target=projectNodes.find(node=>node.historyId===historyId);
    const viewport=document.getElementById('canvas-viewport');
    if(!target||!viewport)return;
    if (completedZoom !== null && window.HamokiViewport?.animateZoomTo) {
      // The placeholder is already centered at 100%. Leave the image unselected:
      // a click opens its tools later, while this first view stays clean.
      unfoldAncestors(target);
      focusNode(null);
      window.HamokiViewport.animateZoomTo(completedZoom);
      return;
    }
    unfoldAncestors(target);
    const zoom=state.zoom||1;
    const origin=window.HamokiViewport?.worldOrigin?.()||{left:0,top:0};
    const left=origin.left+target.x*zoom,top=origin.top+target.y*zoom;
    const right=origin.left+(target.x+target.w)*zoom,bottom=origin.top+(target.y+target.h)*zoom;
    let x=viewport.scrollLeft,y=viewport.scrollTop;
    if(right>viewport.scrollLeft+viewport.clientWidth-34)x=right-viewport.clientWidth+60;
    else if(left<viewport.scrollLeft+34)x=left-50;
    if(bottom>viewport.scrollTop+viewport.clientHeight-34)y=bottom-viewport.clientHeight+56;
    else if(top<viewport.scrollTop+34)y=top-45;
    focusNode(target.id);
    const motion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
    (window.HamokiViewport?.scrollToVirtual||((left,top)=>viewport.scrollTo({left,top,behavior:motion})))(x,y,motion);
  }

  // Generated cards keep the original job metadata; local prompt edits are drafts,
  // never silent mutations of the historical generation record.
  const cardDrafts = new Map();
  function cardDraftKey(h) {return 'hamoki-result-draft:'+projectId+':'+h.id;}
  function cardPrompt(h) {
    // The composer opens empty. The original generation prompt stays in the
    // history and is reused by 做同款/引用, but it must not look like a
    // prefilled instruction for a new edit.
    if(cardDrafts.has(h.id))return cardDrafts.get(h.id);
    try{const stored=localStorage.getItem(cardDraftKey(h));if(stored!==null)return stored;}catch{}
    return String(h.editInstruction||h.prompt||'').slice(0,1000);
  }
  function sourceReferences(h) {
    const files = new Set(Array.isArray(h.referenceMedia) ? h.referenceMedia : []);
    const refs = projectNodes.filter(n => n.kind === 'reference' &&
      files.has((n.assetFile || String(n.url || '').split('/').pop())));
    const parent = projectNodes.find(n => n.kind === 'generated' && n.historyId === h.parentId);
    if (parent && !refs.some(n=>n.id===parent.id)) refs.push(parent);
    return refs;
  }
  async function bringToGenerator(node, h, mode, promptText) {
    // Switching views may rebuild the right-hand controls. Keep the user's
    // current draft across that render when the action is only "引用".
    const preservedPrompt=document.getElementById('prompt-input')?.value||'';
    document.querySelector('.nav-icon-btn[data-view="image-generate"]')?.click();
    const input=document.getElementById('prompt-input');
    if (!input) {toast('生图参数面板尚未就绪，请重试',true);return false;}
    // Image reference must not overwrite the user's draft with the source prompt.
    if(mode!=='reference'&&!promptText.trim()) {toast('请先填写提示词',true);return false;}
    if(mode!=='reference'&&promptText.length>1000) {toast('提示词超过生图面板的1000字限制，请先精简到1000字以内',true);return false;}
    const apiRefs=window.HamokiReferences;
    if(mode==='reference'||mode==='replay') {
      if(!apiRefs?.add || !apiRefs?.files) {toast('原生参考图入口尚不可用',true);return false;}
      const existing=apiRefs.files();
      if(mode==='reference'&&existing.length>=5) {
        toast('参考图已达到5张上限，请先移除一张',true);return false;
      }
      const origins=mode==='replay'?(Array.isArray(h.referenceMedia)?h.referenceMedia:[]):null;
      if(origins?.length>5){toast('此任务原始参考图超过当前5张上限，不能自动重放',true);return false;}
      if(mode==='replay' && existing.length &&
        !await window.HamokiGlassUI.confirm('重新生成将替换右侧现有参考图，恢复该作品原始参考图。继续吗？',{title:'替换参考图片'})){
        if(input.value!==preservedPrompt){input.value=preservedPrompt;input.dispatchEvent(new Event('input',{bubbles:true}));}
        return false;
      }
      try {
        const sources=mode==='reference'?[urlFor(node)]:origins.map(name=>'/api/media/'+encodeURIComponent(name));
        const files=await Promise.all(sources.map(async(src,i)=>{
          const response=await fetch(src,{credentials:'same-origin'});
          if(!response.ok)throw Error('第'+(i+1)+'张参考图已不可用');
          const blob=await response.blob();
          const type=blob.type||'image/png';
          const suffix=type==='image/webp'?'webp':type==='image/jpeg'?'jpg':'png';
          return new File([blob],'hamoki-reference-'+(i+1)+'.'+suffix,{type});
        }));
        if(files.some(file=>!file.size||file.size>12*1024*1024)||
          files.reduce((sum,f)=>sum+f.size,0)>40*1024*1024)
          throw Error('原始参考图超出当前文件大小限制');
        if(mode==='replay')apiRefs.clear();
        if(files.length && apiRefs.add(files)!==files.length)
          throw Error('部分参考图未能加入生成器，请核对缩略图后再提交');
      } catch(e) {toast('参考图恢复失败：'+e.message,true);return false;}
    }
    if(mode!=='reference'){
      input.value=promptText;input.dispatchEvent(new Event('input',{bubbles:true}));
      input.focus();
    }else if(input.value!==preservedPrompt){
      input.value=preservedPrompt;
      input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    toast(mode==='reference'?'已添加原图到右侧参考图；现有提示词未改变':
      mode==='replay'?'已恢复原参考图与提示词，请核对当前模型参数':'提示词已带入生图面板');
    return true;
  }
  async function saveDerivedImage(node,h,action) {
    const response=await fetch(urlFor(node),{credentials:'same-origin'});
    if(!response.ok)throw Error('原图读取失败');
    const blob=await response.blob();
    const bitmap=await createImageBitmap(blob);
    try {
      const grid=action==='grid',rotate=action==='rotate',mirror=action==='mirror';
      for(let i=0;i<(grid?4:1);i++){
        const w=grid?Math.floor(bitmap.width/2):(rotate?bitmap.height:bitmap.width);
        const ht=grid?Math.floor(bitmap.height/2):(rotate?bitmap.width:bitmap.height);
        const output=document.createElement('canvas');output.width=w;output.height=ht;
        const ctx=output.getContext('2d');if(!ctx)throw Error('浏览器不支持图像画布');
        if(grid)ctx.drawImage(bitmap,(i%2)*w,Math.floor(i/2)*ht,w,ht,0,0,w,ht);
        else {
          if(rotate){ctx.translate(w,0);ctx.rotate(Math.PI/2);}
          if(mirror){ctx.translate(w,0);ctx.scale(-1,1);}
          ctx.drawImage(bitmap,0,0);
        }
        const png=await new Promise(resolve=>output.toBlob(resolve,'image/png'));
        if(!png)throw Error('图片导出失败');
        if(png.size>12*1024*1024)throw Error('结果超过12MB，请先降低尺寸');
        const title=grid?'宫格切分 '+(i+1):rotate?'旋转90°':'水平镜像';
        await saveCanvasBlob(node,png,title+' · '+(h.model||'Hamoki'));
      }
      await refresh();toast(grid?'已生成4张独立切图，原图未变':'已生成新的'+(rotate?'旋转':'镜像')+'图片，原图未变');
    } finally {bitmap.close();}
  }
  async function nodeBitmap(node){
    const url=urlFor(node);
    if(!url)throw Error('这张图片没有可用的原图');
    const response=await fetch(url,{credentials:'same-origin'});
    if(!response.ok)throw Error('原图读取失败');
    const blob=await response.blob();
    if(!blob.size)throw Error('原图文件为空');
    try{return await createImageBitmap(blob);}
    catch{
      const objectUrl=URL.createObjectURL(blob);
      try{
        const image=await new Promise((resolve,reject)=>{
          const element=new Image();
          element.onload=()=>resolve(element);
          element.onerror=()=>reject(Error('原图解码失败'));
          element.src=objectUrl;
        });
        const canvas=document.createElement('canvas');
        canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        canvas.getContext('2d').drawImage(image,0,0);
        return canvas;
      }finally{URL.revokeObjectURL(objectUrl);}
    }
  }
  async function canvasToPng(canvas){
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob)throw Error('图片导出失败');
    if(blob.size>12*1024*1024)throw Error('结果超过12MB，请降低尺寸后重试');
    return blob;
  }
  async function saveCanvasBlob(node,blob,title,placement={}){
    if(!projectId)throw Error('当前还没有打开画布项目');
    const image=await fileData(blob);
    const created=await api('/api/projects/'+projectId+'/assets',payload({
      image,name:title,parentNodeId:node.id,placement:'related',
      w:placement.w||288,h:placement.h||288
    }));
    return created.node;
  }
  function imageAnalysis(source){
    const factor=Math.min(1,1024/Math.max(source.width,source.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(source.width*factor));
    canvas.height=Math.max(1,Math.round(source.height*factor));
    const context=canvas.getContext('2d',{willReadFrequently:true});
    context.drawImage(source,0,0,canvas.width,canvas.height);
    return {
      factor,width:canvas.width,height:canvas.height,
      data:context.getImageData(0,0,canvas.width,canvas.height).data
    };
  }
  function analysisBackground(data,width,height){
    const points=[[2,2],[width-3,2],[2,height-3],[width-3,height-3]];
    let red=0,green=0,blue=0,count=0;
    for(const [x,y] of points){
      const index=4*(y*width+x);
      if(data[index+3]<16)continue;
      red+=data[index];green+=data[index+1];blue+=data[index+2];count++;
    }
    return count?[red/count,green/count,blue/count]:[255,255,255];
  }
  function trimBounds(info){
    const {data,width,height}=info;
    const background=analysisBackground(data,width,height),tolerance=22;
    const isBackground=(x,y)=>{
      const index=4*(y*width+x);
      if(data[index+3]<16)return true;
      return Math.abs(data[index]-background[0])<=tolerance&&
        Math.abs(data[index+1]-background[1])<=tolerance&&
        Math.abs(data[index+2]-background[2])<=tolerance;
    };
    const rowClear=y=>{
      let count=0;
      for(let x=0;x<width;x++)if(isBackground(x,y))count++;
      return count>=width*.995;
    };
    const columnClear=x=>{
      let count=0;
      for(let y=0;y<height;y++)if(isBackground(x,y))count++;
      return count>=height*.995;
    };
    let top=0,bottom=height-1,left=0,right=width-1;
    while(top<bottom&&rowClear(top))top++;
    while(bottom>top&&rowClear(bottom))bottom--;
    while(left<right&&columnClear(left))left++;
    while(right>left&&columnClear(right))right--;
    if(top===0&&left===0&&bottom===height-1&&right===width-1)return null;
    return {left,top,right:right+1,bottom:bottom+1};
  }
  function autoCropBounds(info){
    const {data,width,height}=info;
    let transparent=0;
    const total=width*height;
    for(let index=3;index<data.length;index+=4)if(data[index]<20)transparent++;
    const useAlpha=transparent>total*.02;
    const background=useAlpha?null:analysisBackground(data,width,height);
    let left=width,top=height,right=-1,bottom=-1;
    for(let y=0;y<height;y++){
      for(let x=0;x<width;x++){
        const index=4*(y*width+x);
        if(data[index+3]<20)continue;
        if(!useAlpha&&Math.abs(data[index]-background[0])<=26&&
          Math.abs(data[index+1]-background[1])<=26&&
          Math.abs(data[index+2]-background[2])<=26)continue;
        if(x<left)left=x;
        if(x>right)right=x;
        if(y<top)top=y;
        if(y>bottom)bottom=y;
      }
    }
    if(right<left||bottom<top)return null;
    return {left,top,right:right+1,bottom:bottom+1};
  }
  function boundsToPixels(info,bounds,source){
    const factor=info.factor;
    const x=Math.max(0,Math.floor(bounds.left/factor));
    const y=Math.max(0,Math.floor(bounds.top/factor));
    const right=Math.min(source.width,Math.ceil(bounds.right/factor));
    const bottom=Math.min(source.height,Math.ceil(bounds.bottom/factor));
    const w=right-x,h=bottom-y;
    if(w<8||h<8)return null;
    if(x===0&&y===0&&w===source.width&&h===source.height)return null;
    return {x,y,w,h};
  }
  function cropSource(source,rect){
    const canvas=document.createElement('canvas');
    canvas.width=rect.w;canvas.height=rect.h;
    const context=canvas.getContext('2d');
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    context.drawImage(source,rect.x,rect.y,rect.w,rect.h,0,0,rect.w,rect.h);
    return canvas;
  }
  async function openResultImageEditor(node,h,mode){
    if(!window.HamokiResultImageEditor?.open)throw Error('图片编辑组件尚未加载，请刷新页面');
    const url=urlFor(node);
    if(!url)throw Error('这张图片没有可用的原图');
    const name={crop:'裁切',scale:'缩放',expand:'扩图'}[mode];
    await window.HamokiResultImageEditor.open({
      url,mode,
      onApply:async output=>{
        const created=await saveCanvasBlob(node,output.blob,name+' · '+(h?.model||'Hamoki'));
        await refresh();
        if(created?.id)revealCanvasNode(created.id);
        toast(name+'结果已保存为画布新图，原图保持不变');
        return true;
      }
    });
  }
  async function runLocalImageAction(node,h,action){
    if(action==='hd'||action==='expand'){
      toast('本地高清插值与本地扩图已停用。请使用 AI 图像生成器完成扩图',true);
      return;
    }
    if(action==='crop'||action==='resize'){
      return openResultImageEditor(node,h,action==='resize'?'scale':action);
    }
    const source=await nodeBitmap(node);
    try{
      if(action==='trim-edge'||action==='auto-crop'){
        const info=imageAnalysis(source);
        const bounds=action==='trim-edge'?trimBounds(info):autoCropBounds(info);
        const rect=bounds?boundsToPixels(info,bounds,source):null;
        if(!rect)throw Error(action==='trim-edge'
          ?'没有检测到可裁掉的纯色边缘'
          :'没有检测到需要裁切的留白或透明区域');
        const canvas=cropSource(source,rect);
        const blob=await canvasToPng(canvas);
        const name=action==='trim-edge'?'边缘裁切':'自动裁切';
        await saveCanvasBlob(node,blob,name+' · '+(h?.model||'Hamoki'));
        await refresh();
        toast('已完成'+name+'，输出 '+rect.w+' × '+rect.h+' px');
        return;
      }
      if(action==='grid9'){
        const columns=[0,Math.round(source.width/3),Math.round(source.width*2/3),source.width];
        const rows=[0,Math.round(source.height/3),Math.round(source.height*2/3),source.height];
        const TILE=196,GAP=14;
        let index=0;
        for(let row=0;row<3;row++){
          for(let column=0;column<3;column++){
            index++;
            const w=columns[column+1]-columns[column];
            const height=rows[row+1]-rows[row];
            const canvas=document.createElement('canvas');
            canvas.width=w;canvas.height=height;
            canvas.getContext('2d').drawImage(source,columns[column],rows[row],w,height,0,0,w,height);
            const blob=await canvasToPng(canvas);
            await saveCanvasBlob(node,blob,'九宫格 '+index+' · '+(h?.model||'Hamoki'),{w:TILE,h:TILE});
            toast('正在生成九宫格 '+index+'/9…');
          }
        }
        await refresh();
        toast('已生成 9 张独立九宫格切图，原图保持不变');
        return;
      }
      throw Error('不支持的图片处理方式');
    }finally{
      if(typeof source.close==='function')source.close();
    }
  }
  async function saveGeneratedAsAsset(node,h) {
    const response=await fetch(urlFor(node),{credentials:'same-origin'});
    if(!response.ok)throw Error('作品原图读取失败');
    const blob=await response.blob();
    if(blob.size>12*1024*1024)throw Error('作品超过单张12MB限制');
    if(!['image/png','image/jpeg','image/webp'].includes(blob.type))
      throw Error('当前图片格式不支持素材导入');
    await api('/api/projects/'+projectId+'/assets',payload({
      image:await fileData(blob),name:'作品素材 · '+(h.model||'Hamoki'),
      w:288,h:288,parentNodeId:node.id,placement:'related'
    }));
    await refresh();
    toast('已加入当前项目素材库，原始生成作品保留');
  }
  async function reverseGeneratedImage(node,h,textarea,dirty) {
    const response=await fetch(urlFor(node),{credentials:'same-origin'});
    if(!response.ok)throw Error('无法读取当前作品');
    const blob=await response.blob();
    if(blob.size>12*1024*1024)throw Error('原图超过12MB，暂不支持直接反推');
    const data=await fileData(blob);
    const result=await api('/api/reverse',payload({
      image:data,providerId:state.activeProviderId,kind:'detailed'
    }));
    if(!result.prompt)throw Error('识图模型没有返回有效提示词');
    textarea.value=String(result.prompt).slice(0,16000);
    cardDrafts.set(h.id,textarea.value);
    try{localStorage.setItem(cardDraftKey(h),textarea.value);}catch{}
    dirty.textContent='反推草稿已保存';
    try{
      const {x,y}=chooseRichNoteLocation(node,430,310);
      await createRichNote(result.prompt,x,y,430,310,node.id);
      const viewport=document.getElementById('canvas-viewport');
      const zoom=state.zoom||1;
      window.HamokiViewport?.scrollToWorld?.(
        x+215-viewport.clientWidth/zoom/2,
        y+155-viewport.clientHeight/zoom/2,zoom);
      toast('反推完成：文本块已放在原图右侧，可编辑、排版和拖动');
    }catch(error){
      toast('反推文字已保存到卡片，但画布文本块创建失败：'+error.message,true);
    }
  }
  function chooseRichNoteLocation(source,w=430,h=310){
    const gap=52;
    const start=source?[
      {x:source.x+source.w+gap,y:source.y},
      {x:source.x,y:source.y+source.h+gap},
      {x:source.x-w-gap,y:source.y},
      {x:source.x,y:source.y-h-gap}
    ]:[];
    const viewport=document.getElementById('canvas-viewport');
    if(viewport){
      const zoom=state.zoom||1;
      const origin=window.HamokiViewport?.worldOrigin?.()||{left:0,top:0};
      const centerX=(viewport.scrollLeft-origin.left+viewport.clientWidth/2)/zoom;
      const centerY=(viewport.scrollTop-origin.top+viewport.clientHeight/2)/zoom;
      start.push({x:centerX-w/2,y:centerY-h/2});
    }
    const free=point=>projectNodes.every(node=>{
      const x=Number(node.x)||0,y=Number(node.y)||0;
      const width=Number(node.w)||288,height=Number(node.h)||288;
      return point.x+w+20<=x || point.x>=x+width+20 ||
        point.y+h+20<=y || point.y>=y+height+20;
    });
    for(const candidate of start){
      const proposed={x:Math.round(candidate.x),y:Math.round(candidate.y)};
      if(free(proposed))return proposed;
    }
    const anchor=start[0]||{x:90,y:90};
    for(let index=1;index<=40;index++){
      const candidate={x:Math.round(anchor.x),y:Math.round(anchor.y+index*(h+32))};
      if(free(candidate))return candidate;
    }
    return {x:Math.round(anchor.x),y:Math.round(anchor.y)};
  }
  async function createRichNote(text,x,y,w=430,h=310,sourceNodeId=null){
    if(!projectId)throw Error('当前还没有打开画布项目');
    const rich=window.HamokiRichNote?.isRich(text)?text:
      window.HamokiRichNote?.fromPlain(text,sourceNodeId);
    if(!rich)throw Error('文字超过画布文本块允许的长度');
    const created=await api('/api/projects/'+projectId+'/notes',payload({text:rich,x,y,w,h}));
    selectedId=created.node?.id||null;
    await refresh();
    return created.node;
  }
  async function submitFromResultComposer(node,h,config) {
    const provider=state.providers.find(p=>p.id===config.providerId);
    if(!provider)throw Error('请先选择有效的中转商');
    if(provider.hasKey===false)throw Error('当前中转商尚未配置密钥，请先在设置里完成配置');
    if(!config.model||!String(config.model).trim())throw Error('请选择生图模型');
    if(!config.prompt||!config.prompt.trim())throw Error('请填写生成提示词');
    if(config.prompt.length>1000)throw Error('提示词最多1000字');
    if(config.ratio!=='auto'&&!NATIVE_RATIOS.includes(config.ratio))
      throw Error('模型比例不在当前原生生成器支持范围内');
    if(!['1K','2K','4K'].includes(config.resolution))throw Error('不支持该分辨率');
    if(![1,2,4].includes(config.count))throw Error('每次最多生成4张图片');
    if(config.transparentBg && (provider.mode!=='openai'||(provider.imageMode||'images')!=='images'))
      throw Error('透明背景需要支持 OpenAI Images 的中转站；请选择普通输出或换模型');
    if(config.outpaint&&(
      provider.mode!=='openai'||(provider.imageMode||'images')!=='images'||
      !config.mask||!config.maskSourceImage||!config.outpaintRect
    ))throw Error('真正的 AI 扩图需要原图画布与蒙版，并使用支持 Images Edits 的模型');
    const refs=(config.references||[]).filter(r=>r.file).map(r=>r.file);
    const hasCurrent=!!config.includeSource;
    if(refs.length+(hasCurrent?1:0)>5)throw Error('本次最多5张参考图片');
    if(refs.some(f=>!['image/png','image/jpeg','image/webp'].includes(f.type)||!f.size||f.size>12*1024*1024))
      throw Error('仅允许单张不超过12MB的PNG/JPG/WebP参考图');
    if(refs.reduce((sum,f)=>sum+f.size,0)>40*1024*1024)
      throw Error('上传参考图不能超过40MB');
    // 自适应（auto）：优先跟随首张参考图的比例，没有参考图时跟随原图，再退回 1:1。
    let ratio=config.ratio;
    if(ratio==='auto'){
      let objectUrl=null;
      try{
        let src=null;
        if(refs.length){objectUrl=URL.createObjectURL(refs[0]);src=objectUrl;}
        else if(hasCurrent)src=h.url||h.previewUrl||null;
        if(src){
          const [w,hh]=await imageDims(src);
          ratio=nearestRatio(w,hh);
          toast('自适应比例：已按参考图选择最接近的 '+ratio);
        }else ratio='1:1';
      }catch(error){
        ratio='1:1';
        toast('自适应比例失败：'+error.message+'，已改用 1:1',true);
      }finally{
        if(objectUrl)URL.revokeObjectURL(objectUrl);
      }
    }
    // Send via the SAME local /api/jobs as the right-hand generator, without
    // mutating or clearing any prompt or references the user already has there.
    const dataRefs=await Promise.all(refs.map(fileData));
    const request={
      prompt:String(config.prompt).trim(),
      projectId,
      targets:[{providerId:provider.id,model:String(config.model).trim()}],
      ratio,resolution:config.resolution,count:config.count,quality:config.quality||'auto',
      customSize:config.customSize||null,
      transparentBg:!!config.transparentBg,
      ...(config.outpaint?{
        mask:config.mask,maskSourceImage:config.maskSourceImage,
        outpaintRect:config.outpaintRect
      }:{}),
      references:dataRefs,sourceId:hasCurrent?h.id:null,
      sourceNodeId:hasCurrent?node.id:null,
      canvasX:Math.round(config.outpaint?node.x:node.x+node.w+36),
      canvasY:Math.round(config.outpaint?node.y+node.h+36:node.y),
      editMode:'new'
    };
    const accepted=await api('/api/jobs',payload(request));
    if(!Array.isArray(accepted.jobs)||accepted.jobs.length!==config.count)
      throw Error('队列未返回预期任务，请检查队列再决定是否重试，避免重复扣费');
    try{await window.loadJobs?.();}catch(e){console.debug('队列稍后刷新',e);}
    // Same opening behaviour as the right-hand generator: 100% on the new blank slot.
    window.HamokiGenerationFrames?.reveal(accepted.jobs[0]);
    toast('已加入生成队列 '+accepted.jobs.length+' 张；右侧原参考图和提示词未改变');
    return true;
  }
  function generatedCard(node,h,picture) {
    const shell=make('div','generated-result-card');
    if(!window.HamokiFloatingComposer?.create){
      toast('悬浮生成器尚未加载，请刷新页面',true);
      return shell;
    }
    const parts=window.HamokiFloatingComposer.create({
      picture,history:h,nodeId:node.id,imageTitle:resolveCanvasRef(node.id)?.title,
      sourceWidth:node.pixelWidth,sourceHeight:node.pixelHeight,
      initialPrompt:cardPrompt(h),resolveCanvasRef,
      onRevealRef:revealCanvasNode,
      getProviders:()=>state.providers||[],
      activeProviderId:()=>document.getElementById('provider-select')?.value||state.activeProviderId,
      toast,
      onClose:()=>focusNode(null),
      onDraft:text=>{
        cardDrafts.set(h.id,text);
        try{localStorage.setItem(cardDraftKey(h),text);}catch(e){}
      },
      onGenerate:config=>submitFromResultComposer(node,h,config),
      onAction:async(action,ui)=>{
        if(action==='download'){
          const link=make('a');
          link.href=picture;link.download='Hamoki-'+h.id+'.png';
          document.body.append(link);link.click();link.remove();return;
        }
        if(action==='reference'||action==='reuse'){
          // The composer starts blank, so fall back to the historical prompt.
          const promptText=action==='reference'?'':((ui.prompt||'').trim()||h.editInstruction||h.prompt||'');
          return bringToGenerator(node,h,action==='reference'?'reference':'replay',promptText);
        }
        if(action==='reverse'){
          if(!await window.HamokiGlassUI.confirm('图片反推需要调用视觉模型，可能产生费用。确定继续吗？',{title:'确认调用视觉模型',confirmLabel:'确认调用'}))return false;
          return reverseGeneratedImage(node,h,ui.textarea,ui.statusEl);
        }
        if(action==='grid'||action==='rotate'||action==='mirror'){
          return saveDerivedImage(node,h,action);
        }
        if(['crop','trim-edge','auto-crop','resize','grid9'].includes(action)){
          return runLocalImageAction(node,h,action);
        }
        if(action==='library')return saveGeneratedAsAsset(node,h);
        if(action==='delete')return deleteNode(node.id);
      }
    });
    shell.append(parts.toolbar,parts.editor);
    shell.cleanup=parts.cleanup;
    return shell;
  }
  // Floating controls live outside the scaled canvas, just like the original
  // selection toolbar. They never consume image layout space or clip at card edges.
  let resultPopovers=null, resultPositionFrame=0, resultFloatLayer=null;
  let lastPromptTarget='floating', mainRichPrompt=null;
  const mainRefEntries=new Map();
  async function appendCanvasToMain(item) {
    const input=document.getElementById('prompt-input');
    if(!input){toast('提示词输入框尚未准备好',true);return false;}
    const apiRefs=window.HamokiReferences;
    if(!apiRefs?.add||!apiRefs?.files){toast('参考图模块尚未准备好',true);return false;}
    if(mainRefEntries.has(item.id) && state.referenceImages?.some(ref=>ref.id===mainRefEntries.get(item.id))){
      toast('这张图片已经在参考图列表里');return false;
    }
    if(apiRefs.files().length>=5){toast('参考图最多5张，请先移除一张',true);return false;}
    try{
      const r=await fetch(item.url,{credentials:'same-origin'});
      if(!r.ok)throw Error('无法读取画布原图');
      const blob=await r.blob();
      const type=['image/png','image/jpeg','image/webp'].includes(blob.type)?blob.type:'image/png';
      const suffix=type==='image/jpeg'?'jpg':type==='image/webp'?'webp':'png';
      const file=new File([blob],(item.title||'画布引用').slice(0,50)+'.'+suffix,{type});
      if(!file.size||file.size>12*1024*1024)throw Error('参考图必须小于12MB');
      if(apiRefs.add([file])!==1)throw Error('右侧参考图区域没有接收这张图片');
      const newEntry=state.referenceImages?.[state.referenceImages.length-1];
      if(newEntry)mainRefEntries.set(item.id,newEntry.id);
      // Do not touch the prompt editor: image references belong only to the
      // dedicated thumbnail list, not the user's editable prompt content.
      toast('已将这张图添加为参考图；提示词保持不变');
      return true;
    }catch(error){toast('加入图片引用失败：'+error.message,true);return false;}
  }
  async function attachCanvasByAt(node) {
    const item=resolveCanvasRef(node.id);
    if(!item){toast('此图片没有可用的原图资源',true);return;}
    if(lastPromptTarget==='main'||!resultPopovers?.editor?.__addCanvasReference){
      await appendCanvasToMain(item);
    }else{
      const result=await resultPopovers.editor.__addCanvasReference(item,{appendChip:false});
      if(result)toast('已引用原图；提示词保持不变');
    }
  }
  const clampFloat=(value,min,max)=>Math.max(min,Math.min(max,value));
  const resultMotionReasons=new Set();
  let resultMotionSettling=false;
  let resultMotionResumeTimer=0, resultViewportIdleTimer=0;
  function hideResultPopovers(){
    if(!resultPopovers)return;
    resultPopovers.toolbar.style.visibility='hidden';
    resultPopovers.editor.style.visibility='hidden';
  }
  function beginResultMotion(reason='canvas'){
    clearTimeout(resultMotionResumeTimer);
    resultMotionResumeTimer=0;
    resultMotionSettling=true;
    resultMotionReasons.add(reason);
    hideResultPopovers();
  }
  function endResultMotion(reason='canvas'){
    resultMotionReasons.delete(reason);
    if(resultMotionReasons.size)return;
    clearTimeout(resultMotionResumeTimer);
    resultMotionResumeTimer=setTimeout(()=>{
      resultMotionResumeTimer=0;
      if(!resultMotionReasons.size){
        resultMotionSettling=false;
        scheduleResultPosition();
      }
    },110);
  }
  function noteViewportMotion(){
    if(!resultPopovers)return;
    beginResultMotion('viewport');
    clearTimeout(resultViewportIdleTimer);
    resultViewportIdleTimer=setTimeout(()=>{
      resultViewportIdleTimer=0;
      endResultMotion('viewport');
    },135);
  }
  function closeResultPopovers() {
    clearTimeout(resultMotionResumeTimer);
    clearTimeout(resultViewportIdleTimer);
    resultMotionResumeTimer=resultViewportIdleTimer=0;
    resultMotionReasons.clear();
    resultMotionSettling=false;
    if(resultPositionFrame)cancelAnimationFrame(resultPositionFrame);
    resultPositionFrame=0;
    resultPopovers?.observer?.disconnect();
    resultPopovers?.cleanup?.();
    resultPopovers?.toolbar?.remove();
    resultPopovers?.editor?.remove();
    resultFloatLayer?.remove();
    resultFloatLayer=null;
    resultPopovers=null;
  }
  function ensureCanvasFloatLayer(viewport){
    if(resultFloatLayer)return resultFloatLayer;
    const layer=document.createElement('div');
    layer.id='hamoki-canvas-float-layer';
    layer.setAttribute('aria-label','画布内的图片操作浮层');
    document.body.appendChild(layer);
    resultFloatLayer=layer;
    return layer;
  }
  function scheduleResultPosition() {
    if(resultPositionFrame)return;
    resultPositionFrame=requestAnimationFrame(()=>{
      resultPositionFrame=0;
      positionResultPopovers();
    });
  }
  function positionResultPopovers() {
    if(!resultPopovers)return;
    const {nodeId,toolbar,editor}=resultPopovers;
    if(resultMotionReasons.size||resultMotionSettling){
      hideResultPopovers();
      return;
    }
    const viewport=document.getElementById('canvas-viewport');
    const card=[...document.querySelectorAll('.canvas-node[data-id]')].find(c=>c.dataset.id===nodeId);
    if(!viewport || !card || document.body.classList.contains('hamoki-templates-mode')) {
      toolbar.style.visibility='hidden';editor.style.visibility='hidden';return;
    }
    const r=card.getBoundingClientRect(),board=viewport.getBoundingClientRect();
    const layer=ensureCanvasFloatLayer(viewport);
    layer.style.left=Math.round(board.left)+'px';
    layer.style.top=Math.round(board.top)+'px';
    layer.style.width=Math.max(1,Math.round(board.width))+'px';
    layer.style.height=Math.max(1,Math.round(board.height))+'px';
    if(r.right<board.left+5||r.left>board.right-5||r.bottom<board.top+5||r.top>board.bottom-5){
      toolbar.style.visibility='hidden';editor.style.visibility='hidden';return;
    }
    const left=board.left+10;
    const right=board.right-10;
    const top=Math.max(8,board.top+10);
    let bottom=Math.min(innerHeight-8,board.bottom-10);
    const queue=document.getElementById('queue-panel');
    if(queue){const q=queue.getBoundingClientRect();if(q.top>top+100&&q.top<bottom)bottom=q.top-8;}
    const space=Math.max(165,right-left);
    toolbar.style.maxWidth=space+'px';
    toolbar.style.visibility='visible';
    editor.style.setProperty('--composer-max-width',Math.max(220,space)+'px');
    editor.style.width=Math.min(660,space)+'px';
    editor.style.maxHeight=Math.max(130,bottom-top-10)+'px';
    const tw=toolbar.offsetWidth,th=toolbar.offsetHeight;
    const ew=editor.offsetWidth,eh=editor.offsetHeight;
    const center=(r.left+r.right)/2,gap=11;
    // The upper toolbar always belongs ABOVE the selected image.
    // Never flip below or move beside it when the infinite canvas is near an edge.
    const tx=clampFloat(center-tw/2,left,Math.max(left,right-tw));
    const ty=r.top-th-gap;
    toolbar.style.left=Math.round(tx-board.left)+'px';
    toolbar.style.top=Math.round(ty-board.top)+'px';
    // Follow the selected image exactly: no viewport-centered bottom dock.
    // The same frame scheduler is invoked by image drag, resize, pan and zoom.
    const attachGap=7;
    // Keep the SAME horizontal offset that was chosen at selection time.
    // Recomputing center-ew/2 and clamping on every frame makes a wide
    // editor appear stationary while the picture moves near the canvas edge.
    if(!Number.isFinite(resultPopovers.anchorOffsetX)){
      // Reserve a little horizontal motion at both boundaries so an
      // image close to the right/left side does not make the popup stick.
      const maxX=Math.max(left,right-ew);
      const travel=Math.max(0,maxX-left);
      const reserve=Math.min(52,travel/3);
      const startingX=clampFloat(center-ew/2,left+reserve,Math.max(left+reserve,maxX-reserve));
      resultPopovers.anchorOffsetX=startingX-center;
    }
    const ex=clampFloat(center+resultPopovers.anchorOffsetX,left,Math.max(left,right-ew));
    // The lower composer always belongs BELOW the image, regardless of how
    // little screen space is left. Users pan the infinite canvas themselves.
    const ey=r.bottom+attachGap;
    editor.classList.remove('result-editor-docked');
    editor.style.left=Math.round(ex-board.left)+'px';
    editor.style.top=Math.round(ey-board.top)+'px';
    editor.style.visibility='visible';
  }
  function renderResultPopovers(force=false) {
    const node=projectNodes.find(n=>n.id===selectedId && n.kind==='generated');
    const history=node&&findHistory(node.historyId);
    if(!history||!document.querySelector('.canvas-node[data-id="'+selectedId+'"]')) {
      closeResultPopovers();return;
    }
    if(!force&&resultPopovers?.nodeId===node.id){scheduleResultPosition();return;}
    closeResultPopovers();
    const parts=generatedCard(node,history,urlFor(node));
    const toolbar=parts.querySelector('.generated-result-toolbar');
    const editor=parts.querySelector('.generated-result-editor');
    toolbar.classList.add('result-floating-toolbar');
    editor.classList.add('result-floating-editor');
    toolbar.setAttribute('role','toolbar');
    toolbar.setAttribute('aria-label','所选生成图片的操作工具');
    editor.setAttribute('role','region');
    editor.setAttribute('aria-label','所选图片的完整生成参数与提示词编辑器');
    toolbar.style.visibility=editor.style.visibility='hidden';
    ensureCanvasFloatLayer(document.getElementById('canvas-viewport')).append(toolbar,editor);
    resultPopovers={nodeId:node.id,toolbar,editor,observer:null,anchorOffsetX:null,cleanup:parts.cleanup};
    if(typeof ResizeObserver==='function'){
      const observer=new ResizeObserver(scheduleResultPosition);
      observer.observe(editor);
      const viewport=document.getElementById('canvas-viewport');
      if(viewport)observer.observe(viewport);
      resultPopovers.observer=observer;
    }
    editor.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.stopPropagation();focusNode(null);}
    });
    scheduleResultPosition();
  }
  function renderSourceLinks(area) {
    const old=area.querySelector('.generated-source-lines');if(old)old.remove();
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('class','generated-source-lines');
    svg.setAttribute('aria-hidden','true');
    const cards=new Map([...area.querySelectorAll('.canvas-node[data-id]')].map(c=>[c.dataset.id,c]));
    const rendered=new Set(cards.keys());
    const geometry=n=>{
      const c=cards.get(n.id);
      return c?{x:parseFloat(c.style.left)||0,y:parseFloat(c.style.top)||0,w:c.offsetWidth||n.w||288,h:c.offsetHeight||n.h||288}
        :{x:Number(n.x)||0,y:Number(n.y)||0,w:Number(n.w)||288,h:Number(n.h)||288};
    };
    const joined=new Set();
    const addRelatedLine=(source,node)=>{
      if(!source||source.id===node.id)return;
      if(!rendered.has(source.id)||!rendered.has(node.id))return;
      const key=source.id+':'+node.id;
      if(joined.has(key))return;
      joined.add(key);
      const a=geometry(source),b=geometry(node);
      const ax=a.x+a.w/2,ay=a.y+a.h/2,bx=b.x+b.w/2,by=b.y+b.h/2;
      const vertical=Math.abs(by-ay)>Math.abs(bx-ax)*.7;
      let x1,y1,x2,y2,d;
      if(vertical){
        const down=by>=ay;
        x1=ax;y1=down?a.y+a.h:a.y;
        x2=bx;y2=down?b.y:b.y+b.h;
        const bend=(down?1:-1)*Math.max(24,Math.abs(y2-y1)*.42);
        d=`M ${x1} ${y1} C ${x1} ${y1+bend} ${x2} ${y2-bend} ${x2} ${y2}`;
      }else{
        const right=bx>=ax;
        x1=right?a.x+a.w:a.x;y1=ay;
        x2=right?b.x:b.x+b.w;y2=by;
        const bend=(right?1:-1)*Math.max(24,Math.abs(x2-x1)*.42);
        d=`M ${x1} ${y1} C ${x1+bend} ${y1} ${x2-bend} ${y2} ${x2} ${y2}`;
      }
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d',d);
      path.setAttribute('class','generated-source-path related-source-path');
      path.dataset.from=source.id;path.dataset.to=node.id;
      svg.append(path);
    };
    // Local crop/resize/transparent-background outputs are reference nodes,
    // but they still have an exact parent and must draw a lineage connection.
    for(const node of projectNodes){
      if(!node.parentNodeId||!rendered.has(node.id))continue;
      addRelatedLine(projectNodes.find(n=>n.id===node.parentNodeId),node);
    }
    for(const node of projectNodes) {
      if(node.kind!=='generated'||!rendered.has(node.id))continue;
      const h=findHistory(node.historyId);if(!h)continue;
      for(const source of sourceReferences(h)) {
        addRelatedLine(source,node);
      }
    }
    // Each reverse-prompt note remembers the exact image that was analyzed.
    // These connections share world coordinates with image reference paths.
    for(const note of projectNodes){
      if(note.kind!=='note'||!rendered.has(note.id))continue;
      const sourceId=window.HamokiRichNote?.sourceId(note.text);
      if(!sourceId)continue;
      const image=projectNodes.find(n=>n.id===sourceId&&n.kind!=='note');
      if(!image||!urlFor(image)||!rendered.has(image.id)||!rendered.has(note.id))continue;
      const a=geometry(image),b=geometry(note);
      const centerA={x:a.x+a.w/2,y:a.y+a.h/2};
      const centerB={x:b.x+b.w/2,y:b.y+b.h/2};
      const horizontal=Math.abs(centerB.x-centerA.x)/(a.w+b.w)>=
        Math.abs(centerB.y-centerA.y)/(a.h+b.h);
      let x1,y1,x2,y2,control;
      if(horizontal){
        const right=centerB.x>=centerA.x;
        x1=right?a.x+a.w:a.x;y1=centerA.y;
        x2=right?b.x:b.x+b.w;y2=centerB.y;
        const step=(right?1:-1)*Math.max(34,Math.abs(x2-x1)*.44);
        control='C '+(x1+step)+' '+y1+' '+(x2-step)+' '+y2+' '+x2+' '+y2;
      }else{
        const down=centerB.y>=centerA.y;
        x1=centerA.x;y1=down?a.y+a.h:a.y;
        x2=centerB.x;y2=down?b.y:b.y+b.h;
        const step=(down?1:-1)*Math.max(34,Math.abs(y2-y1)*.44);
        control='C '+x1+' '+(y1+step)+' '+x2+' '+(y2-step)+' '+x2+' '+y2;
      }
      const line=document.createElementNS('http://www.w3.org/2000/svg','path');
      line.setAttribute('d','M '+x1+' '+y1+' '+control);
      line.setAttribute('class','reverse-source-path');
      line.dataset.from=image.id;
      line.dataset.to=note.id;
      svg.append(line);
      const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');
      dot.setAttribute('class','reverse-source-origin');
      dot.setAttribute('cx',x1);dot.setAttribute('cy',y1);dot.setAttribute('r','4');
      svg.append(dot);
    }
    if(svg.childNodes.length)area.prepend(svg);
  }

  function renderCanvas(mode='full') {
    const area = canvas();
    if (!area || dragging) return;
    const incremental=mode==='viewport';
    const oldCards=incremental
      ?new Map([...area.querySelectorAll('.canvas-node[data-id]')].map(card=>[card.dataset.id,card]))
      :new Map();
    // Remove legacy folded-image controls during incremental redraws too.
    area.querySelectorAll('.canvas-derived-stack').forEach(control=>control.remove());
    if(!incremental){
      canvasPreviewObserver?.disconnect();
      window.HamokiRichNote?.resetNodes();
      area.replaceChildren();
    }
    const display=canvasDisplayModel(),keepNodes=new Set();
    canvasViewportSignature=display.signature;
    if (!projectNodes.length) {
      closeResultPopovers();
      window.HamokiGenerationFrames?.mount(area);
      if (!area.querySelector('.generation-frame')) {
        area.append(make('div','canvas-welcome','画布还没有素材：可以直接 Ctrl+V 粘贴参考图，也可以生成图片或在素材库中上传。'));
      }
      window.HamokiViewport?.syncBounds();
      window.HamokiReturnNodes?.sync?.();
      return;
    }
    // Legacy artworks have no stored title/size: number them in creation order
    // and let the image itself report its real pixel size once it loads.
    const generatedOrder = new Map(
      [...projectNodes].filter(node => node.kind === 'generated')
        .sort((a,b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || 0)
        .map((node,index) => [node.id,index + 1]));
    for (const node of display.nodes) {
      const picture = urlFor(node);
      if (!picture && node.kind !== 'note') continue;
      keepNodes.add(node.id);
      const existing=oldCards.get(node.id);
      if(existing){
        existing.classList.toggle('selected',selectedNodeIds.has(node.id));
        continue;
      }
      const card = make('article','canvas-node' + (node.id === selectedId ? ' selected' : ''));
      card.dataset.id = node.id;
      card.style.left = (Number(node.x) || 0) + 'px';
      card.style.top = (Number(node.y) || 0) + 'px';
      card.style.width = (Number(node.w) || 288) + 'px';
      card.style.height = (Number(node.h) || 288) + 'px';
      card.tabIndex = 0;
      card.classList.toggle('selected',selectedNodeIds.has(node.id));
      card.classList.add('canvas-node-appear');
      // A non-interactive SVG draws one continuous outline from the top-left corner.
      // Keep it inside the card: canvas dragging, resize handles and click targets remain unchanged.
      if (node.kind !== 'note') {
        const trace = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        trace.classList.add('canvas-border-trace');
        trace.setAttribute('aria-hidden', 'true');
        trace.setAttribute('focusable', 'false');
        const border = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        border.setAttribute('pathLength', '100');
        trace.append(border);
        card.append(trace);
      }
      if (node.kind !== 'note') card.title='单击选中，Ctrl+C 复制图片，Ctrl+V 在画布粘贴副本';
      if (node.kind === 'note') {
        card.classList.add('canvas-note');
        const rich=window.HamokiRichNote?.mount(card,node,{
          toast,
          saveText:text=>api('/api/projects/'+projectId+'/nodes/'+node.id,{
            method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})
          }),
          saveGeometry:changes=>api('/api/projects/'+projectId+'/nodes/'+node.id,{
            method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(changes)
          })
        });
        if(!rich){
          const body = make('p','',node.text || '双击编辑便签');
          card.append(body);
          card.addEventListener('dblclick',async () => {
            const text = prompt('编辑便签',node.text || '');
            if (text === null) return;
            try {
              const res = await api('/api/projects/'+projectId+'/nodes/'+node.id,
                {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
              node.text = res.node?.text || text;body.textContent = node.text;
            } catch(e){toast('保存便签失败：'+e.message,true);}
          });
        }
      } else if (node.kind === 'generated' && findHistory(node.historyId)) {
        card.classList.add('generated-result-node');
        card.title='单击选中弹出操作栏，双击查看原图；可自由拖动和缩放';
        const image=make('img','canvas-node-image');
        watchCanvasImage(image,node,picture);image.alt='生成作品';image.draggable=false;
        const caption=make('div','canvas-node-caption');
        caption.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3.5"/><path d="m6.2 16.6 4-4.6 3 3.2 2.2-2.3 3.4 3.9"/><circle cx="15.6" cy="8.6" r="1.6" fill="currentColor" stroke="none"/></svg>';
        const artworkName=make('span','canvas-node-name',node.title||('图片生成'+(generatedOrder.get(node.id)||1)));
        const artworkSize=make('span','canvas-node-size','');
        caption.append(artworkName,artworkSize);
        const showPixelSize=(width,height)=>{
          if(Number.isFinite(Number(width))&&Number.isFinite(Number(height))&&Number(width)>0&&Number(height)>0)
            artworkSize.textContent=Math.round(Number(width))+' × '+Math.round(Number(height));
        };
        // New nodes carry the exact pixel size; older artworks fill it in on load.
        showPixelSize(node.pixelWidth,node.pixelHeight);
        // A preview is 480px or smaller, never label it as original size.
        card.append(caption);
        card.append(image);
        card.addEventListener('dblclick',event=>{
          if(event.target.closest('button,input,textarea,select,[contenteditable]'))return;
          event.preventDefault();event.stopPropagation();
          if(!window.HamokiCanvasOriginalPreview?.open(picture,card))
            toast('原图预览暂不可用',true);
        });
      } else {
        const img = make('img','canvas-node-image');
        watchCanvasImage(img,node,picture);img.alt = node.title || '画布素材';img.draggable = false;card.append(img);
        card.addEventListener('dblclick', event => {
          if(event.target.closest('button,input,textarea,select,[contenteditable]'))return;
          event.preventDefault();event.stopPropagation();
          if(!window.HamokiCanvasOriginalPreview?.open(picture,card))
            toast('原图预览暂不可用',true);
        });
      }
      if(node.kind!=='note' && picture) {
        const downloadButton=make('button','canvas-node-download');
        downloadButton.type='button';
        downloadButton.title='一键下载原始图片';
        downloadButton.setAttribute('aria-label','下载这张图片的原图');
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('viewBox','0 0 24 24');
        svg.setAttribute('width','17');
        svg.setAttribute('height','17');
        svg.setAttribute('fill','none');
        svg.setAttribute('stroke','currentColor');
        svg.setAttribute('stroke-width','2');
        svg.setAttribute('stroke-linecap','round');
        svg.setAttribute('stroke-linejoin','round');
        const tray=document.createElementNS('http://www.w3.org/2000/svg','path');
        tray.setAttribute('d','M4.5 18.5v2.5h15v-2.5');
        const arrow=document.createElementNS('http://www.w3.org/2000/svg','path');
        arrow.setAttribute('d','M12 3v11.5m0 0 4.4-4.4M12 14.5 7.6 10.1');
        arrow.setAttribute('stroke','#74D2A4');
        svg.append(tray,arrow);
        downloadButton.append(svg);
        downloadButton.addEventListener('pointerdown',event=>event.stopPropagation());
        downloadButton.addEventListener('mousedown',event=>event.stopPropagation());
        downloadButton.addEventListener('dblclick',event=>{event.preventDefault();event.stopPropagation();});
        downloadButton.addEventListener('click',event=>{
          event.preventDefault();event.stopPropagation();
          void downloadCanvasImage(node,downloadButton);
        });
        card.append(downloadButton);
        const refButton=make('button','canvas-node-at','@');
        refButton.type='button';
        refButton.title='将此图片引用插入当前提示词';
        refButton.setAttribute('aria-label','@ 引用这张图片到当前提示词');
        refButton.addEventListener('pointerdown',event=>event.stopPropagation());
        refButton.addEventListener('dblclick',event=>{event.preventDefault();event.stopPropagation();});
        refButton.addEventListener('click',event=>{
          event.preventDefault();event.stopPropagation();
          void attachCanvasByAt(node);
        });
        card.append(refButton);
      }
      const footer = make('div','canvas-node-foot');
      footer.append(make('span','',node.kind === 'generated' ? '生成作品' : node.kind === 'note' ? '备注' : '参考图片'));
      const remove = make('button','canvas-node-delete','×');
      remove.type='button';remove.title='从画布移除（原图和历史保留）';
      remove.addEventListener('click', ev => {ev.stopPropagation(); deleteNode(node.id);});
      footer.append(remove);card.append(footer);
for (const direction of ['nw','n','ne','e','se','s','sw','w']) {
        const grip=make('button','canvas-selection-handle');
        grip.type='button';
        grip.dataset.direction=direction;
        grip.setAttribute('aria-label','拖动调整图片尺寸 '+direction);
        grip.addEventListener('pointerdown', ev => {
          if (ev.button!==0) return;
          ev.preventDefault();
          ev.stopPropagation();
          focusNode(node.id);
          dragging=true;
          beginResultMotion('resize');
          const pointer=ev.pointerId;
          const initial={x:Number(node.x)||0,y:Number(node.y)||0,w:Number(node.w)||288,h:Number(node.h)||288};
          const startX=ev.clientX,startY=ev.clientY;
          let changed=false,updated={...initial};
          grip.setPointerCapture(pointer);
          const update=event=>{
            if(event.pointerId!==pointer)return;
            const dx=(event.clientX-startX)/(state.zoom||1);
            const dy=(event.clientY-startY)/(state.zoom||1);
            let {x,y,w,h}=initial;
            if(direction.includes('e'))w=Math.min(1200,Math.max(120,initial.w+dx));
            if(direction.includes('w')){w=Math.min(1200,Math.max(120,initial.w-dx));x=initial.x+initial.w-w;}
            if(direction.includes('s'))h=Math.min(1200,Math.max(120,initial.h+dy));
            if(direction.includes('n')){h=Math.min(1200,Math.max(120,initial.h-dy));y=initial.y+initial.h-h;}
            updated={x:Math.round(x),y:Math.round(y),w:Math.round(w),h:Math.round(h)};
            changed=Object.keys(initial).some(k=>updated[k]!==initial[k]);
            for(const k of ['x','y'])card.style[k==='x'?'left':'top']=updated[k]+'px';
            card.style.width=updated.w+'px';card.style.height=updated.h+'px';
            window.HamokiViewport?.syncBounds();renderSourceLinks(area);scheduleResultPosition();
          };
          const finish=async event=>{
            if(event.pointerId!==pointer)return;
            grip.removeEventListener('pointermove',update);
            grip.removeEventListener('pointerup',finish);
            grip.removeEventListener('pointercancel',finish);
            dragging=false;
            endResultMotion('resize');
            if(!changed||event.type==='pointercancel') {
              for(const k of ['x','y'])card.style[k==='x'?'left':'top']=initial[k]+'px';
              card.style.width=initial.w+'px';card.style.height=initial.h+'px';
              return;
            }
            try{
              await api('/api/projects/'+projectId+'/nodes/'+node.id,{
                method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(updated)
              });
              Object.assign(node,updated);
              rememberGeometry(node.id,initial,updated);
            }catch(error){toast('保存尺寸失败：'+error.message,true);refresh();}
          };
          grip.addEventListener('pointermove',update);
          grip.addEventListener('pointerup',finish);
          grip.addEventListener('pointercancel',finish);
        });
        card.append(grip);
      }

      card.addEventListener('pointerdown', ev => {
        cancelSelectionCenter();
        if (ev.button !== 0 || ev.target.closest('button,input,textarea,select,[contenteditable]')) return;
        if(ev.shiftKey||ev.ctrlKey||ev.metaKey){
          ev.preventDefault();ev.stopPropagation();
          suppressCardClickId=node.id;
          focusNode(node.id,true);
          return;
        }
        const richNote=card.classList.contains('canvas-rich-node');
        // Preserve the natural click/dblclick sequence on rich-text bodies.
        // Pointer capture on pointerdown retargets both clicks to the article
        // and prevents browsers from recognizing a double-click on the text.
        if(!richNote)ev.preventDefault();
        ev.stopPropagation();
        focusNode(node.id);
        card.focus({preventScroll:true});
        dragging=true;
        beginResultMotion('drag');
        const pointer=ev.pointerId;
        const x=ev.clientX,y=ev.clientY;
        const initial={x:Number(node.x)||0,y:Number(node.y)||0,w:Number(node.w)||288,h:Number(node.h)||288};
        let moved=false,finished=false;
        if(!richNote)card.setPointerCapture(pointer);
        const move=e=>{
          if(e.pointerId!==pointer||finished)return;
          const dx=(e.clientX-x)/(state.zoom||1),dy=(e.clientY-y)/(state.zoom||1);
          if(Math.abs(dx)+Math.abs(dy)>3)moved=true;
          if(moved){
            if(richNote&&!card.hasPointerCapture(pointer)){
              try{card.setPointerCapture(pointer)}catch{}
            }
            card.style.left=Math.round(initial.x+dx)+'px';
            card.style.top=Math.round(initial.y+dy)+'px';
            window.HamokiViewport?.syncBounds();renderSourceLinks(area);scheduleResultPosition();
          }
        };
        const cleanup=()=>{
          const captureTarget=richNote?window:card;
          captureTarget.removeEventListener('pointermove',move);
          captureTarget.removeEventListener('pointerup',finish);
          captureTarget.removeEventListener('pointercancel',finish);
          window.removeEventListener('blur',cancel);
          if(card.hasPointerCapture(pointer))card.releasePointerCapture(pointer);
          dragging=false;
          endResultMotion('drag');
        };
        const cancel=()=>finish({pointerId:pointer,type:'pointercancel'});
        const finish=async e=>{
          if(e.pointerId!==pointer||finished)return;
          finished=true;
          cleanup();
          if(!moved||e.type==='pointercancel'){
            card.style.left=initial.x+'px';
            card.style.top=initial.y+'px';
            window.HamokiViewport?.syncBounds();
            if(!moved && e.type==='pointerup') scheduleSelectionCenter(node,card);
            return;
          }
          // Free drag: keep the exact dropped coordinates, do not force unwanted snapping.
          const nx=Math.round(initial.x+(e.clientX-x)/(state.zoom||1));
          const ny=Math.round(initial.y+(e.clientY-y)/(state.zoom||1));
          card.style.left=nx+'px';card.style.top=ny+'px';
          try {
            await api('/api/projects/'+projectId+'/nodes/'+node.id,
              {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({x:nx,y:ny})});
            node.x=nx;node.y=ny;
            rememberGeometry(node.id,initial,rectOf(node));
            window.HamokiViewport?.syncBounds();
          } catch(error) {
            card.style.left=initial.x+'px';card.style.top=initial.y+'px';
            toast('位置保存失败：'+error.message,true);refresh();
          }
        };
        const captureTarget=richNote?window:card;
        captureTarget.addEventListener('pointermove',move);
        captureTarget.addEventListener('pointerup',finish);
        captureTarget.addEventListener('pointercancel',finish);
        window.addEventListener('blur',cancel);
      });
      // Use a first-party contextual menu for image actions; leave text
      // editing, drag/resize and the blank canvas's normal behavior alone.
      if(picture && node.kind!=='note'){
        card.addEventListener('contextmenu',event=>{
          if(event.target.closest('input,textarea,select,[contenteditable]'))return;
          event.preventDefault();event.stopPropagation();
          focusNode(node.id);
          window.HamokiGlassUI?.menu({
            x:event.clientX,y:event.clientY,
            items:[
              {label:'下载原图',onClick:()=>downloadCanvasImage(node)},
              {label:'从画布删除',danger:true,onClick:()=>deleteNode(node.id)}
            ]
          });
        });
      }
      card.addEventListener('dblclick',cancelSelectionCenter,true);
      card.addEventListener('click',event=>{
        if(suppressCardClickId===node.id){suppressCardClickId=null;return;}
        // Pointer capture used for free dragging can suppress the native dblclick
        // on some browsers. The second click is a reliable fallback.
        if (event.detail >= 2 && picture && node.kind !== 'note' &&
            !event.target.closest('button,input,textarea,select,[contenteditable]')) {
          event.preventDefault();
          event.stopPropagation();
          cancelSelectionCenter();
          if (!window.HamokiCanvasOriginalPreview?.open(picture,card))
            toast('原图预览暂不可用',true);
          return;
        }
        focusNode(node.id);
        if(node.kind!=='note'&&event.detail<2 &&
           !event.target.closest('button,input,textarea,select,[contenteditable]'))
          carryPreviousPrompt(node);
        // Keyboard selection has no pointerup event.
        if(event.detail===0) scheduleSelectionCenter(node,card,0);
      });
      area.append(card);
    }
    if(incremental)for(const [id,card] of oldCards){
      if(keepNodes.has(id))continue;
      const image=card.querySelector('.canvas-node-image');
      if(image)canvasPreviewObserver?.unobserve(image);
      card.remove();
    }
    window.HamokiCanvasGroups?.render?.(area,{projectId,groups:projectGroups,nodes:projectNodes,bounds:worldViewport(),zoom:()=>state.zoom||1,refresh,toast,clearSelection:()=>focusNode(null)});
    renderSourceLinks(area);
    window.HamokiGenerationFrames?.mount(area);
    window.HamokiViewport?.syncBounds();
    if(incremental)renderResultPopovers();
    else renderResultPopovers(true);
    window.HamokiRichNote?.select(selectedId);
    updateMultiSelectionHud();
    window.HamokiReturnNodes?.sync?.();
  }
  async function deleteSelectedNodes(ids) {
    if(!projectId)return;
    const selected=[...new Set(ids)].filter(id=>projectNodes.some(n=>n.id===id));
    if(!selected.length)return;
    const multiple=selected.length>1;
    const singleNote=!multiple&&projectNodes.find(n=>n.id===selected[0])?.kind==='note';
    if(!await window.HamokiGlassUI.confirm(
      singleNote?'删除这张反推提示词面板？不会删除关联的原始图片。':
        multiple?'从画布移除选中的 '+selected.length+' 个元素？原图和生成历史不会删除。':
        '从画布移除此图片？原图和生成历史将保留。',
      {title:singleNote?'删除反推提示词面板':multiple?'批量移除画布元素':'移除画布图片',
        confirmLabel:multiple?'移除 '+selected.length+' 个':'移除',danger:true}))return;
    try{
      await api('/api/projects/'+projectId+'/nodes/selection',{
        method:'DELETE',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({nodeIds:selected})
      });
      focusNode(null);await refresh();
      toast('已从画布移除 '+selected.length+' 张 · 原图保留');
    }catch(error){toast('移除失败：'+error.message,true);}
  }
  async function deleteNode(id) {
    const group=selectedNodeIds.has(id)&&selectedNodeIds.size>1
      ?[...selectedNodeIds]:[id];
    return deleteSelectedNodes(group);
  }
  async function clearCanvas() {
    if (!projectId) return toast('画布尚未加载',true);
    if (!(await window.HamokiGlassUI.confirm('清空当前画布上的所有元素？已生成的历史作品仍会保留。',{title:'清空画布',confirmLabel:'清空画布',danger:true}))) return;
    try {
      await api('/api/projects/'+projectId+'/nodes',{method:'DELETE'});
      selectedId=null;await refresh();toast('画布已清空，作品历史未删除');
    } catch(e){toast('清空画布失败：'+e.message,true);}
  }
  async function addExisting(h) {
    if (!projectId) return;
    try {
      await api('/api/projects/'+projectId+'/nodes/from-history',payload({historyId:h.id}));
      await refresh();toast('已添加到画布');
    } catch(e){toast('添加失败：'+e.message,true);}
  }
  function header(title,subtitle) {
    const target=panel();
    target.replaceChildren();
    const head=make('div','panel-header');head.append(make('h2','',title));
    const content=make('div','panel-content works-panel');
    if (subtitle) content.append(make('p','works-description',subtitle));
    target.append(head,content);
    return content;
  }
  function workCard(h) {
    const box=make('article','work-card'),img=make('img','work-thumb');
    img.src=h.url;img.loading='lazy';img.alt='作品图片';
    const details=make('div','work-description');
    details.append(make('strong','',h.model||'生成作品'),make('small','',String(h.prompt||'').slice(0,85)));
    const actions=make('div','work-actions');
    const open=make('a','', '查看原图');open.href=h.url;open.target='_blank';open.rel='noopener noreferrer';
    open.addEventListener('click',event=>{
      if(window.HamokiCanvasOriginalPreview?.open(h.url,box))event.preventDefault();
    });
    const insert=make('button','', '放入画布');insert.type='button';insert.addEventListener('click',()=>addExisting(h));
    actions.append(open,insert);box.append(img,details,actions);
    return box;
  }
  async function showWorks() {
    const content=header('我的作品','这里是实际生成的历史图片，可以打开原图或放回自由画布。');
    const search=make('input','works-search');search.type='search';search.placeholder='搜索描述或模型';
    content.append(search);
    const gallery=make('div','works-grid');content.append(gallery);
    function list() {
      gallery.replaceChildren();
      const q=search.value.toLowerCase();
      const items=historyItems.filter(h=>h.projectId===projectId && (String(h.prompt||'')+' '+String(h.model||'')).toLowerCase().includes(q));
      if (!items.length) {gallery.append(make('p','works-description','没有符合条件的作品'));return;}
      for (const h of items.slice(0,100)) gallery.append(workCard(h));
    }
    search.addEventListener('input',list);list();
  }
  function fileData(file) {
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  }
  async function addReferenceFile(file) {
    if (!projectId) {
      await refresh();
      if (!projectId) throw Error('项目画布尚未加载');
    }
    if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>12*1024*1024) {
      throw Error('只支持不超过 12 MB 的 PNG、JPG、WebP 图片');
    }
    const viewport=document.getElementById('canvas-viewport');
    const zoom=state.zoom||1;
    const offset=(projectNodes.length%5)*26;
    const origin=window.HamokiViewport?.worldOrigin?.()||{left:0,top:0};
    const x=Math.round(((viewport?.scrollLeft||0)-origin.left+(viewport?.clientWidth||600)/2)/zoom-145+offset);
    const y=Math.round(((viewport?.scrollTop||0)-origin.top+(viewport?.clientHeight||450)/2)/zoom-145+offset);
    const result=await api('/api/projects/'+projectId+'/assets',payload({
      image:await fileData(file),name:file.name||'粘贴的参考图片',x,y,w:288,h:288
    }));
    selectedId=result.node?.id||selectedId;
    await refresh();
    toast('参考图片已从剪贴板加入画布，可直接拖动位置');
    return result.node;
  }
  async function duplicateFromClipboard(record) {
    if (!projectId || record?.projectId!==projectId) throw Error('只能复制当前项目中的图片');
    const original=projectNodes.find(n=>n.id===record.nodeId&&n.kind!=='note');
    if (!original) throw Error('原图片节点已不存在');
    record.pasteCount=(record.pasteCount||0)+1;
    const delta=44*record.pasteCount;
    const result=await api('/api/projects/'+projectId+'/nodes/duplicate',payload({
      sourceNodeId:original.id,x:(Number(original.x)||0)+delta,
      y:(Number(original.y)||0)+delta,w:original.w,h:original.h
    }));
    selectedId=result.node.id;
    await refresh();
    document.querySelector('.canvas-node[data-id="'+selectedId+'"]')?.focus({preventScroll:true});
    toast('已粘贴图片副本，可继续拖动（原图不变）');
    return result.node;
  }
  async function copySelectedImage() {
    const node=projectNodes.find(item=>item.id===selectedId&&item.kind!=='note');
    if (!node) return;
    try {
      const result=await window.HamokiImageClipboard.copy(urlFor(node),{
        projectId,nodeId:node.id,x:node.x,y:node.y,w:node.w,h:node.h,title:node.title
      });
      toast(result.system
        ? '图片已复制到系统剪贴板 · Ctrl+V 粘贴副本'
        : '浏览器限制了系统剪贴板，可尝试直接在画布按 Ctrl+V',!result.system);
    } catch(error){toast('复制图片失败：'+error.message,true);}
  }
  async function showLibrary() {
    const content=header('素材库','上传本地参考图后，图片将存入当前项目，并出现在中央画布上。');
    const label=make('label','library-upload','＋ 上传图片');
    const input=make('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.hidden=true;
    label.append(input);content.append(label);
    const result=make('p','works-description','');content.append(result);
    input.addEventListener('change',async()=>{
      const f=input.files?.[0];if (!f) return;
      if (!['image/png','image/jpeg','image/webp'].includes(f.type) || f.size>12*1024*1024){
        result.textContent='只支持不超过12MB的 PNG、JPG、WebP 图片';input.value='';return;
      }
      result.textContent='上传中…';
      try {await api('/api/projects/'+projectId+'/assets',payload({image:await fileData(f),name:f.name,x:200,y:160}));
        await refresh();toast('参考图片已添加');}
      catch(e){result.textContent='上传失败：'+e.message;}
    });
    const grid=make('div','works-grid');content.append(grid);
    const references=projectNodes.filter(n=>n.kind==='reference');
    if (!references.length) grid.append(make('p','works-description','还没有参考图片'));
    for(const ref of references) {
      const card=make('article','work-card');
      const image=make('img','work-thumb');image.src=ref.url;image.alt=ref.title||'参考素材';
      const title=make('div','work-description',ref.title||'参考图');
      const btn=make('button','', '从画布移除');btn.type='button';btn.addEventListener('click',()=>deleteNode(ref.id));
      card.append(image,title,btn);grid.append(card);
    }
  }
  async function addNote() {
    if (!projectId) return;
    try {
      const viewport=document.getElementById('canvas-viewport');
      const zoom=state.zoom||1;
      const origin=window.HamokiViewport?.worldOrigin?.()||{left:0,top:0};
      const parent=projectNodes.find(node=>node.id===selectedId);
      const position=chooseRichNoteLocation(parent,430,310);
      const x=position.x,y=position.y;
      await createRichNote('',x,y,430,310);
      // Immediately expose the new node instead of leaving it behind an image.
      window.HamokiViewport?.scrollToWorld?.(
        x+215-viewport.clientWidth/zoom/2,
        y+155-viewport.clientHeight/zoom/2,zoom);
      toast('已在画布中添加可编辑的提示词文本块');
    } catch(e){toast('添加文本块失败：'+e.message,true);}
  }
  function chooseView(view) {
    document.querySelectorAll('.nav-icon-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===view));
    state.currentView=view;
    if (view==='works') showWorks();
    if (view==='library') showLibrary();
  }
  function installCanvasMarquee(viewport) {
    if(!viewport)return;
    viewport.addEventListener('pointerdown',event=>{
      if(event.button!==0 || event.pointerType!=='mouse' || event.shiftKey)return;
      if(event.target.closest('.canvas-node,.canvas-derived-stack,.generation-frame,button,input,textarea,select,[contenteditable],.canvas-multi-hud'))return;
      const start={x:event.clientX,y:event.clientY},additive=event.ctrlKey||event.metaKey;
      const previouslySelected=new Set(selectedNodeIds);
      let rect=null,moved=false;
      const move=e=>{
        if(e.pointerId!==event.pointerId)return;
        if(!moved && Math.hypot(e.clientX-start.x,e.clientY-start.y)<5)return;
        moved=true;
        if(!rect){rect=make('div','canvas-marquee-selection');document.body.append(rect);}
        const box=viewport.getBoundingClientRect();
        const x0=Math.max(box.left,Math.min(start.x,e.clientX));
        const x1=Math.min(box.right,Math.max(start.x,e.clientX));
        const y0=Math.max(box.top,Math.min(start.y,e.clientY));
        const y1=Math.min(box.bottom,Math.max(start.y,e.clientY));
        Object.assign(rect.style,{left:x0+'px',top:y0+'px',
          width:Math.max(0,x1-x0)+'px',height:Math.max(0,y1-y0)+'px'});
      };
      const end=e=>{
        if(e.pointerId!==event.pointerId)return;
        window.removeEventListener('pointermove',move,true);
        window.removeEventListener('pointerup',end,true);
        window.removeEventListener('pointercancel',end,true);
        if(rect)rect.remove();
        if(!moved){if(!additive)focusNode(null);return;}
        const box=viewport.getBoundingClientRect();
        const x0=Math.max(box.left,Math.min(start.x,e.clientX));
        const y0=Math.max(box.top,Math.min(start.y,e.clientY));
        const x1=Math.min(box.right,Math.max(start.x,e.clientX));
        const y1=Math.min(box.bottom,Math.max(start.y,e.clientY));
        const chosen=additive?previouslySelected:new Set();
        if(e.type!=='pointercancel'&&x1>x0&&y1>y0){
          for(const card of document.querySelectorAll('#canvas .canvas-node[data-id]')){
            const r=card.getBoundingClientRect();
            if(r.left<x1&&r.right>x0&&r.top<y1&&r.bottom>y0)chosen.add(card.dataset.id);
          }
        }
        selectedNodeIds.clear();
        for(const id of chosen)selectedNodeIds.add(id);
        selectedId=selectedNodeIds.size===1?[...selectedNodeIds][0]:null;
        document.querySelectorAll('.canvas-node[data-id]').forEach(card=>
          card.classList.toggle('selected',selectedNodeIds.has(card.dataset.id)));
        renderResultPopovers();window.HamokiRichNote?.select(selectedId);
        updateMultiSelectionHud();
      };
      event.preventDefault();
      window.addEventListener('pointermove',move,true);
      window.addEventListener('pointerup',end,true);
      window.addEventListener('pointercancel',end,true);
    });
  }
  function canvasContextMenu(event) {
    // Keep native editing controls usable; customize the rest of the canvas.
    if((!event.target.closest('.canvas-note')&&event.target.closest('input,textarea,select,[contenteditable]')) ||
       document.querySelector('dialog[open]'))return;
    const inside=!!event.target.closest('#canvas-viewport');
    if(!inside&&state.currentView!=='image-generate')return;
    event.preventDefault();event.stopImmediatePropagation();
    const card=event.target.closest('.canvas-node[data-id]');
    const raw=card&&projectNodes.find(n=>n.id===card.dataset.id);
    const node=raw?.kind==='note'?null:raw;
    if(raw?.kind==='note'){
      window.HamokiGlassUI?.menu({x:event.clientX,y:event.clientY,items:[
        {label:'删除反推提示词面板',icon:'trash',danger:true,onClick:()=>deleteSelectedNodes([raw.id])},
        {label:'画布适应全屏',icon:'fit',onClick:()=>window.HamokiViewport?.fitSelection?.()},
        {label:'缩小到 50%',icon:'zoomout',onClick:()=>window.HamokiViewport?.animateZoomTo?.(.5,340)}
      ]});
      return;
    }
    if(node && !selectedNodeIds.has(node.id))focusNode(node.id);
    else if(inside&&!node)focusNode(null);
    const count=selectedNodeIds.size,items=[];
    if(node){
      items.push({label:'下载原图',icon:'download',
        onClick:()=>downloadCanvasImage(node)});
      items.push({label:count>1?'删除选中的 '+count+' 张':'删除图片',icon:'trash',danger:true,
        onClick:()=>deleteSelectedNodes(count>1?[...selectedNodeIds]:[node.id])});
    }
    items.push({label:count?'图片适应全屏':'画布适应全屏',icon:'fit',
      onClick:()=>window.HamokiViewport?.fitSelection?.()});
    items.push({label:'缩小到 50%',icon:'zoomout',
      onClick:()=>window.HamokiViewport?.animateZoomTo?.(.5,340)});
    window.HamokiGlassUI?.menu({x:event.clientX,y:event.clientY,items});
  }
  document.addEventListener('DOMContentLoaded',()=>{
    refresh();
    document.addEventListener('focusin',event=>{
      if(event.target.matches?.('#prompt-input,.hamoki-main-rich-prompt'))
        lastPromptTarget='main';
      else if(event.target.closest?.('.result-rich-prompt,.result-composer-compact .generated-result-prompt'))
        lastPromptTarget='floating';
    });
    document.addEventListener('hamoki-reference-removed',event=>{
      for(const [nodeId,refEntryId] of mainRefEntries){
        if(refEntryId!==event.detail?.id)continue;
        mainRefEntries.delete(nodeId);
        mainRichPrompt?.remove(nodeId,{notify:false});
      }
    });
    const boardViewport=document.getElementById('canvas-viewport');
    installCanvasMarquee(boardViewport);
    document.addEventListener('contextmenu',canvasContextMenu,true);
    boardViewport?.addEventListener('pointerdown',cancelSelectionCenter,true);
    boardViewport?.addEventListener('wheel',cancelSelectionCenter,{passive:true,capture:true});
    boardViewport?.addEventListener('scroll',noteViewportMotion,{passive:true});
    boardViewport?.addEventListener('wheel',noteViewportMotion,{passive:true});
    boardViewport?.addEventListener('scroll',scheduleVirtualCanvas,{passive:true});
    boardViewport?.addEventListener('wheel',()=>requestAnimationFrame(scheduleVirtualCanvas),{passive:true});
    boardViewport?.addEventListener('pointerdown',e=>{
      // Shift+left is canvas panning, not a request to deselect the image.
      if(e.button===0&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&
         !e.target.closest('.canvas-node,.canvas-derived-stack'))focusNode(null);
    });
    window.addEventListener('resize',()=>{
      if(resultPopovers)resultPopovers.anchorOffsetX=null;
      scheduleResultPosition();
      scheduleVirtualCanvas();updateMultiSelectionHud();
    },{passive:true});
    document.addEventListener('click',e=>{
      const nav=e.target.closest('.nav-icon-btn');
      if(nav && ['works','library'].includes(nav.dataset.view)){
        e.preventDefault();e.stopPropagation();chooseView(nav.dataset.view);return;
      }
      if(e.target.closest('.clear-canvas-btn')) {
        e.preventDefault();e.stopPropagation();clearCanvas();
      }
    },true);
    const top=document.querySelectorAll('.top-tool-btn');
    if (top[0]) top[0].addEventListener('click',()=>chooseView('works'));
    if (top[1]) {top[1].disabled=true;top[1].title='裁切工具尚未接入，暂不可用';}
    if (top[2]) {
      top[2].title='添加画布富文本 / 反推提示词块';
      top[2].addEventListener('click',addNote);
    }
    if (top[3]) {top[3].disabled=true;top[3].title='去背景和修复需要专门的模型接口，暂不可用';}
    const icons=document.querySelectorAll('.right-section > .icon-btn');
    if (icons[0]) {
      icons[0].title='撤销上一笔图片移动或尺寸调整';
      icons[0].setAttribute('aria-label',icons[0].title);
      icons[0].addEventListener('click',()=>stepHistory(true));
    }
    if (icons[1]) {
      icons[1].title='重做上一笔图片移动或尺寸调整';
      icons[1].setAttribute('aria-label',icons[1].title);
      icons[1].addEventListener('click',()=>stepHistory(false));
    }
    syncUndoControls();
    document.addEventListener('keydown',e=>{
      const focusedOnCanvas=!!e.target.closest?.('.canvas-node,#canvas-viewport');
      if ((e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey&&focusedOnCanvas&&
          !window.HamokiImageClipboard?.isEditable(e.target)&&
          !document.body.classList.contains('flow-mode')&&!document.body.classList.contains('hs-modal-open')) {
        if(e.key.toLowerCase()==='c'&&selectedId) {
          e.preventDefault();void copySelectedImage();return;
        }
        if(e.key.toLowerCase()==='v'){
          const record=window.HamokiImageClipboard.fallback(projectId,[]);
          if(record){e.preventDefault();void duplicateFromClipboard(record).catch(err=>toast('粘贴失败：'+err.message,true));return;}
        }
      }
      if ((e.ctrlKey||e.metaKey) && !e.target.closest('input,textarea,select,[contenteditable]')) {
        if(e.key.toLowerCase()==='z') { e.preventDefault();stepHistory(e.shiftKey?false:true);return; }
        if(e.key.toLowerCase()==='y') { e.preventDefault();stepHistory(false);return; }
      }
      if(e.key==='Escape'&&!e.target.closest('input,textarea,select,[contenteditable]')){
        focusNode(null);return;
      }
      if (!selectedNodeIds.size || !['Delete','Backspace'].includes(e.key)) return;
      if (e.target.closest('input,textarea,select,[contenteditable]')) return;
      e.preventDefault();void deleteSelectedNodes([...selectedNodeIds]);
    });
  });
  window.HamokiCanvas={refresh,findHistory,revealHistory,clearSelection:()=>focusNode(null),undo:()=>stepHistory(true),redo:()=>stepHistory(false),clear:clearCanvas,showWorks,showLibrary,addReferenceFile,duplicateFromClipboard,copySelectedImage,getProjectId:()=>projectId,toast,updatePopoverVisibility:scheduleResultPosition,beginPopoverMotion:beginResultMotion,endPopoverMotion:endResultMotion,bumpPopoverMotion:noteViewportMotion,allExtent:allCanvasExtent,fitWorldBounds:canvasFitBounds,scheduleVirtualRefresh:scheduleVirtualCanvas};
})();

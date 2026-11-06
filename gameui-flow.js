/* Hamoki Studio game-UI workflow. Same project/media/job APIs as the existing canvas. */
'use strict';
(() => {
 const $ = id => document.getElementById(id);
 const mk = (tag,cls,text) => {const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e;};
 const ico = name => {const s=document.createElementNS('http://www.w3.org/2000/svg','svg');const u=document.createElementNS('http://www.w3.org/2000/svg','use');u.setAttribute('href','#i-'+name);s.append(u);return s;};
 const S={projects:[],id:null,nodes:[],history:[],providers:[],providerId:null,selected:null,tab:'properties',tool:'select',query:'',scale:1,tx:80,ty:80,drag:null,shown:false,undo:[],redo:[],jobs:[],jobReady:false,modal:null};
 const bound=(n,a,b)=>Math.min(b,Math.max(a,n));
 const showStatus = msg => {$('flow-save-state').textContent=msg;};
 const iconButton=(name,text,fn,cls)=>{const b=mk('button',cls||'action');b.type='button';b.append(ico(name),mk('span','',text));if(fn)b.addEventListener('click',fn);return b;};
 const post=(obj,method='POST')=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
 async function api(path,options){const r=await fetch(path,{cache:'no-store',...options});let j={};try{j=await r.json();}catch{}if(!r.ok)throw Error(j.error||'HTTP '+r.status);return j;}
 function toast(message,isError=false){const t=$('flow-toast');t.textContent=message;t.classList.toggle('error',isError);t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,3800);}
 const info=(text,cls)=>mk('p',cls||'hint',text);
 const getNode=id=>S.nodes.find(n=>n.id===id);
 const getImage=n=>!n?null:n.kind==='reference'?n.url:S.history.find(h=>h.id===n.historyId)?.url||null;
 const nodeTitle=n=>n?.title||(n?.kind==='note'?'创作便签':n?.kind==='reference'?'参考素材':'生成版本 '+String(S.nodes.filter(x=>x.kind==='generated').indexOf(n)+1).padStart(2,'0'));
 const shortDate=t=>{try{return new Date(t).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}catch{return ''}};
 const currentPosition=()=>{const v=$('flow-viewport');return {x:Math.round((v.clientWidth/2-S.tx)/S.scale),y:Math.round((v.clientHeight/2-S.ty)/S.scale)};};
 const imageType=n=>n.kind==='note'?'note':nodeTitle(n).startsWith('拆件 ·')?'slice':n.kind==='reference'?'reference':'generated';
 const badgeType=n=>({note:'创作便签',slice:'拆件素材',reference:'参考图',generated:'生成版本'})[imageType(n)];
 function setTransform(){$('flow-world').style.transform='translate('+S.tx+'px,'+S.ty+'px) scale('+S.scale+')';$('zoom-readout').textContent=Math.round(S.scale*100)+'%';}
 function zoomTo(next,clientX,clientY){const v=$('flow-viewport'),r=v.getBoundingClientRect(),cx=clientX===undefined?r.width/2:clientX-r.left,cy=clientY===undefined?r.height/2:clientY-r.top;const result=window.HamokiCanvasCore.anchoredZoom({zoom:S.scale,x:S.tx,y:S.ty},next,cx,cy,.1,10);S.scale=result.zoom;S.tx=result.x;S.ty=result.y;setTransform();}
 function fit(){const v=$('flow-viewport');if(!v.clientWidth||!v.clientHeight)return;if(!S.nodes.length){S.scale=.92;S.tx=85;S.ty=75;setTransform();return;}
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const n of S.nodes){const g=getGeom(n);minX=Math.min(minX,n.x||0);minY=Math.min(minY,n.y||0);maxX=Math.max(maxX,(n.x||0)+g.w);maxY=Math.max(maxY,(n.y||0)+g.h);}
  const width=Math.max(220,maxX-minX),height=Math.max(140,maxY-minY);
  const target=window.HamokiCanvasCore.fitBounds([{x:minX,y:minY,w:width,h:height}],{width:v.clientWidth,height:v.clientHeight},{marginX:130,marginY:145,min:.1,max:1.05});
  S.scale=target.zoom;S.tx=target.x;S.ty=target.y;setTransform();
 }
 // Do not shrink seven unrelated images into unreadable thumbnails on first entry.
 // Keep all nodes available through the explicit "fit all" button.
 function fitInitial(){const images=S.nodes.filter(n=>n.kind!=='note'&&imageType(n)!=='slice');
  if(images.length<=3){fit();return;}
  const last=images.at(-1),prev=getNode(last.parentNodeId)||images.at(-2);
  if(!last||!prev){fit();return;}
  const view=$('flow-viewport'),a=getGeom(last),b=getGeom(prev);
  const x1=Math.min(Number(last.x)||0,Number(prev.x)||0);
  const x2=Math.max((Number(last.x)||0)+a.w,(Number(prev.x)||0)+b.w);
  const y1=Math.min(Number(last.y)||0,Number(prev.y)||0);
  const y2=Math.max((Number(last.y)||0)+a.h,(Number(prev.y)||0)+b.h);
  S.scale=bound(Math.min(1.05,(view.clientWidth-110)/Math.max(340,x2-x1),(view.clientHeight-130)/Math.max(250,y2-y1)),.58,1.05);
  const pos=window.HamokiCanvasCore.center({width:view.clientWidth,height:view.clientHeight,zoom:S.scale},(x1+x2)/2,(y1+y2)/2);
  S.tx=pos.x;S.ty=pos.y;
  setTransform();
 }
 function focusNode(id){const n=getNode(id);if(!n)return;const v=$('flow-viewport'),g=getGeom(n),pos=window.HamokiCanvasCore.center({width:v.clientWidth,height:v.clientHeight,zoom:S.scale},(Number(n.x)||0)+g.w/2,(Number(n.y)||0)+g.h/2);S.tx=pos.x;S.ty=pos.y;setTransform();selectNode(id);}
 function getGeom(n){const e=$('flow-nodes').querySelector('[data-node-id="'+n.id+'"]');return {w:e?.offsetWidth||320,h:e?.offsetHeight||(n.kind==='note'?155:280)};}
 function lineBetween(x1,y1,x2,y2){const delta=Math.max(55,Math.min(170,Math.abs(x2-x1)*.52));return 'M'+x1+' '+y1+' C'+(x1+delta)+' '+y1+' '+(x2-delta)+' '+y2+' '+x2+' '+y2;}
 function parentFor(n){
  if(!n)return null;
  if(n.parentNodeId)return getNode(n.parentNodeId)||null;
  if(n.kind!=='generated')return null;
  const historyItem=S.history.find(h=>h.id===n.historyId);
  if(!historyItem?.parentId)return null;
  return S.nodes.find(item=>item.historyId===historyItem.parentId)||null;
 }
 function drawEdges(){
  const svg=$('flow-edges');svg.replaceChildren();
  const visible=new Set(S.nodes.filter(n=>!S.query||nodeTitle(n).toLowerCase().includes(S.query)).map(n=>n.id));
  const namespace='http://www.w3.org/2000/svg';
  for(const n of S.nodes){
   const p=parentFor(n);
   if(!p||!visible.has(n.id)||!visible.has(p.id))continue;
   const a=getGeom(p),b=getGeom(n);
   const fromX=(+p.x||0)+a.w,fromY=(+p.y||0)+a.h/2;
   const toX=+n.x||0,toY=(+n.y||0)+b.h/2;
   const path=document.createElementNS(namespace,'path');
   path.setAttribute('d',lineBetween(fromX,fromY,toX,toY));
   path.setAttribute('class',imageType(n)==='slice'?'slice-edge':'version-edge');
   svg.append(path);
   for(const point of [{x:fromX,y:fromY},{x:toX,y:toY}]){
    const mark=document.createElementNS(namespace,'circle');
    mark.setAttribute('cx',point.x);
    mark.setAttribute('cy',point.y);
    mark.setAttribute('r','4');
    mark.setAttribute('class',imageType(n)==='slice'?'slice-dot':'version-dot');
    svg.append(mark);
   }
  }
 }
 function renderNodes(){const layer=$('flow-nodes');layer.replaceChildren();const query=S.query;let shown=0;
  for(let i=0;i<S.nodes.length;i++){const n=S.nodes[i],title=nodeTitle(n);if(query&&!title.toLowerCase().includes(query)&&!String(n.text||'').toLowerCase().includes(query))continue;shown++;
   const kind=imageType(n),card=mk('article','flow-node'+(n.id===S.selected?' selected':'')+(n.kind==='note'?' note-node':''));card.tabIndex=0;card.dataset.nodeId=n.id;card.style.left=(+n.x||0)+'px';card.style.top=(+n.y||0)+'px';card.title='点击选中，拖动顶部移动；生成衍生会自动连接来源';
   const head=mk('div','node-header');const topIcon=mk('span','node-icon');topIcon.append(ico(kind==='note'?'pencil':kind==='slice'?'scissors':kind==='reference'?'image':'refresh'));
   const label=mk('div','node-title-wrap');label.append(mk('strong','',title),mk('small','',badgeType(n)+(parentFor(n)?' · 已关联来源':'')));
   head.append(topIcon,label,mk('span','node-id','#'+String(i+1).padStart(3,'0')));card.append(head);
   if(n.kind==='note'){card.append(mk('div','note-body',n.text||'双击编辑便签'));}
   else{const art=mk('div','node-art');const image=mk('img');image.alt=title;image.loading='lazy';image.draggable=false;const url=getImage(n);if(url){image.src=url;}else image.alt='图片不存在';art.append(image);card.append(art);}
   const foot=mk('div','node-footer');const footText=mk('div','node-footer-text');footText.append(mk('strong','',kind==='generated'?'生成完成':kind==='slice'?'可导出的拆件':'原图已保留'),mk('small','',shortDate(n.createdAt)||'在画布中'));foot.append(footText);
   if(n.kind!=='note'){const view=iconButton('eye','预览',ev=>{ev.stopPropagation();const url=getImage(n);if(url)window.HamokiCanvasOriginalPreview?.open(url,card);},'');foot.append(view);}
   card.append(foot);
   if(n.kind!=='note'){
    const hasParent=!!parentFor(n),hasChildren=S.nodes.some(item=>parentFor(item)?.id===n.id);
    if(hasParent||hasChildren){
     for(const side of ['input','output']){
      if(side==='input'&&!hasParent||side==='output'&&!hasChildren)continue;
      const port=mk('span','node-port '+side);
      port.setAttribute('aria-hidden','true');
      card.append(port);
     }
    }
   }
   if(n.kind!=='note'){
    card.addEventListener('contextmenu',event=>{
      if(event.target.closest('input,textarea,select,[contenteditable]'))return;
      event.preventDefault();event.stopPropagation();
      selectNode(n.id);
      const imageUrl=getImage(n);
      window.HamokiGlassUI?.menu({
        x:event.clientX,y:event.clientY,
        items:[
          {label:'下载原图',disabled:!imageUrl,onClick:()=>{
            const link=mk('a');link.href=imageUrl;link.download='Hamoki-'+n.id+'.png';
            document.body.append(link);link.click();link.remove();
          }},
          {label:'从画布删除',danger:true,onClick:()=>removeNode(n)}
        ]
      });
    });
   }
   card.addEventListener('click',()=>selectNode(n.id));
   card.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();selectNode(n.id)}});
   card.addEventListener('dblclick',ev=>{if(n.kind==='note'){const t=prompt('编辑便签',n.text||'');if(t!==null)patchNode(n.id,{text:t.slice(0,1600)});}else if(!ev.target.closest('button')){const url=getImage(n);if(url){ev.preventDefault();ev.stopPropagation();window.HamokiCanvasOriginalPreview?.open(url,card);}}});
   head.addEventListener('pointerdown',ev=>startNodeDrag(ev,n,card,head));
   layer.append(card);
  }
  $('flow-empty').hidden=shown>0;drawEdges();
 }
 function selectNode(id){S.selected=id;document.querySelectorAll('.flow-node,.layer-row').forEach(e=>e.classList.toggle('selected',e.dataset.nodeId===id));$('flow-nodes').querySelectorAll('.flow-node').forEach(e=>e.classList.toggle('selected',e.dataset.nodeId===id));renderInspector();}
 function startNodeDrag(ev,n,card,head){if(ev.button!==0||S.tool!=='select')return;ev.preventDefault();ev.stopPropagation();selectNode(n.id);const start={x:Number(n.x)||0,y:Number(n.y)||0};let changed=false;const sx=ev.clientX,sy=ev.clientY;head.setPointerCapture(ev.pointerId);
  function move(e){if(e.pointerId!==ev.pointerId)return;const {x:dx,y:dy}=window.HamokiCanvasCore.dragDelta({x:sx,y:sy},{x:e.clientX,y:e.clientY},S.scale);if(Math.abs(dx)+Math.abs(dy)>2)changed=true;n.x=Math.round(start.x+dx);n.y=Math.round(start.y+dy);card.style.left=n.x+'px';card.style.top=n.y+'px';drawEdges();}
  async function up(e){if(e.pointerId!==ev.pointerId)return;head.removeEventListener('pointermove',move);head.removeEventListener('pointerup',up);head.removeEventListener('pointercancel',cancel);if(changed){S.undo.push({id:n.id,before:start,after:{x:n.x,y:n.y}});S.undo=S.undo.slice(-70);S.redo=[];try{await patchNode(n.id,{x:n.x,y:n.y},false)}catch(err){Object.assign(n,start);card.style.left=n.x+'px';card.style.top=n.y+'px';drawEdges();toast('节点位置保存失败：'+err.message,true)}}}
  function cancel(){head.removeEventListener('pointermove',move);head.removeEventListener('pointerup',up);head.removeEventListener('pointercancel',cancel);Object.assign(n,start);card.style.left=n.x+'px';card.style.top=n.y+'px';drawEdges();}
  head.addEventListener('pointermove',move);head.addEventListener('pointerup',up);head.addEventListener('pointercancel',cancel);
 }
 async function patchNode(id,patch,refresh=true){showStatus('正在保存…');try{const r=await api('/api/projects/'+S.id+'/nodes/'+id,post(patch,'PATCH'));const n=getNode(id);if(n)Object.assign(n,r.node);showStatus('所有更改自动保存');if(refresh){renderNodes();renderSidebar();renderInspector();}return r;}catch(e){showStatus('保存失败 · 请重试');throw e;}}
 async function refreshList(){const r=await api('/api/projects');S.projects=r.projects||[];if(!S.id||!S.projects.some(p=>p.id===S.id))S.id=S.projects.find(p=>p.id===r.defaultId)?.id||S.projects[0]?.id||null;}
 async function loadProject(doFit=false){if(!S.id)return;const id=S.id;const [p,h]=await Promise.all([api('/api/projects/'+id),api('/api/history?projectId='+encodeURIComponent(id))]);if(id!==S.id)return;S.nodes=p.project?.nodes||[];S.history=h.history||[];if(S.selected&&!getNode(S.selected))S.selected=null;if(doFit&&!S.selected)S.selected=S.nodes.filter(n=>n.kind!=='note'&&imageType(n)!=='slice').at(-1)?.id||S.nodes.at(-1)?.id||null;$('flow-project-title').textContent=p.project?.title||'未命名项目';renderSidebar();renderNodes();renderInspector();if(doFit)requestAnimationFrame(fitInitial);else setTransform();}
 async function initialize(){try{await refreshList();try{const remembered=localStorage.getItem('hamoki_flow_project');if(remembered&&S.projects.some(p=>p.id===remembered))S.id=remembered;}catch{}if(!S.id){toast('项目列表为空，可以新建一个画布');return;}const r=await api('/api/providers');S.providers=r.providers||[];S.providerId=r.activeId||S.providers[0]?.id||null;await loadProject(true);await pollQueue();}catch(e){toast('加载工作流失败：'+e.message,true);$('flow-project-title').textContent='连接失败';$('flow-empty').hidden=false;}}
 async function switchProject(id){if(!S.projects.some(p=>p.id===id))return;S.id=id;S.selected=null;S.undo=[];S.redo=[];try{localStorage.setItem('hamoki_flow_project',id);}catch{}await loadProject(true);await pollQueue();}
 async function newProject(){const title=prompt('新项目名称','新的游戏 UI 项目');if(title===null)return;if(!title.trim()){toast('项目名称不能为空',true);return;}try{const r=await api('/api/projects',post({title:title.trim().slice(0,70)}));await refreshList();await switchProject(r.project.id);toast('项目已创建');}catch(e){toast('新建项目失败：'+e.message,true);}}
 function renderSidebar(){const box=$('flow-project-list');box.replaceChildren();$('project-count').textContent=String(S.projects.length);
  for(const p of S.projects){const b=mk('button','project-row'+(p.id===S.id?' active':''));b.append(ico('folder'),mk('span','',p.title),mk('small','',p.imageCount||0));b.addEventListener('click',()=>switchProject(p.id));box.append(b);}
  const layers=$('flow-layer-list');layers.replaceChildren();const items=S.nodes.filter(n=>!S.query||nodeTitle(n).toLowerCase().includes(S.query)||String(n.text||'').toLowerCase().includes(S.query));
  if(!items.length)layers.append(info('当前没有匹配的素材'));
  for(const n of items.slice(-65).reverse()){const b=mk('button','layer-row'+(n.id===S.selected?' active':''));b.dataset.nodeId=n.id;const url=getImage(n);if(url){const img=mk('img','tiny-thumb');img.src=url;img.loading='lazy';b.append(img)}else{const span=mk('span','tiny-icon');span.append(ico('pencil'));b.append(span)}
   const desc=mk('span');desc.append(mk('span','',nodeTitle(n)),mk('small','',badgeType(n)));b.append(desc);b.addEventListener('click',()=>focusNode(n.id));layers.append(b);}
  const recent=$('flow-recents');recent.replaceChildren();
  for(const h of S.history.slice(0,6)){const b=mk('button','recent-card');const image=mk('img');image.src=h.url;image.loading='lazy';image.alt='最近生成';b.append(image,mk('span','',h.editInstruction||h.prompt||'生成的游戏 UI'));b.addEventListener('click',()=>showHistory(h));recent.append(b)}
  if(!S.history.length)recent.append(info('生图完成后会显示在这里'));
 }
 function section(title){const box=mk('section','inspector-section');box.append(mk('h3','',title));return box;}
 function prop(label,val){const box=mk('div','property-meta');box.append(mk('span','',label),mk('strong','',val));return box;}
 function renderInspector(){const box=$('flow-inspector-content');box.replaceChildren();const n=getNode(S.selected);
  if(S.tab==='history'){renderHistory(box);return;}
  if(S.tab==='variants'){renderVariants(box,n);return;}
  if(!n){const empty=mk('div','empty-inspector');empty.append(ico('cursor'),mk('strong','','选择一个画布节点'),info('选中图片后，可以衍生版本、局部重绘、拆出单个游戏 UI 素材。'));box.append(empty);
    const s=section('项目概况');s.append(prop('画布元素',S.nodes.length),prop('生成版本',S.nodes.filter(x=>x.kind==='generated').length),prop('参考素材',S.nodes.filter(x=>x.kind==='reference').length));s.append(iconButton('upload','添加素材',()=> $('flow-upload').click(),'action'));box.append(s);return;}
  box.append(mk('div','inspector-label','当前选中'));
  const preview=mk('div','inspector-preview');const url=getImage(n);if(url){const img=mk('img');img.src=url;img.alt=nodeTitle(n);preview.append(img)}else preview.append(mk('div','note-body',n.text||'便签'));
  preview.append(mk('strong','',nodeTitle(n)),mk('small','',badgeType(n)+' · '+(n.kind==='generated'?'生成记录已关联':'项目内素材')));box.append(preview);
  const actions=section('对这张图片进行操作');if(n.kind!=='note'){const grid=mk('div','action-grid');grid.append(iconButton('refresh','衍生新版本',()=>window.GameFlowTools?.openGenerate(n,'variation')),iconButton('pencil','局部重绘',()=>window.GameFlowTools?.openGenerate(n,'mask')),iconButton('scissors','区域拆件',()=>window.GameFlowTools?.openSlices(n),'action blue'));actions.append(grid);actions.append(iconButton('layers','智能自动拆层',()=>window.GameFlowTools?.openLayered?.(n),'action layered-action'));}
  else actions.append(info('选中便签后可编辑其内容'));box.append(actions);
  const settings=section('节点属性');const title=mk('input','text-input');title.value=n.title||nodeTitle(n);title.maxLength=100;title.setAttribute('aria-label','节点名称');settings.append(mk('label','form-label','名称'),title);title.addEventListener('change',()=>patchNode(n.id,{title:title.value.trim()||nodeTitle(n)}).catch(e=>toast(e.message,true)));
  if(n.kind==='note'){const ta=mk('textarea','text-area');ta.value=n.text||'';ta.maxLength=1600;settings.append(mk('label','form-label','便签内容'),ta);ta.addEventListener('change',()=>patchNode(n.id,{text:ta.value}).catch(e=>toast(e.message,true)));}
  settings.append(prop('节点类型',badgeType(n)),prop('创建时间',shortDate(n.createdAt)),prop('位置',Math.round(n.x||0)+' , '+Math.round(n.y||0)));
  if(parentFor(n)){settings.append(prop('来源节点',nodeTitle(parentFor(n))));}
  box.append(settings);
  const danger=section('管理');danger.append(iconButton('trash','从画布移除',()=>removeNode(n),'action ghost'),info('移除节点不删除原始图片、生成历史或其他节点。'));box.append(danger);
 }
 function renderVariants(box,n){if(!n){box.append(info('请先选择节点，查看它的衍生版本。'));return;}const relatives=[...(parentFor(n)?[parentFor(n)]:[]),n,...S.nodes.filter(x=>parentFor(x)?.id===n.id)];box.append(mk('div','inspector-label','版本关系 · '+relatives.length+' 个节点'));for(const item of relatives){const row=mk('button','variant-line');const url=getImage(item);if(url){const img=mk('img');img.src=url;img.alt='';row.append(img)}else row.append(ico('pencil'));const infoBox=mk('div');infoBox.append(mk('strong','',nodeTitle(item)),mk('small','',item.id===n.id?'当前版本':item.id===parentFor(n)?.id?'来源版本':'衍生版本'));row.append(infoBox);row.addEventListener('click',()=>focusNode(item.id));box.append(row)}}
 function renderHistory(box){box.append(mk('div','inspector-label','当前项目 · '+S.history.length+' 条生成记录'));if(!S.history.length){box.append(info('生图记录会自动显示在这里。'));return;}for(const h of S.history.slice(0,100)){const b=mk('button','history-row');const img=mk('img');img.src=h.url;img.alt='';const copy=mk('div');copy.append(mk('strong','',h.editInstruction||h.prompt||'生成图片'),mk('small','',shortDate(h.createdAt)+' · '+(h.model||'')));b.append(img,copy);b.addEventListener('click',()=>showHistory(h));box.append(b);}}
 async function showHistory(h){const n=S.nodes.find(n=>n.historyId===h.id);if(n){focusNode(n.id);return;}
  if(!(await window.HamokiGlassUI.confirm('这张历史图片还不在画布上，要把它添加到当前项目吗？',{title:'添加历史图片'})))return;
  try{const pos=currentPosition();const r=await api('/api/projects/'+S.id+'/nodes/from-history',post({historyId:h.id,x:pos.x-160,y:pos.y-120}));await loadProject();focusNode(r.node.id);toast('历史图片已加入画布');}catch(e){toast('添加历史图片失败：'+e.message,true);}
 }
 async function addNote(){if(!S.id)return;try{const pos=currentPosition();const r=await api('/api/projects/'+S.id+'/notes',post({text:'双击或在右侧编辑便签',x:pos.x-120,y:pos.y-70,w:245,h:155}));await loadProject();focusNode(r.node.id);toast('便签已添加');}catch(e){toast('添加便签失败：'+e.message,true);}}
 async function uploadFiles(files,parentId=null,names=[]){const valid=Array.from(files).filter(f=>['image/png','image/jpeg','image/webp'].includes(f.type)&&f.size<=12*1024*1024);if(!valid.length)throw Error('请选择不超过 12 MB 的 PNG、JPG 或 WebP');const pos=currentPosition();let last=null;let i=0;
  for(const f of valid){const img=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('读取图片失败'));reader.readAsDataURL(f)});const r=await api('/api/projects/'+S.id+'/assets',post({image:img,name:names[i]||f.name,x:pos.x-170+(i%3)*370,y:pos.y-160+Math.floor(i/3)*300,parentNodeId:parentId}));last=r.node.id;i++;}
  await loadProject();if(last)focusNode(last);toast('已加入 '+valid.length+' 张参考图');
 }
 async function duplicateFromClipboard(record){
  if(!S.id||record?.projectId!==S.id)throw Error('图片不属于当前项目');
  const source=getNode(record.nodeId);
  if(!source||source.kind==='note')throw Error('原图节点不存在');
  record.pasteCount=(record.pasteCount||0)+1;
  const offset=44*record.pasteCount;
  const result=await api('/api/projects/'+S.id+'/nodes/duplicate',post({
    sourceNodeId:source.id,x:(Number(source.x)||0)+offset,
    y:(Number(source.y)||0)+offset,w:source.w,h:source.h
  }));
  S.selected=result.node.id;
  await loadProject();
  focusNode(result.node.id);
  toast('图片副本已粘贴，可继续拖动；原图保持不变');
  return result.node;
 }
 async function copySelectedImage(){
  const selected=getNode(S.selected),url=getImage(selected);
  if(!url)return;
  try{
   const result=await window.HamokiImageClipboard.copy(url,{
    projectId:S.id,nodeId:selected.id,x:selected.x,y:selected.y,w:selected.w,h:selected.h,title:nodeTitle(selected)
   });
   toast(result.system?'图片已复制到系统剪贴板 · Ctrl+V 可粘贴':'系统剪贴板被浏览器拒绝，可尝试直接在画布内 Ctrl+V',!result.system);
  }catch(error){toast('复制图片失败：'+error.message,true);}
 }
 async function removeNode(n){if(!(await window.HamokiGlassUI.confirm('只从当前画布移除「'+nodeTitle(n)+'」？原图和生成历史不会删除。',{title:'移除画布节点',confirmLabel:'移除',danger:true})))return;try{await api('/api/projects/'+S.id+'/nodes/'+n.id,{method:'DELETE'});if(S.selected===n.id)S.selected=null;await loadProject();toast('节点已移除');}catch(e){toast('移除失败：'+e.message,true);}}
 function setTool(mode){S.tool=mode;document.querySelectorAll('.tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===mode));}
 async function changeHistory(direction){const src=direction==='undo'?S.undo:S.redo,dst=direction==='undo'?S.redo:S.undo,entry=src.pop();if(!entry)return;const target=direction==='undo'?entry.before:entry.after;try{await patchNode(entry.id,target);dst.push(entry);toast(direction==='undo'?'已撤销移动':'已重做移动');}catch(e){src.push(entry);toast(e.message,true);}}
 async function pollQueue(){if(!S.id)return;try{const r=await api('/api/jobs?projectId='+encodeURIComponent(S.id));const jobs=r.jobs||[];const prev=new Map(S.jobs.map(j=>[j.id,j.status]));const completed=S.jobReady?jobs.filter(j=>j.status==='done'&&prev.get(j.id)&&prev.get(j.id)!=='done'):[];S.jobs=jobs;S.jobReady=true;
    const running=jobs.filter(j=>j.status==='running').length,queued=jobs.filter(j=>j.status==='queued').length,errors=jobs.filter(j=>['failed','interrupted'].includes(j.status)).length;
    $('flow-queue-text').textContent=running||queued?'进行中 '+running+' · 排队 '+queued:(errors?'失败 '+errors+' · 点击查看':'暂无正在运行的任务');
    document.querySelector('.flow-queue')?.classList.toggle('is-busy',running>0);
    const pop=$('flow-queue-popover');pop.replaceChildren();const listed=jobs.slice(0,12);if(!listed.length)pop.append(info('队列为空，可选中一张图片衍生新版本。'));
    const names={running:'生成中',queued:'排队中',done:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
    for(const j of listed){const row=mk('div','queue-row');row.append(ico(j.status==='done'?'check':j.status==='failed'?'info':'refresh'),mk('span','',j.editInstruction||j.prompt||'图片生成任务'),mk('small','',names[j.status]||j.status));pop.append(row);}
    if(completed.length){await loadProject();const newest=completed[0],node=S.nodes.find(n=>n.historyId===newest.resultId);if(node)focusNode(node.id);toast('新版本已生成并添加到工作流');}
   }catch(e){$('flow-queue-text').textContent='队列暂不可用';}
 }
 function bindEvents(){
  $('new-project').addEventListener('click',newProject);
  $('add-note').addEventListener('click',addNote);$('rail-note').addEventListener('click',addNote);
  for(const id of ['flow-upload-btn','rail-add','empty-upload'])$(id).addEventListener('click',()=> $('flow-upload').click());
  $('flow-upload').addEventListener('change',async e=>{if(!e.target.files?.length)return;try{await uploadFiles(e.target.files)}catch(err){toast('上传失败：'+err.message,true);}e.target.value='';});
  document.addEventListener('paste',async e=>{
    if(!$('flow-dialog').hidden)return;
    const items=Array.from(e.clipboardData?.items||[]);
    const item=items.find(it=>it.kind==='file'&&['image/png','image/jpeg','image/webp'].includes(it.type));
    if(!item){
     const record=!items.length?window.HamokiImageClipboard?.fallback(S.id,items):null;
     if(record){e.preventDefault();try{await duplicateFromClipboard(record)}catch(error){toast('粘贴图片失败：'+error.message,true)}}
     return;
    }
    const file=item.getAsFile();if(!file)return;
    e.preventDefault();
    try{
      const existing=await window.HamokiImageClipboard?.match(file,S.id);
      if(existing){await duplicateFromClipboard(existing);return;}
      if(file.size>12*1024*1024)throw Error('粘贴的外部图片超过 12 MB，请先压缩');
      await uploadFiles([new File([file],file.name||'粘贴参考图.png',{type:file.type})]);
    }
    catch(error){toast('粘贴图片失败：'+error.message,true);}
  });
  $('flow-search').addEventListener('input',e=>{S.query=e.target.value.trim().toLowerCase();renderSidebar();renderNodes();});
  $('flow-show-history').addEventListener('click',()=>chooseTab('history'));
  $('flow-backup').addEventListener('click',()=>{if(!S.id)return;const a=mk('a');a.href='/api/projects/'+S.id+'/backup';a.download='hamoki-project-'+S.id.slice(0,8)+'.hamoki';document.body.append(a);a.click();a.remove();toast('已请求下载可恢复的项目快照');});
  $('flow-export').addEventListener('click',async()=>{const n=getNode(S.selected);if(!n||n.kind==='note'){toast('请先选中一张图片',true);return;}const url=n.kind==='generated'?'/api/download/'+n.historyId:getImage(n);if(!url)return toast('没有可导出的图片',true);try{const r=await fetch(url);if(!r.ok)throw Error('HTTP '+r.status);const blob=await r.blob();const object=URL.createObjectURL(blob),a=mk('a');a.href=object;a.download=(nodeTitle(n).replace(/[\\/:*?"<>|]/g,'-')||'game-ui')+'.'+(blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(object),2000);toast('已导出选中图片');}catch(e){toast('导出失败：'+e.message,true);}});
  // Embedded workflows use the parent dialog; standalone workflows need a usable settings route.
  $('flow-settings').addEventListener('click',()=>{
    try {
      if (window.parent!==window && typeof window.parent.HamokiSettings?.open==='function') {
        window.parent.HamokiSettings.open();
        return;
      }
    } catch {}
    window.location.assign('./?settings=1');
  });
  const inspectorToggle=$('flow-inspector-toggle');
  if (inspectorToggle) inspectorToggle.addEventListener('click',()=>{
    const panel=$('flow-inspector');
    const open=panel.classList.toggle('is-open');
    inspectorToggle.setAttribute('aria-expanded',String(open));
    inspectorToggle.setAttribute('aria-label',open?'收起属性面板':'展开属性面板');
  });
  $('zoom-in').addEventListener('click',()=>zoomTo(S.scale*1.2));$('zoom-out').addEventListener('click',()=>zoomTo(S.scale/1.2));$('zoom-fit').addEventListener('click',fit);$('rail-fit').addEventListener('click',fit);
  document.querySelectorAll('.tool').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
  document.querySelectorAll('.inspector-tab').forEach(b=>b.addEventListener('click',()=>chooseTab(b.dataset.tab)));
  $('flow-queue-toggle').addEventListener('click',()=>{const p=$('flow-queue-popover');p.hidden=!p.hidden;$('flow-queue-toggle').setAttribute('aria-expanded',String(!p.hidden));});
  const view=$('flow-viewport');view.addEventListener('wheel',ev=>{ev.preventDefault();zoomTo(S.scale*window.HamokiCanvasCore.wheelFactor(ev),ev.clientX,ev.clientY);},{passive:false});
  view.addEventListener('pointerdown',ev=>{if(ev.target.closest('.flow-node,.canvas-rail'))return;const pan=ev.button===1||ev.button===0&&(S.tool==='pan'||ev.shiftKey||!ev.target.closest('button'));if(!pan)return;ev.preventDefault();view.setPointerCapture(ev.pointerId);S.drag={id:ev.pointerId,x:ev.clientX,y:ev.clientY,tx:S.tx,ty:S.ty};view.classList.add('is-panning');});
  view.addEventListener('pointermove',ev=>{if(S.drag&&ev.pointerId===S.drag.id){S.tx=S.drag.tx+ev.clientX-S.drag.x;S.ty=S.drag.ty+ev.clientY-S.drag.y;setTransform();}});
  view.addEventListener('pointerup',ev=>{if(S.drag&&ev.pointerId===S.drag.id){S.drag=null;view.classList.remove('is-panning');}});
  view.addEventListener('pointercancel',ev=>{if(S.drag?.id===ev.pointerId){S.drag=null;view.classList.remove('is-panning');}});
  view.addEventListener('auxclick',e=>{if(e.button===1)e.preventDefault()});
  document.addEventListener('keydown',ev=>{if(ev.key==='Escape'){closeDialog();return;}if(ev.target.closest('input,textarea,select,[contenteditable]')||!$('flow-dialog').hidden)return;
   if((ev.ctrlKey||ev.metaKey)&&!ev.altKey&&!ev.shiftKey&&ev.key.toLowerCase()==='c'&&S.selected&&getNode(S.selected)?.kind!=='note'){ev.preventDefault();void copySelectedImage();return;}
   if((ev.ctrlKey||ev.metaKey)&&!ev.altKey&&!ev.shiftKey&&ev.key.toLowerCase()==='v'){
    const copied=window.HamokiImageClipboard?.fallback(S.id,[]);
    if(copied){ev.preventDefault();void duplicateFromClipboard(copied).catch(err=>toast('粘贴图片失败：'+err.message,true));return;}
   }
   if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='z'){ev.preventDefault();changeHistory(ev.shiftKey?'redo':'undo');}else if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='y'){ev.preventDefault();changeHistory('redo');}else if(ev.key==='Delete'&&S.selected){ev.preventDefault();const n=getNode(S.selected);if(n)removeNode(n);}});
  window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.type==='flow-activate')loadProject().catch(()=>{});});
  window.addEventListener('resize',()=>{if(!S.shown&&S.nodes.length){S.shown=true;fit();}});
 }
 function chooseTab(tab){S.tab=tab;document.querySelectorAll('.inspector-tab').forEach(b=>{const on=b.dataset.tab===tab;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false');});renderInspector();}
 function closeDialog(){$('flow-dialog').hidden=true;S.modal=null;const body=$('dialog-body');body.replaceChildren();$('dialog-footer').replaceChildren();}
 $('dialog-close').addEventListener('click',closeDialog);
 $('flow-dialog').addEventListener('mousedown',e=>{if(e.target===$('flow-dialog'))closeDialog();});
 window.GameFlow={state:S,api,post,mk,ico,toast,info,getNode,getImage,nodeTitle,uploadFiles,loadProject,focusNode,closeDialog,shortDate,refreshList,copySelectedImage,duplicateFromClipboard};
 bindEvents();initialize();setInterval(pollQueue,3400);
})();
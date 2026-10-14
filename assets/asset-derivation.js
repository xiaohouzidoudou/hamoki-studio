'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const create=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=String(txt);return e};
 const suggestions=[
  {kind:'screen',description:'设计一个完整游戏主界面，突出核心玩法入口和主要导航，符合现有游戏美术风格。'},
  {kind:'kit',description:'生成一套可复用 UI Kit：主要按钮、次级按钮、标签、活动面板、分页标签、进度条。'},
  {kind:'icons',description:'生成一张游戏奖励素材板：金币、钻石、宝箱、道具、成就图标，统一材质和粗描边。'},
  {kind:'background',description:'设计游戏活动页干净的主题背景，无按钮、无角色、无贴近镜头的前景道具。'},
  {kind:'character',description:'设计与游戏画风一致的全身角色立绘，清晰的装备轮廓与辨识度，简洁背景。'}
 ];
 const ratios=['1:1','3:2','2:3','16:9','9:16','4:3','3:4'];
 let projectId=null, data=null, items=[],busy=false,poll=null,dirty=false;
 const status=t=>{$('deriveStatus').textContent=t||'';};
 const kindLabel=kind=>(data?.types||[]).find(t=>t.id===kind)?.label||kind;
 function modelsFor(cap){
  return (typeof providers!=='undefined'?providers:[]).filter(p=>p.capabilities?.[cap]?.enabled!==false&&
   (p.hasKey||p.capabilities?.[cap]?.hasKey));
 }
 function fillSelect(node,options,selected){
  node.replaceChildren();for(const o of options){const opt=new Option(o.label,o.value);node.add(opt)}
  if(options.some(x=>x.value===selected))node.value=selected;
 }
 function modelPicker(cap){
  const pfx=cap==='vision'?'deriveVision':cap==='text'?'deriveText':'deriveImage';
  const plist=modelsFor(cap);
  const routing=data?.derivation?.routing?.[cap]||{};
  const workflow=typeof data==='object'?data?.routing?.[cap]:null;
  const wanted=routing.providerId||workflow?.providerId||(typeof activeId!=='undefined'?activeId:'');
  fillSelect($(pfx+'Provider'),plist.length?plist.map(x=>({value:x.id,label:x.name})):[{value:'',label:'请先配置中转站'}],wanted);
  const p=plist.find(x=>x.id===$(pfx+'Provider').value);
  const entry=p?.capabilities?.[cap];
  const hint=entry?.defaultModel||(cap==='vision'?p?.visionModel:cap==='image'?p?.imageModel:p?.textModel)||'';
  $(pfx+'Model').value=routing.model||workflow?.model||hint;
  $(pfx+'Provider').onchange=()=>{
   const selected=modelsFor(cap).find(x=>x.id===$(pfx+'Provider').value);
   $(pfx+'Model').value=selected?.capabilities?.[cap]?.defaultModel||
    (cap==='vision'?selected?.visionModel:cap==='image'?selected?.imageModel:selected?.textModel)||'';
  };
 }
 const model=cap=>{
  const p=cap==='vision'?'deriveVision':cap==='text'?'deriveText':'deriveImage';
  return {providerId:$(p+'Provider').value,model:$(p+'Model').value.trim()};
 };
 function correctProject(){
  if(typeof currentProject==='undefined'||!currentProject||currentProject.id!==projectId)
   throw Error('项目已切换，请重新打开一图衍生素材工作台');
 }
 function selectedIds(){return [...$('deriveRefs').querySelectorAll('input:checked')].map(n=>n.value)}
 function refsUI(){
  const root=$('deriveRefs');root.replaceChildren();
  const nodes=(typeof currentProject!=='undefined'?currentProject?.nodes:[])||[];
  const valid=nodes.filter(x=>x.kind!=='note').slice(0,120);
  const preselected=data?.derivation?.referenceNodeIds?.length?data.derivation.referenceNodeIds:
   (typeof currentProject!=='undefined'?currentProject?.creativeWorkflow?.styleNodeIds:[])||[];
  for(const n of valid){
   const label=create('label','derive-ref'),ck=create('input');ck.type='checkbox';ck.value=n.id;
   ck.checked=preselected.includes(n.id);
   ck.addEventListener('change',()=>{if(selectedIds().length>5){ck.checked=false;status('风格参考图最多选 5 张')}});
   const img=create('img');img.loading='lazy';img.alt='游戏风格参考图';
   try{img.src=typeof nodeImage==='function'?nodeImage(n):n.url||''}catch{img.src=n.url||''}
   label.append(ck,img,create('span',null,n.title||'画布素材'));root.append(label);
  }
  if(!valid.length)root.append(create('p','derive-hint','当前画布没有图片。先上传一张游戏截图，或打开已有图片的项目。'));
 }
 function sourceUI(){
  const sel=$('deriveStyleSource'),preferred=sel.value;
  const hasProject=!!data?.projectStyle?.available,hasOwn=!!data?.derivation?.styleDNA;
  fillSelect(sel,[{value:'project',label:'复用当前项目的 Style DNA'+(hasProject?'':'（尚未分析）')},
   {value:'derived',label:'使用本功能识别的 Style DNA'+(hasOwn?'':'（尚未分析）')}],
   (preferred&&((preferred==='project'&&hasProject)||(preferred==='derived'&&hasOwn)))?preferred:hasProject?'project':'derived');
  updateStyleStatus();
 }
 function updateStyleStatus(){
  const hasProject=!!data?.projectStyle?.available,own=!!data?.derivation?.styleDNA;
  const preview=$('deriveStyleInfo');
  preview.textContent=(hasProject?'项目已有 Style DNA · ':'')+(own?'单图 Style DNA 已保存 · ':'')+
   '风格只分析一次，后续任务继续复用。';
  $('deriveStyleSource').title=hasProject||own?'选择现有的已分析画风':'需要先运行一次风格识别';
 }
 function chosenSource(){
  const source=$('deriveStyleSource').value;
  if(source==='project'&&!data?.projectStyle?.available)throw Error('本项目还没有 Style DNA，请先分析参考图');
  if(source==='derived'&&!data?.derivation?.styleDNA)throw Error('请先使用视觉模型分析所选参考图');
  return source;
 }
 function drawItems(){
  const root=$('deriveItems');root.replaceChildren();
  for(const [index,item] of items.entries()){
   const row=create('div','derive-item');
   const header=create('div','derive-item-header'),no=create('span','derive-number',String(index+1).padStart(2,'0'));
   const kind=create('select','field derive-kind');
   fillSelect(kind,(data?.types||[]).map(x=>({value:x.id,label:x.label})),item.kind);
   kind.onchange=()=>{item.kind=kind.value;dirty=true};
   const remove=create('button','soft-btn derive-remove','移除');remove.type='button';remove.onclick=()=>{
    items.splice(index,1);drawItems();dirty=true;
   };
   header.append(no,kind,remove);
   const text=create('textarea','field derive-description');text.rows=2;text.maxLength=300;
   text.placeholder='描述要生成的内容、数量及结构';text.value=item.description||'';
   text.oninput=()=>{item.description=text.value;dirty=true};
   row.append(header,text);root.append(row);
  }
  $('deriveAdd').disabled=items.length>=8;
 }
 function drawDrafts(){
  const root=$('deriveDrafts');root.replaceChildren();
  const drafts=data?.derivation?.drafts||[];
  if(!drafts.length){root.append(create('p','derive-hint','自动准备后会在这里出现生图提示词。可以逐条修改，再确认批量生图。'));return}
  for(const draft of drafts){
   const article=create('article','derive-draft'),title=create('div','derive-draft-heading');
   const check=create('input');check.type='checkbox';check.className='derive-draft-check';check.value=draft.id;
   check.checked=draft.status==='draft';check.disabled=draft.status!=='draft';
   const h=create('strong',null,kindLabel(draft.kind)+' · '+draft.description);
   const flag=create('span','derive-state',draft.status==='draft'?'待确认':draft.status==='done'?'已生成':draft.status==='running'?'生成中':draft.status==='queued'?'已排队':draft.status==='failed'?'失败':draft.status);
   title.append(check,h,flag);
   const field=create('textarea','field derive-prompt');field.rows=5;field.value=draft.prompt;field.maxLength=7000;
   field.disabled=draft.status!=='draft';field.dataset.id=draft.id;
   field.oninput=()=>{dirty=true};
   const foot=create('div','derive-draft-foot'),select=create('select','field derive-ratio');
   select.dataset.id=draft.id;fillSelect(select,ratios.map(r=>({value:r,label:r})),draft.ratio);
   select.disabled=draft.status!=='draft';select.onchange=()=>{dirty=true};
   foot.append(create('span',null,'生成比例'),select,create('span','derive-hint',draft.status==='failed'?draft.error:'每份生成 1 张；支持重新修改提示词'));
   article.append(title,field,foot);root.append(article);
  }
 }
 function render(){
  if(!data)return;
  const d=data.derivation;
  $('deriveSummary').textContent='已准备 '+(d.drafts||[]).length+' 份 · '+(d.status==='running'?'正在'+(d.phase==='style'?'识别画风':'准备任务'):d.status==='failed'?'最近任务失败':d.status==='submitted'?'已提交':'可编辑');
  $('deriveBusy').classList.toggle('hidden',d.status!=='running');
  $('deriveAnalyze').disabled=busy||d.status==='running';
  $('derivePrepare').disabled=busy||d.status==='running';
  $('deriveSubmit').disabled=busy||d.status==='running'||!(d.drafts||[]).some(x=>x.status==='draft');
  $('deriveSave').disabled=busy||d.status==='running'||!(d.drafts||[]).some(x=>x.status==='draft');
  if(d.error)status('执行失败：'+d.error);
  drawDrafts();
 }
 async function load(){
  if(!projectId)return;
  const id=projectId;const next=await api('projects/'+id+'/derive');
  if(projectId!==id)return;
  data=next;
  render();
 }
 async function pollStatus(){
  if(poll)clearInterval(poll);
  poll=setInterval(async()=>{
   if(!projectId||$('deriveModal').classList.contains('hidden')){clearInterval(poll);poll=null;return}
   try{const before=data?.derivation?.status,after=await api('projects/'+projectId+'/derive');data=after;
    const running=after.derivation.status==='running';
    if(!running){clearInterval(poll);poll=null;render();sourceUI();busy=false;render();}
    else{$('deriveSummary').textContent='AI 正在'+(after.derivation.phase==='style'?'识别画风':'准备素材提示词')+' · 可关闭窗口，后台继续'}
   }catch(e){status('刷新状态失败：'+e.message)}
  },2200);
 }
 async function open(){
  if(typeof currentProject==='undefined'||!currentProject)return;
  projectId=currentProject.id;data=null;busy=false;dirty=false;
  $('deriveModal').classList.remove('hidden');status('正在读取当前项目…');
  try{
   await load();if(projectId!==currentProject.id)return;
   items=suggestions.map(x=>({...x}));
   refsUI();
   data.routing=currentProject?.creativeWorkflow?.routing||{};
   for(const cap of ['vision','text','image'])modelPicker(cap);
   sourceUI();drawItems();render();
   status('选择要生成的素材，修改每项说明；分析和生图均由你手动确认费用。');
   if(data.derivation.status==='running')pollStatus();
  }catch(e){status('加载失败：'+e.message)}
 }
 function close(){
  $('deriveModal').classList.add('hidden');
  if(poll){clearInterval(poll);poll=null}
 }
 async function runStyle(){
  try{correctProject()}catch(e){return status(e.message)}
  if(busy)return;
  const ids=selectedIds();
  if(!ids.length)return status('请至少选择一张游戏风格图');
  const vision=model('vision');if(!vision.providerId||!vision.model)return status('请填写支持看图的视觉模型和服务商');
  if(!confirm('将用视觉模型分析 '+ids.length+' 张游戏画风图，可能产生费用，确认执行吗？'))return;
  busy=true;status('正在开始画风识别…');
  try{
   await api('projects/'+projectId+'/derive/style',{method:'POST',body:{referenceNodeIds:ids,vision,confirmCost:true}});
   await load();render();pollStatus();
  }catch(e){busy=false;status('画风识别启动失败：'+e.message)}
 }
 async function prepare(){
  try{correctProject()}catch(e){return status(e.message)}
  if(busy)return;
  let styleSource;
  try{styleSource=chosenSource()}catch(e){return status(e.message)}
  const list=items.map(x=>({kind:x.kind,description:x.description.trim()}));
  if(!list.length||list.length>8||list.some(x=>!x.description))return status('请选择 1 至 8 份任务，并填写每项素材内容');
  const text=model('text');if(!text.providerId||!text.model)return status('请选择文字模型，以便按 ai_asset 原版规则生成提示词');
  if(!confirm('将调用一次文字模型，为 '+list.length+' 份素材生成提示词草稿（可能扣费）。这一步不会生图。确认吗？'))return;
  busy=true;status('正在根据 Style DNA 和原始 ai_asset 规则生成素材草稿…');
  try{
   await api('projects/'+projectId+'/derive/prepare',{method:'POST',body:{items:list,referenceNodeIds:selectedIds(),styleSource,text,confirmCost:true}});
   await load();pollStatus();
  }catch(e){busy=false;status('准备素材任务失败：'+e.message)}
 }
 function edits(){
  return [...$('deriveDrafts').querySelectorAll('.derive-prompt:not(:disabled)')].map(node=>({
   id:node.dataset.id,prompt:node.value,ratio:$('deriveDrafts').querySelector('.derive-ratio[data-id="'+node.dataset.id+'"]').value
  }));
 }
 async function save(){
  try{correctProject()}catch(e){return status(e.message)}
  const all=edits();if(!all.length)return;
  try{data=await api('projects/'+projectId+'/derive/drafts',{method:'POST',body:{edits:all}});
   dirty=false;render();status('草稿已保存，可确认批量生图。');
  }catch(e){status('保存草稿失败：'+e.message);throw e}
 }
 async function submit(){
  try{correctProject()}catch(e){return status(e.message)}
  if(busy)return;
  const ids=[...$('deriveDrafts').querySelectorAll('.derive-draft-check:checked')].map(x=>x.value);
  if(!ids.length)return status('请勾选至少一个待生成的草稿');
  const image=model('image');if(!image.providerId||!image.model)return status('请选择真正支持生图的模型');
  const resolution=$('deriveResolution').value,quality=$('deriveQuality').value;
  if(!confirm('即将一次提交 '+ids.length+' 个真实付费生图任务。各任务使用：'+image.model+'，'+resolution+'。超时或取消可能产生费用，确认吗？'))return;
  busy=true;
  try{
   // Persist edits first; never submit stale unreviewed prompts.
   await save();
   const response=await api('projects/'+projectId+'/derive/submit',{method:'POST',body:{ids,image,resolution,quality,confirmCost:true}});
   await load();render();status('已提交 '+response.jobs.length+' 个任务至原有生图队列。可以关闭此窗口，在画布和生成任务里查看结果。');
   if(typeof refreshProjectData==='function')await refreshProjectData();
  }catch(e){status('批量提交失败：'+e.message)}finally{busy=false}
 }
 $('openDeriveAssets').addEventListener('click',open);
 $('deriveClose').addEventListener('click',close);
 $('deriveAnalyze').addEventListener('click',runStyle);
 $('derivePrepare').addEventListener('click',prepare);
 $('deriveSave').addEventListener('click',()=>save().catch(()=>{}));
 $('deriveSubmit').addEventListener('click',submit);
 $('deriveAdd').addEventListener('click',()=>{
  if(items.length>=8)return;
  items.push({kind:'screen',description:''});drawItems();
 });
 $('deriveStyleSource').addEventListener('change',updateStyleStatus);
 $('deriveModal').addEventListener('click',e=>{if(e.target===$('deriveModal'))close()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('deriveModal').classList.contains('hidden'))close()});
})();

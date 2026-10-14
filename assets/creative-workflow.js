/* Hamoki creative workflow — intentionally separate from canvas gestures and normal generation. */
'use strict';
(()=>{
 const by=id=>document.getElementById(id);
 const make=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=String(txt);return e};
 const steps=[['document','读取策划文档'],['style','风格分析师'],['layout','原型分析师'],['director','AI 美术总监'],['generation','画布生图'],['quality','视觉质检']];
 let flow=null,busy=false,openProject='',analyzeTimer=null;
 const message=t=>by('creativeMessage').textContent=t||'';
 function setBusy(val){busy=val;for(const id of ['creativeAnalyze','creativeQuality','creativeDocInput'])by(id).disabled=val;by('creativeAnalyze').textContent=val?'正在执行工作流…':'开始 AI 协同分析'}
 function selectOptions(id,options,value){
  const box=by(id);box.replaceChildren();
  for(const item of options){const option=make('option',null,item.label);option.value=item.value;box.append(option)}
  if(value!=null)box.value=value;
 }
 function stageView(){
  const list=by('creativeSteps');list.replaceChildren();
  for(const [key,name] of steps){
   const status=flow?.stages?.[key]||'pending';
   const row=make('div','creative-step state-'+status);
   row.append(make('span','creative-step-dot',status==='done'?'✓':status==='failed'?'!':status==='running'?'…':''),make('span','creative-step-name',name));
   row.append(make('span','creative-step-state',({done:'完成',running:'处理中',failed:'失败',pending:'待开始'})[status]||'待开始'));
   list.append(row);
  }
 }
 function renderProviders(){
  const items=(typeof providers!=='undefined'?providers:[]).filter(p=>p.hasKey).map(p=>({label:p.name,value:p.id}));
  if(!items.length)items.push({label:'请先在中转站管理配置模型',value:''});
  const config=flow?.routing||{};
  for(const cap of ['text','vision']){
   const which=cap==='text'?'creativeText':'creativeVision';
   const runtime=typeof runtimeRoutes==='object'?runtimeRoutes[cap]:{};
   const val=config[cap]?.providerId||runtime?.providerId|| (typeof activeId!=='undefined'?activeId:'')||items[0].value;
   selectOptions(which+'Provider',items,val);
   const id=by(which+'Provider').value;
   const selected=(typeof providers!=='undefined'?providers:[]).find(p=>p.id===id);
   by(which+'Model').value=config[cap]?.model||runtime?.model||selected?.capabilities?.[cap]?.defaultModel||(cap==='vision'?selected?.visionModel:selected?.textModel)||'';
  }
 }
 function renderRefs(){
  const box=by('creativeStyleRefs');box.replaceChildren();
  const docIds=new Set((flow?.document?.images||[]).map(x=>x.nodeId));
  const nodes=(typeof currentProject==='object'?currentProject?.nodes:[])||[];
  const options=nodes.filter(n=>n.kind!=='note'&&!docIds.has(n.id));
  if(!options.length){box.append(make('span','creative-placeholder','画布上还没有游戏风格参考图。请先将游戏实际 UI 截图添加到画布，然后重新打开这里。'));return}
  for(const n of options.slice(0,100)){
   const label=make('label','creative-ref-item');
   const input=make('input');input.type='checkbox';input.value=n.id;input.checked=!!flow?.styleNodeIds?.includes(n.id);
   input.addEventListener('change',()=>{const checked=[...box.querySelectorAll('input:checked')];if(checked.length>5){input.checked=false;message('最多选择 5 张美术风格参考图')}});
   const img=make('img');let src='';
   try{src=typeof nodeImage==='function'?nodeImage(n):n.url}catch{}
   img.src=src||n.url||'';img.alt='风格参考';img.loading='lazy';
   label.append(input,img,make('span',null,n.title||'画布图 '+n.id.slice(0,6)));box.append(label);
  }
 }
 function render(){
  if(!flow)return;
  stageView();renderProviders();renderRefs();
  const doc=flow.document,info=by('creativeDocumentInfo'),gallery=by('creativeDocumentImages');
  info.textContent=doc?`${doc.name} · 提取 ${(doc.text||'').length} 字 · ${doc.images.length} 张内嵌图片`:'还没有上传文档，支持 .docx（不超过 12MB）。';
  gallery.replaceChildren();
  const imgs=(doc?.images||[]);
  imgs.forEach((im,i)=>{
   const figure=make('figure','creative-doc-picture'),img=make('img');
   img.src=im.url;img.loading='lazy';img.alt='文档中的原型图 '+(i+1);
   figure.append(img,make('figcaption',null,'文档图片 '+(i+1)));gallery.append(figure);
  });
  selectOptions('creativeLayoutSelect',imgs.length?imgs.map((im,i)=>({value:String(i),label:'文档图片 '+(i+1)})):[{value:'0',label:'暂未提取原型图'}],String(flow.layoutImageIndex||0));
  by('creativeNotes').value=flow.notes||'';
  by('creativeStyleResult').textContent=flow.analysis?.style||'尚未分析';
  by('creativeLayoutResult').textContent=flow.analysis?.layout||'尚未分析';
  by('creativeDirectorResult').textContent=flow.analysis?.director||'尚未分析';
  by('creativeQualityResult').textContent=flow.quality?.report||'尚未质检';
  by('creativeUsePrompt').disabled=!flow.analysis?.prompt||busy;
  const results=(typeof historyItems!=='undefined'?historyItems:[]).filter(h=>h.projectId===openProject);
  selectOptions('creativeGeneratedSelect',results.length?results.slice(0,80).map((h,i)=>({value:h.id,label:(h.model||'作品')+' · '+(h.createdAt||'').slice(0,16)+' · #'+(i+1)})):[{value:'',label:'当前项目暂无生成作品'}],flow.quality?.historyId||results[0]?.id||'');
  by('creativeQuality').disabled=!flow.analysis?.director||!results.length||busy;
  by('creativeUseFix').disabled=!flow.quality?.report;
  if(flow.error)message('执行失败：'+flow.error);
  else if(!busy)message(flow.status==='ready'?'方案就绪。可将提示词送入生图操作台。':flow.status==='review'?'质检完成，请查看报告。':'');
 }
 async function load(){
  if(!openProject)return;
  const id=openProject;
  const out=await api('projects/'+id+'/creative');
  if(openProject!==id)return;
  flow=out.flow;render();
 }
 async function open(){
  if(typeof authorized==='undefined'||!authorized){show('loginModal');return}
  if(!currentProject){toast('请先打开一个项目');return}
  openProject=currentProject.id;show('creativeModal');message('读取当前项目…');
  try{await load()}catch(e){message('加载失败：'+e.message)}
 }
 async function sendFile(){
  const file=by('creativeDocInput').files?.[0];if(!file)return;
  if(!/\.docx$/i.test(file.name)||file.size>12*1024*1024){message('请选择不超过 12MB 的 .docx 文件');return}
  if(flow?.document && !confirm('替换当前项目的策划文档，并清空旧 AI 分析结果？旧画布图片会保留。'))return;
  setBusy(true);message('正在读取和上传 Word 中的文字、表格与原型图…');
  try{
   const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('读取 Word 失败'));reader.readAsDataURL(file)});
   await api('projects/'+openProject+'/creative/document',{method:'POST',body:{name:file.name,data:encoded}});
   if(typeof refreshProjectData==='function')await refreshProjectData();
   await load();toast('已提取 Word 文档，可继续选择风格参考图');
  }catch(e){message('Word 解析失败：'+e.message)}
  finally{by('creativeDocInput').value='';setBusy(false)}
 }
 function gather(){return {
  styleNodeIds:[...by('creativeStyleRefs').querySelectorAll('input:checked')].map(x=>x.value),
  layoutImageIndex:Number(by('creativeLayoutSelect').value)||0,
  notes:by('creativeNotes').value,
  routing:{
   text:{providerId:by('creativeTextProvider').value,model:by('creativeTextModel').value.trim()},
   vision:{providerId:by('creativeVisionProvider').value,model:by('creativeVisionModel').value.trim()}
  }
 }}
 async function waitForCreative(projectId,wanted){
  const started=Date.now();
  while(Date.now()-started<330000){
   await new Promise(resolve=>setTimeout(resolve,1800));
   const out=await api('projects/'+projectId+'/creative');
   if(openProject!==projectId)return;
   flow=out.flow;stageView();
   if(flow.status==='failed')throw Error(flow.error||'AI 运行失败');
   if(wanted.includes(flow.status)){render();return}
   const running=steps.find(x=>flow.stages?.[x[0]]==='running');
   message('AI 正在处理：'+(running?.[1]||'等待任务启动')+' · 你可以关闭面板，任务会继续执行');
  }
  throw Error('后台任务仍在处理，请稍后打开工作流查看状态，不要重复启动');
 }
 async function startAnalysis(){
  if(!flow?.document){message('请先上传含有原型的 Word 文档');return}
  if(!by('creativeStyleRefs').querySelector('input:checked')){message('请先从画布选择至少一张游戏风格参考图');return}
  if(!flow.document.images?.length){message('文档未提取出可用原型图');return}
  if(!confirm('即将使用你配置的视觉模型和文字模型分析参考图与 Word 文档，会产生实际 API 费用。开始吗？'))return;
  setBusy(true);message('正在保存工作流设置…');
  try{
   await api('projects/'+openProject+'/creative/settings',{method:'POST',body:gather()});
   await load();message('AI 团队已启动：正在分析游戏风格与文档原型…');
   const projectId=openProject;
   analyzeTimer=setInterval(async()=>{if(projectId!==openProject)return;try{const out=await api('projects/'+projectId+'/creative');if(out.flow){flow=out.flow;stageView();message('正在执行：'+steps.find(s=>flow?.stages?.[s[0]]==='running')?.[1])}}catch{}},2500);
   await api('projects/'+projectId+'/creative/analyze',{method:'POST',body:{}});
   await waitForCreative(projectId,['ready','review']);toast('AI 团队创作方案已完成');
  }catch(e){message('工作流失败：'+e.message);try{await load()}catch{}}
  finally{clearInterval(analyzeTimer);analyzeTimer=null;setBusy(false);render()}
 }
 function sendToCanvas(replace=true){
  if(!flow?.analysis?.prompt)return message('请先完成分析');
  if(!currentProject||currentProject.id!==openProject)return message('项目已切换，请重新打开当前流程');
  if(typeof setComposerMode==='function')setComposerMode('image');
  by('prompt').value=(replace||!by('prompt').value.trim()?'':by('prompt').value.trim()+'\n\n')+flow.analysis.prompt;
  const used=[...flow.styleNodeIds.map(nodeId=>({nodeId,role:'style'}))];
  const nodeId=flow.document?.images?.[flow.layoutImageIndex]?.nodeId;
  if(nodeId)used.push({nodeId,role:'shape'});
  if(typeof referenceNodeRoles!=='undefined'){referenceNodeRoles=used.slice(0,8);if(typeof renderContext==='function')renderContext()}
  hide('creativeModal');by('prompt').focus();toast('创作方案与参考图已进入操作台，点击生成才会调用图片模型');
 }
 async function review(){
  const historyId=by('creativeGeneratedSelect').value;if(!historyId)return message('请先选择一张生成图');
  if(!confirm('将调用视觉模型对照风格、原型和生成图，可能产生 API 费用。开始质检吗？'))return;
  setBusy(true);message('独立视觉质检正在检查三张图片…');
  try{const id=openProject;await api('projects/'+id+'/creative/quality',{method:'POST',body:{historyId}});await waitForCreative(id,['review']);toast('视觉质检完成')}catch(e){message('质检失败：'+e.message);try{await load()}catch{}}
  finally{setBusy(false);render()}
 }
 document.getElementById('openCreativeWorkflow').addEventListener('click',open);
 by('creativeDocInput').addEventListener('change',sendFile);
 by('creativeAnalyze').addEventListener('click',startAnalysis);
 by('creativeUsePrompt').addEventListener('click',()=>sendToCanvas(true));
 by('creativeQuality').addEventListener('click',review);
 by('creativeUseFix').addEventListener('click',()=>{
  if(!flow?.quality?.report)return;
  const addition='\n\n【AI 质检返工要求】\n'+flow.quality.report;
  sendToCanvas(true);
  by('prompt').value=(flow.analysis?.prompt||'')+addition;
  toast('已携带风格及原型参考图和返工要求。请确认后手动生成。');
 });
})();

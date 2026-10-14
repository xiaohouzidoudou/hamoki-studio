/* Word-led game UI studio: one project's documents, scenes and locked visual style. */
'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const el=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=String(txt);return e};
 const stages=[['document','策划文档'],['style','风格 DNA'],['layout','原型分析'],['director','美术总监'],['generation','画布生图'],['quality','视觉质检']];
 let f=null,projectId=null,busy=false,initialized=false;
 const say=t=>{$('creativeMessage').textContent=t||''};
 const active=()=>f?.pages?.find(x=>x.id===f.activePageId)||null;
 const pageDoc=p=>f?.documents?.find(d=>d.id===p?.docId)||null;
 const picture=(p,idx)=>pageDoc(p)?.images?.find(x=>x.index===idx)||null;
 function pick(id,items,val){
  const node=$(id);node.replaceChildren();
  for(const o of items){const x=el('option',null,o.label);x.value=String(o.value);node.append(x)}
  if(val!=null)node.value=String(val);
 }
 function setBusy(value){busy=value;for(const name of ['creativeAnalyze','creativeAnalyzeAll','creativeSplit','creativeQuality','creativeSavePage','creativeDocInput'])$(name).disabled=value}
 function roleLines(){
  const root=$('creativeSteps');root.replaceChildren();
  for(const [key,title] of stages){
   const state=f?.stages?.[key]||'pending',row=el('div','creative-step state-'+state);
   row.append(el('span','creative-step-dot',state==='done'?'✓':state==='running'?'…':state==='failed'?'!':''),
     el('span','creative-step-name',title),el('span','creative-step-state',({done:'完成',running:'执行中',failed:'失败',pending:'待开始'})[state]));
   root.append(row);
  }
 }
 function providersUI(){
  const pp=typeof providers==='undefined'?[]:providers;
  const list=pp.filter(p=>p.hasKey).map(p=>({value:p.id,label:p.name}));
  if(!list.length)list.push({value:'',label:'先配置文字/视觉中转站'});
  for(const cap of ['text','vision']){
   const prefix=cap==='text'?'creativeText':'creativeVision';
   const current=f?.routing?.[cap]||{};
   const runtime=typeof runtimeRoutes!=='undefined'?runtimeRoutes?.[cap]||{}:{};
   const val=current.providerId||runtime.providerId||(typeof activeId!=='undefined'?activeId:'')||list[0].value;
   pick(prefix+'Provider',list,val);
   const p=pp.find(p=>p.id===$(prefix+'Provider').value);
   $(prefix+'Model').value=current.model||runtime.model||p?.capabilities?.[cap]?.defaultModel||(cap==='text'?p?.textModel:p?.visionModel)||'';
  }
 }
 function refsUI(){
  const box=$('creativeStyleRefs'),ids=new Set((f?.documents||[]).flatMap(d=>d.images.map(i=>i.nodeId)));
  box.replaceChildren();
  const nodes=(typeof currentProject!=='undefined'?currentProject?.nodes||[]:[]).filter(n=>n.kind!=='note'&&!ids.has(n.id));
  if(!nodes.length){box.append(el('div','creative-placeholder','暂时没有风格参考图。先把游戏实际 UI 截图拖到画布，再重新打开工作流。'));return}
  for(const n of nodes.slice(0,100)){
   const label=el('label','creative-ref-item'),input=el('input');input.type='checkbox';input.value=n.id;input.checked=f.styleNodeIds?.includes(n.id)||false;
   input.addEventListener('change',()=>{if(box.querySelectorAll('input:checked').length>5){input.checked=false;say('最多选择 5 张 STYLE 风格图')}});
   const thumb=el('img');thumb.alt='游戏风格';thumb.loading='lazy';
   try{thumb.src=typeof nodeImage==='function'?nodeImage(n):n.url}catch{thumb.src=n.url||''}
   label.append(input,thumb,el('span',null,n.title||'风格素材'));box.append(label);
  }
 }
 function docsUI(){
  const docs=f?.documents||[],allImages=docs.reduce((s,x)=>s+x.images.length,0);
  $('creativeDocumentInfo').textContent=docs.length?`已收录 ${docs.length} 份 Word · ${allImages} 张内嵌图 · ${f.pages.length} 个初步页面任务`:'尚未上传 Word。支持连续上传多份，每份最大 12MB。';
  const list=$('creativeDocList');list.replaceChildren();
  docs.forEach((d,i)=>{
   const row=el('div','creative-document-row');
   row.append(el('span','creative-doc-index',String(i+1).padStart(2,'0')),el('strong',null,d.name),el('span','creative-doc-stat',d.text.length+' 字 · '+d.images.length+' 图'));
   list.append(row);
  });
  const grid=$('creativeDocumentImages');grid.replaceChildren();
  const page=active(),doc=pageDoc(page);
  for(const im of doc?.images||[]){
   const figure=el('figure','creative-doc-picture'),img=el('img');img.src=im.url;img.loading='lazy';img.alt=doc.name+' 的原型图 '+(im.index+1);
   figure.append(img,el('figcaption',null,'原型 '+(im.index+1)));grid.append(figure);
  }
 }
 function pagesUI(){
  const pages=f?.pages||[],selected=active();
  $('creativePageSummary').textContent=pages.length?`识别 ${pages.length} 个页面任务 · ${pages.filter(p=>p.imageIndexes?.length).length} 个关联原型 · ${pages.filter(p=>p.analysis?.prompt).length} 份设计方案`:'Word 上传后自动出现页面，标题不明确时允许 AI 智能拆页。';
  const list=$('creativePageList');list.replaceChildren();
  for(const [i,page] of pages.entries()){
   const btn=el('button','creative-page-card'+(page.id===selected?.id?' is-active':''));btn.type='button';btn.dataset.pageId=page.id;
   const details=el('span','creative-page-body');
   details.append(el('strong',null,page.name),el('small',null,page.sourceName+(page.imageIndexes?.length?' · 有原型':' · 缺原型')));
   const stat=page.analysis?.prompt?'方案已备好':page.status==='analyzing'?'分析中':page.status==='failed'?'分析失败':page.imageIndexes?.length?'待设计':'待补充';
   btn.append(el('span','creative-page-no',String(i+1).padStart(2,'0')),details,el('span','creative-page-tag',stat));
   btn.addEventListener('click',()=>choosePage(page.id));
   list.append(btn);
  }
  $('creativePageTitle').textContent=selected?selected.name:'请先上传 Word';
  $('creativePageSource').textContent=selected?`来源：${selected.sourceName} · ${selected.imageIndexes?.length?'已经关联原型图':'没有可靠原型，请核对策划文档'}`:'';
  $('creativePageRequirement').value=selected?.requirements||'';
  $('creativeSavePage').disabled=!selected||busy;
  const d=pageDoc(selected),imgs=d?.images||[];
  pick('creativeLayoutSelect',[{value:'-1',label:'未指定原型图（仅按文字分析）'},...imgs.map(img=>({value:img.index,label:d.name+' · 原型 '+(img.index+1)}))],selected?(selected.layoutImageIndex??selected.imageIndexes?.[0]??-1):-1);
  $('creativeAnalyze').disabled=!selected||busy;
  $('creativeAnalyzeAll').disabled=!pages.some(p=>!p.analysis?.prompt)||busy;
 }
 function resultsUI(){
  const page=active(),analysis=page?.analysis||{};
  $('creativeStyleResult').textContent=f?.styleDNA||'尚未分析。请添加游戏真实 UI 参考图后执行页面分析。';
  $('creativeLayoutResult').textContent=analysis.layout||'尚未分析';
  $('creativeDirectorResult').textContent=analysis.director||'尚未分析';
  $('creativeUsePrompt').disabled=!analysis.prompt||busy;
  $('creativeQualityResult').textContent=page?.quality?.report||'尚未质检';
  $('creativeStyleStatus').textContent=f?.styleDNA?'风格已建立，可跨页面复用。':'尚无 Style DNA，生成风格会不稳定。';
  $('creativeStyleLock').textContent=f?.styleLocked?'风格已锁定 · 可点击解除':'锁定当前风格';
  const rows=(typeof historyItems!=='undefined'?historyItems:[]).filter(h=>h.projectId===projectId);
  pick('creativeGeneratedSelect',rows.length?rows.slice(0,80).map((h,i)=>({value:h.id,label:(h.model||'作品')+' · '+(h.createdAt||'').slice(0,16)+' · #'+(i+1)})):[{value:'',label:'当前项目暂无生成图'}],page?.quality?.historyId||rows[0]?.id||'');
  $('creativeQuality').disabled=!analysis.director||!rows.length||busy;
  $('creativeUseFix').disabled=!page?.quality?.report||busy;
 }
 function render(){
  if(!f)return;
  roleLines();providersUI();refsUI();docsUI();pagesUI();resultsUI();
  $('creativeNotes').value=f.notes||'';
  if(f.error)say('执行失败：'+f.error);
  else if(!busy)say(f.status==='ready'?'页面设计方案已准备好，可送到生图操作台。':f.status==='split-ready'?'AI 智能拆页完成，请逐项核对原型关联。':'');
 }
 async function load(){
  const id=projectId;if(!id)return;
  const out=await api('projects/'+id+'/creative');
  if(projectId!==id)return;f=out.flow;render();
 }
 async function open(){
  if(typeof authorized==='undefined'||!authorized){show('loginModal');return}
  if(typeof currentProject==='undefined'||!currentProject){toast('请先选择项目');return}
  projectId=currentProject.id;show('creativeModal');say('正在读取项目文档和页面…');
  try{await load()}catch(e){say('加载失败：'+e.message)}
 }
 async function upload(){
  const files=[...($('creativeDocInput').files||[])];
  if(!files.length)return;
  if(files.length+((f?.documents||[]).length)>12){say('每个项目最多 12 份 Word，请减少文件数量');return}
  if(files.some(x=>!/\.docx$/i.test(x.name)||x.size>12*1024*1024)){say('仅支持每份不超过 12MB 的 .docx');return}
  setBusy(true);
  try{
   for(const [i,file] of files.entries()){
    say(`正在导入第 ${i+1}/${files.length} 份：${file.name}`);
    const b64=await new Promise((yes,no)=>{const r=new FileReader();r.onload=()=>yes(String(r.result).split(',')[1]);r.onerror=()=>no(Error('浏览器读取文件失败'));r.readAsDataURL(file)});
    await api('projects/'+projectId+'/creative/document',{method:'POST',body:{name:file.name,data:b64}});
   }
   if(typeof refreshProjectData==='function')await refreshProjectData();
   await load();toast('Word 已导入并自动建立页面任务');
  }catch(e){say('导入中断：'+e.message+'。已成功导入的文件仍保留。');try{await load()}catch{}}
  finally{$('creativeDocInput').value='';setBusy(false)}
 }
 function settings(){
  return {styleNodeIds:[...$('creativeStyleRefs').querySelectorAll('input:checked')].map(x=>x.value),
    notes:$('creativeNotes').value,
    activePageId:f.activePageId,
    routing:{
     text:{providerId:$('creativeTextProvider').value,model:$('creativeTextModel').value.trim()},
     vision:{providerId:$('creativeVisionProvider').value,model:$('creativeVisionModel').value.trim()}
    }};
 }
 async function saveSettings(){
  const data=settings();
  const refsChanged=JSON.stringify(data.styleNodeIds)!==JSON.stringify(f.styleNodeIds||[]);
  if(refsChanged&&f.styleDNA&&!confirm('更换风格参考图会清空当前 Style DNA 和旧页面方案，继续吗？'))throw Error('已取消更改风格图');
  const r=await api('projects/'+projectId+'/creative/settings',{method:'POST',body:data});f=r.flow;return f;
 }
 async function choosePage(pageId){
  if(busy||!f||pageId===f.activePageId)return;
  const old=active();
  if(old&&($('creativePageRequirement').value!==old.requirements)&&!confirm('当前页面需求尚未保存，切换页面将丢失修改。继续吗？'))return;
  try{
   const r=await api('projects/'+projectId+'/creative/page',{method:'POST',body:{pageId}});
   f=r.flow;render();
  }catch(e){say('切换页面失败：'+e.message)}
 }
 async function savePage(){
  if(!active())return;
  setBusy(true);
  try{
   const r=await api('projects/'+projectId+'/creative/page',{method:'POST',body:{
    pageId:f.activePageId,prototypeIndex:Number($('creativeLayoutSelect').value),requirements:$('creativePageRequirement').value}});
   f=r.flow;render();toast('页面需求和原型关联已保存');
  }catch(e){say('保存失败：'+e.message)}
  finally{setBusy(false)}
 }
 async function waitUntil(wanted){
  const id=projectId,start=Date.now();
  while(Date.now()-start<420000){
   await new Promise(ok=>setTimeout(ok,1700));
   const out=await api('projects/'+id+'/creative');
   if(id!==projectId)return;
   f=out.flow;roleLines();
   if(f.status==='failed')throw Error(f.error||'AI 工作流失败');
   if(wanted.includes(f.status)){render();return}
   say(f.progress?.pageName?`正在处理「${f.progress.pageName}」 · ${f.progress.done}/${f.progress.total} 页面`:'AI 正在处理文档或生成创作方案。你可以关闭面板，后台仍会继续。');
  }
  throw Error('任务仍在后台执行，稍后重新打开面板查看，不要重复提交');
 }
 async function run(action,batch=false){
  if(!(f?.documents||[]).length){say('请先上传 Word 文档');return}
  if(action==='analyze'&&!active()){say('请先选择页面任务');return}
  if(action==='split'&&!$('creativeTextModel').value.trim()){say('请先配置文字模型 ID 才能执行 AI 智能拆页');return}
  const label=action==='split'?'AI 智能拆页':batch?'批量生成页面创作方案':'AI 分析当前页面';
  const count=batch?Math.min(8,(f.pages||[]).filter(p=>!p.analysis?.prompt).length):1;
  if(!confirm(`即将调用你配置的 AI 模型执行「${label}」，可能产生多次 API 费用${batch?'（最多 '+count+' 页，每页最多一次原型识图及一次文字创作）':''}。确定开始？`))return;
  setBusy(true);say('正在保存 AI 模型与风格配置…');
  try{
   await saveSettings();
   await api('projects/'+projectId+'/creative/'+action,{method:'POST',body:action==='analyze'?{pageId:f.activePageId,batch}:{}});
   await waitUntil(action==='split'?['split-ready']:['ready','review']);
   toast(action==='split'?'页面智能拆分完成':'AI 页面设计方案完成');
  }catch(e){say('执行失败：'+e.message);try{await load()}catch{}}
  finally{setBusy(false);if(f)render()}
 }
 function canvasPrompt(extra=''){
  const page=active();
  if(!page?.analysis?.prompt){say('请先生成当前页面的美术总监方案');return}
  if(!currentProject||currentProject.id!==projectId){say('当前项目已切换，请重新打开工作流');return}
  if(typeof setComposerMode==='function')setComposerMode('image');
  $('prompt').value=page.analysis.prompt+extra;
  const refs=(f.styleNodeIds||[]).map(nodeId=>({nodeId,role:'style'}));
  const proto=picture(page,page.layoutImageIndex??page.imageIndexes?.[0]);
  if(proto?.nodeId)refs.push({nodeId:proto.nodeId,role:'shape'});
  if(typeof referenceNodeRoles!=='undefined'){
   referenceNodeRoles=refs.slice(0,8);
   if(typeof renderContext==='function')renderContext();
  }
  hide('creativeModal');$('prompt').focus();
  toast('已载入「'+page.name+'」创作方案与参考图，仍需你手动点击生成');
 }
 async function review(){
  const h=$('creativeGeneratedSelect').value;if(!h)return say('请选择一张当前项目生成作品');
  if(!confirm('将调用视觉模型审核当前页面的生成图，产生 API 费用。确定吗？'))return;
  setBusy(true);say('正在对照原型与游戏美术风格质检…');
  try{await saveSettings();await api('projects/'+projectId+'/creative/quality',{method:'POST',body:{historyId:h}});await waitUntil(['review']);toast('质检完成')}
  catch(e){say('质检失败：'+e.message);try{await load()}catch{}}
  finally{setBusy(false);if(f)render()}
 }
 $('openCreativeWorkflow').addEventListener('click',open);
 $('creativeDocInput').addEventListener('change',upload);
 $('creativeSplit').addEventListener('click',()=>run('split'));
 $('creativeSavePage').addEventListener('click',savePage);
 $('creativeAnalyze').addEventListener('click',()=>run('analyze'));
 $('creativeAnalyzeAll').addEventListener('click',()=>run('analyze',true));
 $('creativeStyleLock').addEventListener('click',async()=>{
  if(!f?.styleDNA){say('先分析一张游戏风格图才能锁定 Style DNA');return}
  try{const data={...settings(),styleLocked:!f.styleLocked};const r=await api('projects/'+projectId+'/creative/settings',{method:'POST',body:data});f=r.flow;render()}
  catch(e){say('风格状态保存失败：'+e.message)}
 });
 $('creativeUsePrompt').addEventListener('click',()=>canvasPrompt());
 $('creativeQuality').addEventListener('click',review);
 $('creativeUseFix').addEventListener('click',()=>{const report=active()?.quality?.report;if(report)canvasPrompt('\n\n【视觉质检返工要求】\n'+report)});
})();

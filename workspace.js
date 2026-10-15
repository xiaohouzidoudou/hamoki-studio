/** Hamoki Studio 0.6.4: one isolated application context per anonymous browser workspace. */
'use strict';
const nativeProcess=require('node:process');
module.exports=function createWorkspace(options){
 if(!options||!options.env||!options.limiter)throw Error('Private workspace options required');
 const diag=info=>{try{options.log?.(info)}catch(e){console.warn('[Hamoki diagnostics write]',e.code||'failed')}};
 const process={env:{...nativeProcess.env,...options.env},pid:nativeProcess.pid,exit(){throw Error('Workspace misconfigured')}};


const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {checkedURL,imageFromDataURL,guessMime,extension,reverse:upstreamReverse,generate:upstreamGenerate,listModels:upstreamListModels,generateText,streamText,analyzeCreativeImages}=require('./lib/upstream');
const {parseDocx,MAX_DOCX}=require('./lib/creative-docx');
const creative=require('./lib/creative-workflow');
const creativeUpstream=require('./lib/creative-upstream');
const creativePages=require('./lib/creative-pages');
const assistantMemory=require('./lib/assistant-memory');
const assistantReview=require('./lib/assistant-review');
const {nextGeneratedPosition}=require('./lib/canvas-placement');
const generate=(...args)=>options.limiter.run(()=>upstreamGenerate(...args));
const reverse=(...args)=>options.limiter.run(()=>upstreamReverse(...args));
const listModels=(...args)=>options.limiter.run(()=>upstreamListModels(...args));
const {pack}=require('./lib/zip');
const ROOT=__dirname,PORT=Number(process.env.PORT||8028),HOST=process.env.HOST||'127.0.0.1';
const PASSWORD=process.env.APP_PASSWORD||'';
const BASE=(process.env.APP_BASE_PATH||'').replace(/\/$/,'');
if(BASE&&!/^\/[a-zA-Z0-9_-]+$/.test(BASE))throw Error('APP_BASE_PATH must be a single path segment');
const DEMO_MODE=process.env.DEMO_MODE==='1';
const ALLOWED_HOST=(process.env.APP_ALLOWED_HOST||'').toLowerCase();
const DATA_DIR=path.resolve(process.env.DATA_DIR||path.join(ROOT,'data'));
const MEDIA_DIR=path.join(DATA_DIR,'media');
const PREVIEW_DIR=path.join(DATA_DIR,'previews');
const quotaSetting=Number(process.env.MEDIA_QUOTA_GB||8);
const MEDIA_QUOTA_BYTES=Math.floor((Number.isFinite(quotaSetting)?Math.max(.000001,Math.min(200,quotaSetting)):8)*1024**3);
// Only one or two paid upstream requests run at once on a small VPS.
const CONCURRENCY=Math.max(1,Math.min(2,Math.floor(Number(process.env.MAX_CONCURRENT||1)||1)));
const MAX_QUEUED=12;let retryTimer=null;
const BODY_LIMIT=55*1024*1024;
if(PASSWORD.length<12){console.error('请先设置至少 12 位的 APP_PASSWORD，然后重新启动。');process.exit(1)}
fs.mkdirSync(DATA_DIR,{recursive:true,mode:0o700});fs.mkdirSync(MEDIA_DIR,{recursive:true,mode:0o700});fs.mkdirSync(PREVIEW_DIR,{recursive:true,mode:0o700});
const stateFile=path.join(DATA_DIR,'providers.enc.json'),saltFile=path.join(DATA_DIR,'encryption.salt'),historyFile=path.join(DATA_DIR,'history.json'),jobsFile=path.join(DATA_DIR,'jobs.json'),projectsFile=path.join(DATA_DIR,'projects.json');
if(!fs.existsSync(saltFile))fs.writeFileSync(saltFile,crypto.randomBytes(32),{flag:'wx',mode:0o600});
const key=crypto.scryptSync(process.env.APP_ENCRYPTION_KEY||PASSWORD,fs.readFileSync(saltFile),32);
function atomic(filename,text){const temp=filename+'.'+process.pid+'.tmp';fs.writeFileSync(temp,text,{mode:0o600});fs.renameSync(temp,filename)}
function encrypt(state){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(JSON.stringify(state),'utf8'),c.final()]);atomic(stateFile,JSON.stringify({v:1,iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')}))}
function decrypt(){if(!fs.existsSync(stateFile))return {providers:[],activeId:null};try{const p=JSON.parse(fs.readFileSync(stateFile,'utf8')),d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(p.iv,'base64'));d.setAuthTag(Buffer.from(p.tag,'base64'));const val=JSON.parse(Buffer.concat([d.update(Buffer.from(p.data,'base64')),d.final()]).toString('utf8'));return val}catch{throw Error('已有配置解密失败：请输入之前相同的 APP_PASSWORD 或 APP_ENCRYPTION_KEY；不要删除数据文件')}}
function readData(file,fallback){if(!fs.existsSync(file))return fallback;return JSON.parse(fs.readFileSync(file,'utf8'))}
let state=decrypt(),history=readData(historyFile,[]);
// Migrate historical model hints, then permanently retire saved global route bindings.
if(state.bindings&&typeof state.bindings==='object'){
 for(const cap of ['text','vision']){
  const legacy=state.bindings[cap],p=state.providers?.find(x=>x.id===legacy?.providerId);
  if(p&&typeof legacy.model==='string'&&legacy.model.trim()&&!p.capabilities?.[cap]?.defaultModel)
   p.capabilities={...(p.capabilities||{}),[cap]:{...(p.capabilities?.[cap]||{}),defaultModel:legacy.model.trim()}};
 }
 delete state.bindings;encrypt(state);
}
// Per-provider capability defaults remain optional hints; runtime models never depend on saved global routing.
const CAPABILITIES=['text','image','vision','edit'];
function legacyModel(p,cap){return cap==='image'||cap==='edit'?p.imageModel:cap==='vision'?p.visionModel:(p.textModel||'')}
function normalizedCapability(p,cap){
 const c=p.capabilities?.[cap]||{};
 return {enabled:c.enabled!==false,inheritBaseUrl:c.inheritBaseUrl!==false,inheritApiKey:c.inheritApiKey!==false,
  baseUrl:c.baseUrl||'',apiKey:c.apiKey||'',inheritProtocol:c.inheritProtocol!==false,mode:c.mode||p.mode,defaultModel:c.defaultModel||legacyModel(p,cap)||'',models:Array.isArray(c.models)?c.models.slice(0,500):[]};
}
function effectiveProvider(p,cap){
 if(!p)throw Object.assign(Error('未设置 '+cap+' 服务商'),{status:400});
 const c=normalizedCapability(p,cap);if(!c.enabled)throw Object.assign(Error('此中转站未启用 '+cap+' 能力'),{status:400});
 const url=c.inheritBaseUrl?p.url:c.baseUrl,apiKey=c.inheritApiKey?p.apiKey:c.apiKey;
 if(!url||!apiKey)throw Object.assign(Error('请先配置该能力的 API 地址和密钥'),{status:400});
 const mode=c.inheritProtocol?p.mode:c.mode;return {...p,url,apiKey,mode,imageMode:mode==='gemini'?'gemini':mode==='grsai'?'grsai':(['gemini','grsai'].includes(p.imageMode)?'images':p.imageMode),imageModel:c.defaultModel||p.imageModel,visionModel:c.defaultModel||p.visionModel};
}
function safeCapabilities(p){return Object.fromEntries(CAPABILITIES.map(cap=>{const c=normalizedCapability(p,cap);return [cap,{enabled:c.enabled,inheritBaseUrl:c.inheritBaseUrl,inheritApiKey:c.inheritApiKey,inheritProtocol:c.inheritProtocol,mode:c.mode,baseUrl:c.inheritBaseUrl?'':c.baseUrl,hasKey:!!(c.inheritApiKey?p.apiKey:c.apiKey),defaultModel:c.defaultModel,models:c.models}]}))}
async function updateCapabilities(p,incoming){
 if(!incoming||typeof incoming!=='object')return;
 for(const cap of CAPABILITIES){if(!Object.prototype.hasOwnProperty.call(incoming,cap))continue;
  const c=incoming[cap];if(!c||typeof c!=='object'||Array.isArray(c))throw Error('能力配置格式不正确');
  const prior=normalizedCapability(p,cap),next={...prior};
  if(c.enabled!==undefined)next.enabled=!!c.enabled;
  if(c.inheritBaseUrl!==undefined)next.inheritBaseUrl=!!c.inheritBaseUrl;
  if(c.inheritApiKey!==undefined)next.inheritApiKey=!!c.inheritApiKey;
   if(c.inheritProtocol!==undefined)next.inheritProtocol=!!c.inheritProtocol;
   if(c.mode!==undefined){if(!['openai','gemini','grsai'].includes(c.mode))throw Error('独立接口协议不支持');next.mode=c.mode;}
  if(c.baseUrl!==undefined){next.baseUrl=trim(c.baseUrl,600);if(next.baseUrl&&(await checkedURL(next.baseUrl)).u.search)throw Error('能力 API 地址不能包含查询参数')}
  if(c.apiKey!==undefined&&c.apiKey!=='')next.apiKey=trim(c.apiKey,1200);
  if(c.clearKey===true)next.apiKey='';
  if(c.defaultModel!==undefined)next.defaultModel=c.defaultModel?assertModel(c.defaultModel):'';
  if(Array.isArray(c.models))next.models=[...new Set(c.models.map(v=>trim(v,150)).filter(Boolean))].slice(0,500);
  p.capabilities={...(p.capabilities||{}),[cap]:next};
 }
}

if(DEMO_MODE && !state.providers.length){
 state.providers=[{id:crypto.randomUUID(),name:'GPT Image · 测试模型',url:'https://example.invalid/v1',mode:'openai',imageMode:'images',imageModel:'gpt-image-1.5',visionModel:'gpt-4o-mini',apiKey:''},{id:crypto.randomUUID(),name:'Nano Banana · 测试模型',url:'https://example.invalid/v1beta',mode:'gemini',imageMode:'gemini',imageModel:'gemini-2.5-flash-image',visionModel:'gemini-2.5-flash',apiKey:''}];state.activeId=state.providers[0].id;encrypt(state);
}
let persisted=readData(jobsFile,{jobs:[],paused:false});
let jobs=Array.isArray(persisted.jobs)?persisted.jobs:[],paused=!!persisted.paused;
if(jobs.some(j=>j.status==='running')){paused=true;for(const j of jobs)if(j.status==='running')j.status='interrupted'}
const sessions=new Map(),attempts=new Map(),controllers=new Map(),providerBusy=new Set(),activeChats=new Set();let running=0;
const time=()=>new Date().toISOString(),trim=(v,n=200)=>String(v||'').trim().slice(0,n);
// Web-first project store. All canvas coordinates are expressed in world pixels.
let projectDB=readData(projectsFile,{projects:[]});
let projects=Array.isArray(projectDB.projects)?projectDB.projects:[];
const num=(value,fallback=0,min=-200000,max=200000)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
const clampText=(value,max=10000)=>typeof value==='string'?value.slice(0,max):'';
function makeProject(title){return {id:crypto.randomUUID(),title:clampText(title||'未命名项目',70),createdAt:time(),updatedAt:time(),revision:0,archived:false,viewport:{x:220,y:130,scale:1},nodes:[],messages:[],assistantMemory:assistantMemory.normalize(null)}}
function saveProjects(){atomic(projectsFile,JSON.stringify({version:1,projects:projects.slice(0,100)}))}
if(!projects.length){
 const first=makeProject('我的第一块画布');
 for(const [i,h] of history.slice().reverse().entries()){
   h.projectId=first.id;
   first.nodes.push({id:crypto.randomUUID(),kind:'generated',historyId:h.id,x:(i%5)*340,y:Math.floor(i/5)*350,w:288,h:288,createdAt:h.createdAt});
 }
 projects.push(first);saveProjects();if(history.length)atomic(historyFile,JSON.stringify(history));
}
function project(id){return projects.find(p=>p.id===id&&!p.archived)}
function defaultProject(){return projects.find(p=>!p.archived)}
function nodeView(n){return {...n,url:n.kind==='reference'?BASE+'/api/media/'+n.assetFile:null,previewUrl:n.kind==='reference'?BASE+'/api/previews/'+n.assetFile:null}}
function projectView(p){const {removedBatches,...visible}=p;return {...visible,assistantMemory:assistantMemory.normalize(p.assistantMemory),nodes:p.nodes.map(nodeView)}}
function touchProject(p){p.revision=(p.revision||0)+1;p.updatedAt=time();saveProjects()}
let interruptedCreative=false;
for(const p of projects){
 const f=p.creativeWorkflow;
 if(f?.status==='running'||f?.stages&&Object.values(f.stages).includes('running')){
  f.status='failed';f.error='服务重启中断了上次分析，请检查上游账单后决定是否重新运行';
  for(const key of Object.keys(f.stages||{}))if(f.stages[key]==='running')f.stages[key]='failed';
  interruptedCreative=true;
 }
}
for(const p of projects){
 const d=p.assetDerivation;
 if(d?.status==='running'){d.status='failed';d.error='服务重启中断了素材分析，可能已产生费用；请检查记录后决定是否重试';d.phase='';interruptedCreative=true}
}
for(const p of projects){
 for(const pack of p.uiDeliveryPacks||[]){
  if(['splitting','delivering'].includes(pack.status)){pack.status='failed';pack.error='服务重启中断了本地素材打包，可从原始图片重新拆分';interruptedCreative=true}
 }
}
for(const p of projects){const plan=p.aiComponentPlan;if(plan?.status==="analyzing"){plan.status="failed";plan.error="识别任务因服务重启中断，请核对上游费用后决定是否重试";interruptedCreative=true}if(plan?.auto?.enabled){plan.auto.enabled=false;plan.auto.error="服务重启已暂停自动生图；继续之前请重新确认费用";interruptedCreative=true}}
if(interruptedCreative)saveProjects();
const creativeBusy=new Set();
function creativeState(p){
 const f=p.creativeWorkflow||(p.creativeWorkflow=creative.make());
 if(!Array.isArray(f.documents)){
  const old=f.document;
  f.documents=old?[{...old,id:crypto.randomUUID()}]:[];
  f.version=2;
 }
 if(!Array.isArray(f.pages))f.pages=creativePages.mergePages([],f.documents);
 if(!f.activePageId||!f.pages.some(x=>x.id===f.activePageId))f.activePageId=f.pages[0]?.id||null;
 if(typeof f.styleDNA!=='string')f.styleDNA=String(f.analysis?.style||'');
 if(typeof f.styleLocked!=='boolean')f.styleLocked=!!f.styleDNA;
 f.document=f.documents.at(-1)||null;
 return f;
}
function creativeCurrent(f){return f.pages.find(x=>x.id===f.activePageId)||null}
function creativePageDoc(f,page){return f.documents.find(d=>d.id===page?.docId)||null}
function creativePagePicture(f,page){
 const d=creativePageDoc(f,page);
 const idx=page?.layoutImageIndex??page?.imageIndexes?.[0];
 return d?.images?.find(img=>img.index===idx)||null;
}
function creativeView(p){
 const f=creativeState(p);
 const decorate=d=>({...d,images:(d.images||[]).map(img=>({...img,url:BASE+'/api/media/'+img.file}))});
 return {flow:{...f,documents:f.documents.map(decorate),document:f.document?decorate(f.document):null}};
}
function creativeSetup(b,flow,p){
 if(!b||typeof b!=='object')throw Error('工作流参数格式有误');
 const refs=Array.isArray(b.styleNodeIds)?b.styleNodeIds:[];
 if(refs.length>5||new Set(refs).size!==refs.length)throw Error('最多选择 5 张不同的风格参考图');
 for(const id of refs){const node=p.nodes.find(n=>n.id===id);if(!node||node.kind==='note')throw Error('风格参考图必须来自当前项目画布')}
 const changed=JSON.stringify(flow.styleNodeIds||[])!==JSON.stringify(refs);
 flow.styleNodeIds=refs;
 if(changed){
  flow.styleDNA='';flow.styleLocked=false;
  for(const page of flow.pages||[]){page.analysis={};page.quality=null;page.status='draft'}
 }
 if(b.activePageId!==undefined){
  if(!flow.pages?.some(x=>x.id===b.activePageId))throw Error('当前页面已不存在');
  flow.activePageId=b.activePageId;
 }
 const current=creativeCurrent(flow),d=creativePageDoc(flow,current);
 if(b.layoutImageIndex!==undefined&&current){
  const idx=Number(b.layoutImageIndex);
  if(!Number.isInteger(idx)||idx<-1||idx>=d.images.length)throw Error('原型图片编号错误');
  const after=idx<0?null:idx,before=current.layoutImageIndex??current.imageIndexes?.[0]??null;
  current.layoutImageIndex=after;
  current.imageIndexes=idx<0?[]:[idx];
  if(before!==after){current.analysis={};current.quality=null;current.status='draft'}
 }
 flow.layoutImageIndex=current?.layoutImageIndex??current?.imageIndexes?.[0]??0;
 flow.notes=clampText(b.notes,1800);
 if(b.styleLocked!==undefined)flow.styleLocked=!!b.styleLocked;
 const config=b.routing||{};
 for(const cap of ['text','vision','image']){
  const binding=config[cap]||{};
  if(binding.providerId&&!state.providers.some(x=>x.id===binding.providerId))throw Error('所选'+cap+'中转站已不存在');
  if(binding.model!==undefined&&binding.model!=='' )assertModel(binding.model);
 }
 flow.routing={text:{providerId:trim(config.text?.providerId,70),model:trim(config.text?.model,150)},vision:{providerId:trim(config.vision?.providerId,70),model:trim(config.vision?.model,150)},image:{providerId:trim(config.image?.providerId,70),model:trim(config.image?.model,150)}};
 flow.updatedAt=time();
}
function creativePictureFromNode(p,id){
 const n=p.nodes.find(x=>x.id===id);
 if(!n||n.kind==='note')throw Error('参考图不在当前画布');
 const h=n.kind==='reference'?null:history.find(x=>x.id===n.historyId&&x.projectId===p.id);
 const filename=n.kind==='reference'?n.assetFile:h?.file;
 if(!filename)throw Error('找不到参考图原文件');
 return fetchMedia(filename);
}
function creativeCheckModels(f,stage,{pageId,batch=false}={}){
 const config=f.routing||{};
 if(stage==='analyze'||stage==='split'||stage==='director-retry'){
  const c=config.text||{};
  const text=effectiveProvider(provider(c.providerId||state.activeId),'text');
  emptyProvider(text);creativeModel(text,'text',c.model);
 }
 if(stage==='analyze'){
  const selected=batch?f.pages.filter(x=>!x.analysis?.prompt).slice(0,8):
    [f.pages.find(x=>x.id===(pageId||f.activePageId))].filter(Boolean);
  const requiresVision=((f.styleNodeIds||[]).length>0&&!f.styleDNA)||
    selected.some(x=>!!creativePagePicture(f,x));
  if(requiresVision){
   const c=config.vision||{};
   const vision=effectiveProvider(provider(c.providerId||state.activeId),'vision');
   emptyProvider(vision);creativeModel(vision,'vision',c.model);
  }
 }
 if(stage==='quality'){
  const c=config.vision||{};
  const vision=effectiveProvider(provider(c.providerId||state.activeId),'vision');
  emptyProvider(vision);creativeModel(vision,'vision',c.model);
 }
}
async function creativeSplit(p){
 const f=creativeState(p);
 if(!f.documents.length)throw Error('请先上传至少一份 Word');
 if(creativeBusy.has(p.id))throw Error('已有正在执行的 AI 工作流');
 if(DEMO_MODE)throw Error('演示模式不能调用付费 AI');
 const cfg=f.routing?.text||{},text=effectiveProvider(provider(cfg.providerId||state.activeId),'text');
 emptyProvider(text);const model=creativeModel(text,'text',cfg.model);
 creativeBusy.add(p.id);f.status='running';f.error='';f.stages.document='running';touchProject(p);
 try{
  const result=await options.limiter.run(()=>generateText(text,{model,prompt:creativeUpstream.screenPrompt(creativePages.splitPrompt(f.documents)),maxPromptChars:36000,maxOutputTokens:Math.min(4800,Math.max(2000,f.pages.length*180)),timeoutMs:145000}));
  const pages=creativePages.parsePageResponse(result,f.documents,f.pages);
  f.pages=pages;f.activePageId=pages.some(x=>x.id===f.activePageId)?f.activePageId:pages[0].id;
  f.analysis=creativeCurrent(f)?.analysis||{};f.quality=creativeCurrent(f)?.quality||null;
  f.layoutImageIndex=creativeCurrent(f)?.layoutImageIndex??creativeCurrent(f)?.imageIndexes?.[0]??0;
  f.stages.layout=f.analysis.layout?'done':'pending';f.stages.director=f.analysis.prompt?'done':'pending';
  f.stages.quality=f.quality?'done':'pending';
  f.status='split-ready';f.stages.document='done';f.updatedAt=time();touchProject(p);
 }catch(e){f.status='failed';f.stages.document='failed';f.error=String(e.message||e).slice(0,450);touchProject(p);throw e}
 finally{creativeBusy.delete(p.id)}
}
// A long-running text model can finish after the ordinary chat deadline.
const DIRECTOR_TIMEOUT_MS=330000;
// Only prototype image interpretation opts in to a longer deadline.
const LAYOUT_VISION_TIMEOUT_MS=180000;
async function creativeDirectorResult(f,page,layout,text,model){
 const d=creativePageDoc(f,page);
 if(!d)throw Error('此页面的 Word 来源已不存在');
 const context='【页面】'+page.name+'\n【来源文件】'+d.name+'\n【本页需求】'+(page.requirements||d.text.slice(0,5000));
 return options.limiter.run(()=>generateText(text,{
  model,prompt:creativeUpstream.directorPrompt(context,f.styleDNA||'【未提供风格参考图】需等待用户提供游戏实际 UI 截图后确定最终画风。',layout,f.notes),
  maxPromptChars:58000,maxOutputTokens:4600,timeoutMs:DIRECTOR_TIMEOUT_MS
 }));
}
async function creativeAnalyze(p,{pageId,batch=false}={}){
 const f=creativeState(p);
 if(!f.documents.length||!f.pages.length)throw Error('请先上传 Word 文档并确认拆分页面');
 if(creativeBusy.has(p.id))throw Error('已有正在执行的 AI 工作流');
 if(DEMO_MODE)throw Error('演示模式不能调用付费 AI');
 const current=f.pages.find(x=>x.id===(pageId||f.activePageId));
 if(!current)throw Error('待分析页面不存在');
 const selected=batch?f.pages.filter(x=>!x.analysis?.prompt).slice(0,8):[current];
 if(!selected.length)throw Error('所有页面已有创作方案；如需修改请先更新具体页面');
 const rp=f.routing||{},txt=rp.text||{};
 const text=effectiveProvider(provider(txt.providerId||state.activeId),'text');
 emptyProvider(text);const tm=creativeModel(text,'text',txt.model);
 const refs=f.styleNodeIds.map(id=>creativePictureFromNode(p,id));
 const needsVision=(refs.length>0&&!f.styleDNA)||selected.some(page=>!!creativePagePicture(f,page));
 let vision=null,vm='';
 if(needsVision){
  const cfg=rp.vision||{};
  vision=effectiveProvider(provider(cfg.providerId||state.activeId),'vision');
  emptyProvider(vision);vm=creativeModel(vision,'vision',cfg.model);
 }
 creativeBusy.add(p.id);f.error='';f.status='running';f.quality=null;
 for(const k of ['style','layout','director','generation','quality'])f.stages[k]='pending';
 f.analysis={};f.progress={done:0,total:selected.length,pageId:selected[0]?.id,pageName:selected[0]?.name,stage:'style',startedAt:time()};touchProject(p);
 let stage='style',currentPage=null;
 try{
  if(refs.length&&!f.styleDNA){
   f.stages.style='running';touchProject(p);
   const original=await options.limiter.run(()=>analyzeCreativeImages(vision,refs,vm,creativeUpstream.stylePrompt(f.notes)));
   const accepted=creativeUpstream.validateGuide(original);
   f.styleDNA=accepted.yaml;
   f.styleReview=accepted.review;
   f.upstreamRules=creativeUpstream.version;
   f.stages.style='done';f.styleLocked=false;touchProject(p); // ai_asset explicitly requires human review before style approval
  }else f.stages.style=f.styleDNA?'done':'pending';
  for(const page of selected){
   currentPage=page;f.progress.pageId=page.id;f.progress.pageName=page.name;
   const d=creativePageDoc(f,page),prototype=creativePagePicture(f,page);
   const context='【页面】'+page.name+'\n【来源文件】'+d.name+'\n【本页需求】'+(page.requirements||d.text.slice(0,5000));
   stage='layout';f.progress.stage='layout';f.progress.startedAt=time();f.stages.layout=prototype?'running':'pending';page.status='analyzing';touchProject(p);
   const layout=prototype
    ?await options.limiter.run(()=>analyzeCreativeImages(vision,[fetchMedia(prototype.file)],vm,creativeUpstream.layoutPrompt(context,f.notes),{timeoutMs:LAYOUT_VISION_TIMEOUT_MS}))
    :'【无布局原型】此页面没有可靠的原型图。只能依据文档文字给出设计建议；禁止声称已还原原型位置。';
   f.stages.layout=prototype?'done':'pending';page.analysis.layout=layout;touchProject(p);
   stage='director';f.progress.stage='director';f.progress.startedAt=time();f.stages.director='running';touchProject(p);
   const director=await creativeDirectorResult(f,page,layout,text,tm);
   page.analysis={style:f.styleDNA||'',layout,director,prompt:creative.extractPrompt(director)};
   page.status='ready';page.updatedAt=time();f.progress.done++;f.stages.director='done';touchProject(p);
  }
  // A batch produces independent plans, and the selected page is not silently switched.
  f.analysis=creativeCurrent(f)?.analysis||{};
  f.status='ready';f.updatedAt=time();touchProject(p);
  return creativeView(p);
 }catch(e){
  f.stages[stage]='failed';f.status='failed';
  f.error=(stage==='layout'&&e.timeout
   ?'原型识图超时：等待约 3 分钟后仍未收到视觉模型结果。可能已计费，请检查上游记录；如反复发生，请更换视觉分析模型后手动重试。'
   :(stage==='layout'?'原型分析失败：':'')+String(e.message||e)).slice(0,450);
  if(currentPage)currentPage.status='failed';
  touchProject(p);throw e;
 }finally{creativeBusy.delete(p.id)}
}
// Explicit, billable retry: reuse saved STYLE and Layout Blueprint, never rerun vision.
async function creativeRetryDirector(p,{pageId}={}){
 const f=creativeState(p);
 if(creativeBusy.has(p.id))throw Error('已有正在执行的 AI 工作流');
 if(DEMO_MODE)throw Error('演示模式不能调用付费 AI');
 const page=f.pages.find(x=>x.id===(pageId||f.activePageId));
 if(!page)throw Error('待重试页面不存在');
 if(!page.analysis?.layout||page.analysis?.prompt||page.status!=='failed'||f.stages.director!=='failed')
  throw Error('只有美术总监失败且布局结果已保存的页面才能单独重试');
 const config=f.routing?.text||{},text=effectiveProvider(provider(config.providerId||state.activeId),'text');
 emptyProvider(text);const model=creativeModel(text,'text',config.model);
 creativeBusy.add(p.id);f.status='running';f.error='';
 f.stages.director='running';page.status='analyzing';
 f.progress={done:0,total:1,pageId:page.id,pageName:page.name,stage:'director',startedAt:time()};
 touchProject(p);
 try{
  const director=await creativeDirectorResult(f,page,page.analysis.layout,text,model);
  page.analysis={...page.analysis,style:f.styleDNA||'',director,prompt:creative.extractPrompt(director)};
  page.status='ready';page.updatedAt=time();
  f.stages.director='done';f.status='ready';f.progress.done=1;
  f.analysis=creativeCurrent(f)?.analysis||{};f.updatedAt=time();touchProject(p);
  return creativeView(p);
 }catch(e){
  f.stages.director='failed';f.status='failed';page.status='failed';
  f.error=String(e.message||e).slice(0,450);touchProject(p);throw e;
 }finally{creativeBusy.delete(p.id)}
}
async function creativeQuality(p,historyId){
 const f=creativeState(p),page=creativeCurrent(f);
 if(!page?.analysis?.director)throw Error('请先完成所选页面的 AI 创作方案');
 if(creativeBusy.has(p.id))throw Error('已有正在执行的 AI 操作');
 const generated=history.find(h=>h.id===historyId&&h.projectId===p.id);
 if(!generated)throw Error('请选择当前项目的一张生成图进行质检');
 const reference=f.styleNodeIds[0]&&creativePictureFromNode(p,f.styleNodeIds[0]);
 const prototype=creativePagePicture(f,page);
 const photos=[...(reference?[reference]:[]),...(prototype?[fetchMedia(prototype.file)]:[]),fetchMedia(generated.file)];
 if(photos.length<2)throw Error('至少需要一张游戏风格图或原型图才能执行视觉对比');
 const cfg=f.routing?.vision||{};
 const vision=effectiveProvider(provider(cfg.providerId||state.activeId),'vision');
 emptyProvider(vision);const vm=creativeModel(vision,'vision',cfg.model);
 if(DEMO_MODE)throw Error('演示模式不能执行付费质检');
 creativeBusy.add(p.id);f.stages.quality='running';f.error='';touchProject(p);
 try{
  const context=(creativePageDoc(f,page)?.text||'').slice(0,4000);
  const prompt=reference&&prototype
   ?creativeUpstream.qualityPrompt(context,f.styleDNA,page.analysis.layout)
   :'你是独立游戏 UI 视觉质检员，图像按顺序为'+(reference?'游戏风格参考、':'')+(prototype?'策划原型、':'')+'最终生成结果。仅对实际提供的图片负责。对比风格、界面结构和文字，标明无法判断的内容。\n设计要求：'+page.requirements+'\n风格规则：'+f.styleDNA+'\n布局规则：'+page.analysis.layout;
  const report=await options.limiter.run(()=>analyzeCreativeImages(vision,photos,vm,prompt,{timeoutMs:165000}));
  page.quality={historyId,report,checkedAt:time()};
  f.quality=page.quality;f.stages.generation='done';f.stages.quality='done';f.status='review';page.status='review';touchProject(p);
  return creativeView(p);
 }catch(e){f.stages.quality='failed';f.error=String(e.message||e).slice(0,450);touchProject(p);throw e}
 finally{creativeBusy.delete(p.id)}
}
function appendGeneratedNode(h,j){const p=project(j.projectId||defaultProject()?.id);if(!p)return;
 const parent=p.nodes.find(n=>n.historyId===h.parentId)||p.nodes.find(n=>n.id===j.sourceNodeId);
 const {x,y,w,h:height}=nextGeneratedPosition(p);
 p.nodes.push({id:crypto.randomUUID(),kind:'generated',historyId:h.id,parentNodeId:parent?.id||null,x,y,w,h:height,createdAt:time()});
 p.messages.push({id:crypto.randomUUID(),role:'result',content:'已生成作品',createdAt:time(),groupId:j.groupId,imageId:h.id});
 p.messages=p.messages.slice(-400);p.nodes=p.nodes.slice(-1800);touchProject(p);
}
function assertProject(id){const p=project(id);if(!p)throw Object.assign(Error('项目不存在或已归档'),{status:404});return p}
function posNode(b){return {x:num(b.x,0),y:num(b.y,0),w:num(b.w,288,90,1200),h:num(b.h,288,90,1200)}}
const BUNDLE_MAX=32*1024*1024;
function projectBackup(p){
 const selectedHistory=history.filter(h=>h.projectId===p.id);
 const fileIds=new Set(selectedHistory.map(h=>h.file).concat(p.nodes.filter(n=>n.kind==='reference').map(n=>n.assetFile)));
 let total=0;const media=[];
 for(const id of fileIds){const img=fetchMedia(id);total+=img.bytes.length;if(total>BUNDLE_MAX)throw Object.assign(Error('此项目媒体超过32MB，请分批备份后再导入'),{status:413});media.push({file:id,mime:img.mime,data:img.bytes.toString('base64')});}
 const safeProject={title:p.title,viewport:p.viewport,nodes:p.nodes,messages:p.messages,creativeWorkflow:p.creativeWorkflow||null,generationLayout:p.generationLayout||null,assistantMemory:assistantMemory.normalize(p.assistantMemory),aiComponentPlan:componentView(p).plan};
 return zlib.gzipSync(Buffer.from(JSON.stringify({kind:'hamoki-project',schema:1,exportedAt:time(),project:safeProject,history:selectedHistory,media})),{level:6});
}
function importProject(b){
 if(typeof b.archive!=='string'||b.archive.length>50*1024*1024||!b.archive.length)throw Error('请选择不超过约35MB的 Hamoki 备份文件');
 let data;
 try{const zipped=Buffer.from(b.archive,'base64');if(zipped.length>BUNDLE_MAX+7*1024*1024)throw Error('文件过大');data=JSON.parse(zlib.gunzipSync(zipped,{maxOutputLength:65*1024*1024}).toString('utf8'));}
 catch(e){throw Error('无法读取项目备份，格式可能不正确或文件损坏：'+String(e.message).slice(0,110))}
 if(data?.kind!=='hamoki-project'||data.schema!==1||!data.project||!Array.isArray(data.media)||!Array.isArray(data.history)||!Array.isArray(data.project.nodes))throw Error('不是支持的 Hamoki 项目备份');
 if(data.media.length>1500||data.history.length>1500||data.project.nodes.length>1800||!Array.isArray(data.project.messages)||data.project.messages.length>400)throw Error('项目内容超出导入上限');
 if(projects.filter(x=>!x.archived).length>=80)throw Error('项目数量已达到上限');
 if(history.length+data.history.length>2500)throw Error('历史记录数量达到上限，暂时无法导入');
 const buffers=new Map();let total=0;
 for(const item of data.media){if(!item||typeof item.file!=='string'||! /^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(item.file)||typeof item.data!=='string'||item.data.length>45*1024*1024||buffers.has(item.file))throw Error('无效或重复的媒体文件');const bytes=Buffer.from(item.data,'base64');total+=bytes.length;if(total>BUNDLE_MAX)throw Error('备份图片总大小超过32MB');const mime=guessMime(bytes);if(!['image/png','image/jpeg','image/webp'].includes(mime))throw Error('图片文件类型不支持');buffers.set(item.file,{mime,bytes});}
 const oldHistId=new Map(),oldNodeId=new Map(),oldGroupId=new Map();const uuidLike=/^[a-f0-9-]{36}$/;
 for(const h of data.history){if(!h||!uuidLike.test(h.id)||typeof h.file!=='string'||!buffers.has(h.file)||oldHistId.has(h.id))throw Error('历史图片关联不完整');oldHistId.set(h.id,crypto.randomUUID());}
 for(const n of data.project.nodes){if(!n||!uuidLike.test(n.id)||!['generated','reference','note'].includes(n.kind)||oldNodeId.has(n.id))throw Error('画布元素格式不正确');if(n.kind==='generated'&&!oldHistId.has(n.historyId))throw Error('缺少生成图片历史');if(n.kind==='reference'&&!buffers.has(n.assetFile))throw Error('缺少画布参考图片');oldNodeId.set(n.id,crypto.randomUUID());}
 const proj=makeProject(trim(data.project.title,70)||'导入的创作项目');
 proj.assistantMemory=assistantMemory.normalize(data.project.assistantMemory);
 if(data.project.generationLayout&&Number.isSafeInteger(data.project.generationLayout.x)&&Number.isSafeInteger(data.project.generationLayout.y)&&Number.isSafeInteger(data.project.generationLayout.nextSlot)&&data.project.generationLayout.nextSlot>=0)proj.generationLayout=data.project.generationLayout;
 if(data.project.viewport){const v=data.project.viewport;proj.viewport={x:num(v.x,220,-500000,500000),y:num(v.y,130,-500000,500000),scale:num(v.scale,1,.18,2.8)}}
 // After all structure checks pass, persist media and remap every entity identifier.
 const mediaIds=new Map();for(const [old,img] of buffers)mediaIds.set(old,storeMedia(img));
 const importedHistory=data.history.map(h=>({id:oldHistId.get(h.id),file:mediaIds.get(h.file),projectId:proj.id,prompt:clampText(h.prompt,10000),editInstruction:clampText(h.editInstruction,4000),model:trim(h.model,150),providerName:trim(h.providerName,100),ratio:trim(h.ratio,20),resolution:trim(h.resolution,10),quality:trim(h.quality,10),transparentBg:!!h.transparentBg,componentTransparent:h.componentTransparent===true?true:h.componentTransparent===false?false:null,createdAt:typeof h.createdAt==='string'?h.createdAt:time(),parentId:oldHistId.get(h.parentId)||null,favorite:!!h.favorite,imported:true}));
 proj.nodes=data.project.nodes.map(n=>{
  const next={id:oldNodeId.get(n.id),kind:n.kind,...posNode(n),createdAt:typeof n.createdAt==='string'?n.createdAt:time(),parentNodeId:oldNodeId.get(n.parentNodeId)||null};
  if(n.groupId){if(!oldGroupId.has(n.groupId))oldGroupId.set(n.groupId,crypto.randomUUID());next.groupId=oldGroupId.get(n.groupId)}
  if(n.kind==='note')next.text=clampText(n.text,1600);
  if(n.kind==='reference'){next.assetFile=mediaIds.get(n.assetFile);next.title=clampText(n.title,100)}
  if(n.kind==='generated')next.historyId=oldHistId.get(n.historyId);
  return next;
 });
 proj.messages=data.project.messages.map(m=>({id:crypto.randomUUID(),role:['user','result','assistant'].includes(m.role)?m.role:'user',content:clampText(m.content,4000),createdAt:typeof m.createdAt==='string'?m.createdAt:time(),imageId:oldHistId.get(m.imageId)||null,sourceId:oldHistId.get(m.sourceId)||null,referenceRoles:Array.isArray(m.referenceRoles)?m.referenceRoles.slice(0,8).filter(x=>oldNodeId.has(x.nodeId)).map(x=>({nodeId:oldNodeId.get(x.nodeId),role:REFERENCE_ROLES[x.role]?x.role:'general'})):[]}));
 // Restore one-image component review map, remapping all identifiers.
 const archivedComponents=data.project.aiComponentPlan;
 if(archivedComponents&&oldHistId.has(archivedComponents.sourceId)&&Array.isArray(archivedComponents.items)){
  const items=archivedComponents.items.slice(0,24).filter(x=>x&&typeof x.name==="string"&&x.name.length<=65&&aiComponent.CATEGORIES.has(x.category)&&Array.isArray(x.box)&&x.box.length===4&&x.box.every(v=>Number.isInteger(v)&&v>=0&&v<=1000)&&x.box[2]>x.box[0]&&x.box[3]>x.box[1]&&typeof x.description==="string"&&x.description.length<=900);
  if(items.length){proj.aiComponentPlan={id:crypto.randomUUID(),sourceId:oldHistId.get(archivedComponents.sourceId),status:"ready",createdAt:time(),error:"",items:items.map((x,i)=>{
   const resultId=oldHistId.get(x.resultId)||null;
   return {id:crypto.randomUUID(),index:i+1,name:x.name,category:x.category,box:x.box,description:x.description,status:resultId?"done":"ready",jobId:null,importedResultId:resultId};
  })}};
 }
 // Import multi-document creative plans and remap every image/node ID safely.
 // Provider credentials, configured endpoints and model routes stay account-local.
 const oldFlow=data.project.creativeWorkflow;
 if(oldFlow?.document||Array.isArray(oldFlow?.documents)){
  const f=creative.make();
  const incoming=Array.isArray(oldFlow.documents)?oldFlow.documents:[oldFlow.document];
  const docIds=new Map(),pageIds=new Map();
  f.documents=incoming.slice(0,creativePages.MAX_DOCUMENTS).filter(Boolean).map(d=>{
   const id=crypto.randomUUID();if(d.id)docIds.set(d.id,id);
   const images=(Array.isArray(d.images)?d.images:[]).slice(0,20)
    .filter(x=>oldNodeId.has(x.nodeId)&&mediaIds.has(x.file))
    .map(x=>({index:num(x.index,0,0,19),file:mediaIds.get(x.file),nodeId:oldNodeId.get(x.nodeId),
      mime:trim(x.mime,40),size:num(x.size,0,0,8*1024*1024)}));
   return {id,name:clampText(d.name,140),text:clampText(d.text,55000),hash:clampText(d.hash,64),importedAt:time(),
    warnings:Array.isArray(d.warnings)?d.warnings.slice(0,8).map(x=>clampText(x,160)):[],
    blocks:Array.isArray(d.blocks)?d.blocks.slice(0,1200).filter(x=>x&&['text','image'].includes(x.kind))
     .map(x=>x.kind==='text'?{kind:'text',text:clampText(x.text,1800),...(Number.isInteger(x.level)?{level:x.level}:{})}:{kind:'image',index:num(x.index,0,0,19)}):[],
    images};
  });
  f.document=f.documents.at(-1)||null;
  f.pages=Array.isArray(oldFlow.pages)?oldFlow.pages.slice(0,creativePages.MAX_PAGES).filter(x=>docIds.has(x.docId))
   .map(x=>{
    const id=crypto.randomUUID();pageIds.set(x.id,id);
    const doc=f.documents.find(d=>d.id===docIds.get(x.docId));
    const indexes=(Array.isArray(x.imageIndexes)?x.imageIndexes:[]).filter(i=>Number.isInteger(i)&&doc?.images.some(img=>img.index===i)).slice(0,8);
    return {id,docId:docIds.get(x.docId),name:clampText(x.name,80),sourceName:doc?.name||'',
      requirements:clampText(x.requirements,4400),imageIndexes:indexes,
      layoutImageIndex:doc?.images.some(img=>img.index===x.layoutImageIndex)?x.layoutImageIndex:(indexes[0]??null),
      status:['draft','ready','review','needs-prototype','needs-review'].includes(x.status)?x.status:'draft',
      analysis:Object.fromEntries(['style','layout','director','prompt'].map(k=>[k,clampText(x.analysis?.[k],k==='prompt'?11500:16000)])),
      issues:Array.isArray(x.issues)?x.issues.slice(0,6).map(s=>clampText(s,150)):[],
      quality:x.quality?.report?{historyId:oldHistId.get(x.quality.historyId)||null,report:clampText(x.quality.report,16000),checkedAt:time()}:null};
   }):creativePages.mergePages([],f.documents);
  f.activePageId=pageIds.get(oldFlow.activePageId)||f.pages[0]?.id||null;
  f.styleNodeIds=(Array.isArray(oldFlow.styleNodeIds)?oldFlow.styleNodeIds:[]).slice(0,5).filter(x=>oldNodeId.has(x)).map(x=>oldNodeId.get(x));
  f.styleDNA=clampText(oldFlow.styleDNA||oldFlow.analysis?.style,16000);
  f.styleLocked=!!oldFlow.styleLocked&&!!f.styleDNA;
  f.notes=clampText(oldFlow.notes,1800);
  f.analysis=f.pages.find(x=>x.id===f.activePageId)?.analysis||{};
  f.quality=f.pages.find(x=>x.id===f.activePageId)?.quality||null;
  f.stages.document=f.documents.length?'done':'pending';
  if(f.styleDNA)f.stages.style='done';
  if(f.analysis.layout)f.stages.layout='done';
  if(f.analysis.prompt)f.stages.director='done';
  f.status=f.analysis.prompt?'ready':f.documents.length?'document-ready':'empty';
  proj.creativeWorkflow=f;
 }
 projects.unshift(proj);history.unshift(...importedHistory);saveProjects();saveHistory();return projectView(proj);
}


function saveJobs(){atomic(jobsFile,JSON.stringify({jobs:jobs.slice(0,1000),paused}))}
function saveHistory(){atomic(historyFile,JSON.stringify(history.slice(0,2500)))}
saveJobs();if(!paused&&jobs.some(j=>j.status==='queued'))schedule();
const respond=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj))};
const fail=(res,code,msg)=>respond(res,code,{error:msg});
function readJSON(req){return new Promise((resolve,reject)=>{const parts=[];let total=0,tooBig=false;req.on('data',b=>{total+=b.length;if(total>BODY_LIMIT){tooBig=true;return}parts.push(b)});req.on('end',()=>{if(tooBig)return reject(Object.assign(Error('请求超过 55MB 限制'),{status:413}));try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')||'{}'))}catch{reject(Object.assign(Error('JSON 请求格式不正确'),{status:400}))}});req.on('error',reject)})}
function cookie(req){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('hs_session='))?.slice(11)||''}
function auth(req){return process.env.ANON_WORKSPACE==='1'||(function(){const token=cookie(req),expire=sessions.get(token);return !!(token&&expire&&expire>Date.now())})()}
function provider(id){return state.providers.find(p=>p.id===id)}
function safe(p){return {id:p.id,name:p.name,url:p.url,mode:p.mode,imageMode:p.imageMode||'images',imageModel:p.imageModel,visionModel:p.visionModel,responseModel:p.responseModel||'',hasKey:!!p.apiKey,checks:p.checks||{},verifiedCapabilities:p.verifiedCapabilities||{},capabilities:safeCapabilities(p)}}
function capabilities(p){const images=p.mode==='openai'&&p.imageMode==='images';return {protocol:p.imageMode||'images',support:{textToImage:'available-by-protocol',referenceImage:'available-by-protocol',mask:images?'model-dependent':'unsupported',transparentBackground:images?'model-dependent':'unsupported',imageReverse:'depends-on-vision-model',aspectRatio:'model-dependent',resolution:'model-dependent'},verified:p.verifiedCapabilities||{},checks:p.checks||{},note:'协议能力仅是推测；实际支持情况以显式付费测试及成功生图任务为准。'}}
function recordCapability(p,feature,success,model,detail={}){if(DEMO_MODE)return;p.verifiedCapabilities ||= {};p.verifiedCapabilities[feature]={success:!!success,model,checkedAt:time(),...detail};encrypt(state)}
function assertModel(v){
 // Model IDs are opaque strings provided by upstream services. Accept aliases with
 // spaces/Unicode/parentheses; reject controls and multiline content, never coerce objects.
 if(typeof v!=='string'||!v.trim())throw Error('请先填写模型 ID');
 const t=v.trim();
 if(t.length>150||/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(t))throw Error('模型 ID 格式不正确：请填写不超过 150 字符的单行名称');
 return t;
}
function creativeModel(p,cap,selected){
 const label=cap==='text'?'文字分析':'视觉分析';
 const value=(typeof selected==='string'?selected.trim():'')||normalizedCapability(p,cap).defaultModel;
 if(!value)throw Error('尚未配置'+label+'模型 ID。请在 AI 美术工作流的「'+label+'」输入框填写实际模型 ID，或在中转站管理设置对应能力的默认模型');
 if((cap==='vision'||cap==='text')&&/^(?:gpt-image(?:-|$)|dall-e(?:-|$)|nano-banana(?:-|$)|imagen(?:-|$))/i.test(value))
  throw Error(label+'已误选图片生成模型「'+value+'」，它不能代替文字/看图分析模型。请在工作流选择支持'+(cap==='vision'?'图像理解':'文字输出')+'的模型；正式生图模型请放在「正式生图」栏');
 try{return assertModel(value)}catch(e){throw Error(label+'模型 ID 不正确：'+e.message)}
}
function mediaPath(id){if(!/^[a-f0-9-]{36}\.(?:png|jpg|webp)$/.test(id))throw Error('媒体文件名不合法');return path.join(MEDIA_DIR,id)}
function previewPath(id,format='webp'){mediaPath(id);return path.join(PREVIEW_DIR,id+'.'+format)}
function folderUsage(folder){let bytes=0,files=0;for(const entry of fs.readdirSync(folder,{withFileTypes:true})){if(!entry.isFile())continue;const stat=fs.statSync(path.join(folder,entry.name));bytes+=stat.size;files++}return {bytes,files}}
let usageCache=null,usageChecked=0;
function storageUsage(force=false){if(!force&&usageCache&&Date.now()-usageChecked<30000)return usageCache;const original=folderUsage(MEDIA_DIR),previews=folderUsage(PREVIEW_DIR);usageCache={originalBytes:original.bytes,previewBytes:previews.bytes,totalBytes:original.bytes+previews.bytes,originalCount:original.files,previewCount:previews.files,quotaBytes:MEDIA_QUOTA_BYTES};usageChecked=Date.now();return usageCache}
function removePreviewFiles(name){for(const ext of ['webp','jpg']){const file=previewPath(name,ext);if(fs.existsSync(file))try{fs.unlinkSync(file)}catch{}}}
function cleanupMessages(project,removedHistoryId=null,removedNodeIds=new Set()){project.messages=project.messages.filter(m=>m.imageId!==removedHistoryId&&m.sourceId!==removedHistoryId&&!(Array.isArray(m.referenceRoles)&&m.referenceRoles.some(r=>removedNodeIds.has(r.nodeId))))}
function overSpace(incomingSize){return storageUsage(true).totalBytes+incomingSize>MEDIA_QUOTA_BYTES||(typeof options.globalBytesLeft==='function'&&options.globalBytesLeft()<incomingSize)}
function releaseForQuota(incomingSize){
 const protectedFiles=new Set();
 // Keep document prototypes and approved style inputs available across sessions.
 for(const current of projects){
  const f=current.creativeWorkflow;
  for(const doc of f?.documents||(f?.document?[f.document]:[]))for(const img of doc.images||[])if(img.file)protectedFiles.add(img.file);
  for(const nodeId of f?.styleNodeIds||[]){const node=current.nodes.find(n=>n.id===nodeId);if(node?.kind==='reference')protectedFiles.add(node.assetFile);if(node?.kind==='generated'){const h=history.find(x=>x.id===node.historyId&&x.projectId===current.id);if(h?.file)protectedFiles.add(h.file)}}
 }
 for(const job of jobs)if(['queued','running'].includes(job.status)){
   if(job.sourceId){const h=history.find(x=>x.id===job.sourceId);if(h)protectedFiles.add(h.file)}
   for(const f of job.referenceMedia||[])protectedFiles.add(f);
   if(job.maskMedia)protectedFiles.add(job.maskMedia);
   if(job.maskSourceMedia)protectedFiles.add(job.maskSourceMedia);
 }
 let changedHistory=false,changedProjects=false,removedHistoryCount=0,removedReferenceCount=0;
 const previewCandidates=[];
 for(const entry of fs.readdirSync(PREVIEW_DIR,{withFileTypes:true}))if(entry.isFile()){
   const full=path.join(PREVIEW_DIR,entry.name);const stat=fs.statSync(full);previewCandidates.push({full,mtime:stat.mtimeMs,size:stat.size})
 }
 previewCandidates.sort((a,b)=>a.mtime-b.mtime);
 while(overSpace(incomingSize)&&previewCandidates.length){const item=previewCandidates.shift();try{fs.unlinkSync(item.full);usageCache=null}catch{}}
 const candidates=[];const seen=new Set();
 for(const h of history){
   if(!h?.file||protectedFiles.has(h.file)||seen.has('h:'+h.id))continue;seen.add('h:'+h.id);
   let size=0;try{size=fs.statSync(mediaPath(h.file)).size}catch{}
   candidates.push({kind:'history',sort:Date.parse(h.createdAt)||0,size,historyId:h.id,file:h.file});
 }
 for(const proj of projects)for(const node of proj.nodes||[])if(node.kind==='reference'&&node.assetFile&&!protectedFiles.has(node.assetFile)){
   const key='r:'+node.id;if(seen.has(key))continue;seen.add(key);let size=0;try{size=fs.statSync(mediaPath(node.assetFile)).size}catch{}
   candidates.push({kind:'reference',sort:Date.parse(node.createdAt)||0,size,file:node.assetFile,nodeId:node.id,projectId:proj.id});
 }
 candidates.sort((a,b)=>a.sort-b.sort||a.size-b.size);
 while(overSpace(incomingSize)&&candidates.length){
   const item=candidates.shift();
   if(item.kind==='history'){
     history=history.filter(h=>h.id!==item.historyId);changedHistory=true;removedHistoryCount++;
     for(const proj of projects){const before=proj.nodes.length;proj.nodes=proj.nodes.filter(n=>!(n.kind==='generated'&&n.historyId===item.historyId));if(proj.nodes.length!==before)changedProjects=true;const removedNodeIds=new Set();cleanupMessages(proj,item.historyId,removedNodeIds)}
   }else if(item.kind==='reference'){
     for(const proj of projects)if(proj.id===item.projectId){const removedNodeIds=new Set([item.nodeId]);const before=proj.nodes.length;proj.nodes=proj.nodes.filter(n=>n.id!==item.nodeId);if(proj.nodes.length!==before){changedProjects=true;removedReferenceCount++}cleanupMessages(proj,null,removedNodeIds)}
   }
   try{if(fs.existsSync(mediaPath(item.file)))fs.unlinkSync(mediaPath(item.file))}catch{}
   removePreviewFiles(item.file);usageCache=null;
 }
 if(changedHistory)saveHistory();
 if(changedProjects)saveProjects();
 if(changedHistory||changedProjects)diag({source:'storage',level:'warning',action:'auto_cleanup',message:`空间不足，自动清理 ${removedHistoryCount} 张旧生成图、${removedReferenceCount} 张旧参考图（不影响其他账号）`});
 if(overSpace(incomingSize))throw Object.assign(Error('当前账号或全站图片空间已满，当前账号已无可清理的旧图。请下载重要作品后手动整理。'),{status:413});
}
function checkSpace(size){if(overSpace(size))releaseForQuota(size)}
function storeMedia(img){checkSpace(img.bytes.length);const name=crypto.randomUUID()+'.'+extension(img.mime);fs.writeFileSync(mediaPath(name),img.bytes,{flag:'wx',mode:0o600});usageCache=null;return name}
function storePreview(name,pic){mediaPath(name);if(!fs.existsSync(mediaPath(name)))throw Object.assign(Error('原图不存在'),{status:404});if(!['image/webp','image/jpeg'].includes(pic.mime)||pic.bytes.length>512*1024)throw Object.assign(Error('缩略图必须为不超过512KB的 WebP 或 JPEG'),{status:413});const format=pic.mime==='image/webp'?'webp':'jpg';if(fs.existsSync(previewPath(name,'webp'))||fs.existsSync(previewPath(name,'jpg')))return false;checkSpace(pic.bytes.length);try{fs.writeFileSync(previewPath(name,format),pic.bytes,{flag:'wx',mode:0o600});usageCache=null;return true}catch(e){if(e.code==='EEXIST')return false;throw e}}
function fetchMedia(name){const bytes=fs.readFileSync(mediaPath(name));return {mime:guessMime(bytes),bytes}}
function sendMedia(req,res,filename,mime,cache='private, max-age=604800'){const stat=fs.statSync(filename);const tag='"'+stat.size.toString(16)+'-'+Math.round(stat.mtimeMs).toString(16)+'"';if(req.headers['if-none-match']===tag){res.writeHead(304,{'ETag':tag,'Cache-Control':cache});return res.end()}res.writeHead(200,{'Content-Type':mime,'Content-Length':stat.size,'Cache-Control':cache,'ETag':tag,'X-Content-Type-Options':'nosniff'});const stream=fs.createReadStream(filename);stream.on('error',e=>{console.error('[Hamoki media stream]',e.code||'stream');res.destroy(e)});return stream.pipe(res)}
function publicHistory(h){return {...h,url:BASE+'/api/media/'+h.file,previewUrl:BASE+'/api/previews/'+h.file};}
function publicJob(j){const {referenceMedia,maskMedia,maskSourceMedia,roleHints,review,...exposed}=j;return {...exposed,referenceRoles:roleHints||[]};}
function pngDimensions(bytes){if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.length<24)throw Error('蒙版及蒙版原图必须为 PNG');return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)]}
function saveSourceFiles(refs,mask,maskSource){
 let size=0;const input=[];
 for(const data of refs){const img=imageFromDataURL(data);size+=img.bytes.length;if(size>40*1024*1024)throw Error('参考图总大小需小于 40MB');input.push(storeMedia(img))}
 let maskFile=null,maskSourceFile=null;
 if(mask){const img=imageFromDataURL(mask);if(img.mime!=='image/png'||img.bytes.length>4*1024*1024)throw Error('蒙版需要是小于4MB的透明 PNG');
   if(maskSource){const source=imageFromDataURL(maskSource);if(source.mime!=='image/png')throw Error('蒙版源图必须是 PNG');if(JSON.stringify(pngDimensions(source.bytes))!==JSON.stringify(pngDimensions(img.bytes)))throw Error('蒙版和源图必须完全相同尺寸');maskSourceFile=storeMedia(source)}
   maskFile=storeMedia(img)
 }
 return {input,mask:maskFile,maskSource:maskSourceFile};
}
function emptyProvider(p){if(DEMO_MODE&&p)return; if(!p||!p.url||!p.apiKey)throw Error('请先配置中转站地址和 API Key')}
function jobStatusOk(j,status){
 if(status==="done"||status==="failed"){const p=project(j.projectId);if(p?.aiComponentPlan?.id===j.groupId&&p.aiComponentPlan.auto?.enabled)setImmediate(()=>componentAutoContinue(p))}if(j.status==='cancelled')return false;j.status=status;j.updatedAt=time();saveJobs();if(status==='failed'){const p=project(j.projectId||defaultProject()?.id);if(p){p.messages.push({id:crypto.randomUUID(),role:'error',content:'生成失败（'+j.model+'）：'+(j.error||'未知错误'),createdAt:time(),groupId:j.groupId});p.messages=p.messages.slice(-400);touchProject(p)}}return true}
function schedule(){setImmediate(pump)}
function pump(){
 if(paused)return;
 clearTimeout(retryTimer);retryTimer=null;
 while(running<CONCURRENCY){
  const now=Date.now(),next=jobs.find(j=>j.status==='queued'&&!providerBusy.has(j.providerId)&&(!j.nextRunAt||j.nextRunAt<=now));
  if(!next)break;
  next.status='running';next.nextRunAt=null;next.startedAt=time();next.attempts=(next.attempts||0)+1;next.updatedAt=time();providerBusy.add(next.providerId);running++;saveJobs();
  execute(next).finally(()=>{providerBusy.delete(next.providerId);running--;schedule()});
 }
 const future=jobs.filter(j=>j.status==='queued'&&j.nextRunAt>Date.now());
 if(future.length&&!retryTimer){const delay=Math.min(60000,Math.max(100,Math.min(...future.map(j=>j.nextRunAt))-Date.now()));retryTimer=setTimeout(schedule,delay);retryTimer.unref?.()}
}
async function reviewGenerated(job,entry){
 const config=job.review,projectState=project(job.projectId);
 if(!config||!projectState||entry.projectId!==projectState.id||entry.review?.status)return;
 entry.review={status:'checking',summary:'正在核对生成图片与已确认规范',issues:[],correction:''};
 job.reviewStatus='checking';saveHistory();saveJobs();
 try{
  const pictures=[],roles=job.roleHints||[];
  const styleFile=(job.referenceMedia||[]).find((f,i)=>roles[i]==='style');
  if(styleFile){pictures.push(fetchMedia(styleFile))}
  const f=projectState.creativeWorkflow||{},page=(f.pages||[]).find(x=>x.id===config.pageId);
  const prototype=page&&creativePagePicture(f,page);
  if(prototype?.file&&prototype.file!==styleFile)pictures.push(fetchMedia(prototype.file));
  const source=job.sourceId&&history.find(x=>x.id===job.sourceId&&x.projectId===projectState.id);
  if(source&&source.file!==styleFile)pictures.push(fetchMedia(source.file));
  pictures.push(fetchMedia(entry.file));
  const vision=effectiveProvider(provider(config.providerId),'vision');emptyProvider(vision);
  const instructions=assistantReview.prompt({
   rules:config.rules,requirements:config.requirements,
   hasStyle:!!styleFile,hasPrototype:!!prototype?.file,hasSource:!!source&&source.file!==styleFile
  });
  const raw=await options.limiter.run(()=>analyzeCreativeImages(vision,pictures,config.model,instructions,{timeoutMs:165000}));
  entry.review={...assistantReview.parse(raw),checkedAt:time()};
  job.reviewStatus=entry.review.status;
 }catch(e){
  entry.review={status:'uncertain',summary:'自动审图未完成：'+String(e.message||e).slice(0,160),issues:[],correction:'',checkedAt:time()};
  job.reviewStatus='uncertain';
  diag({source:'review',level:'warning',action:'quality_check',message:entry.review.summary});
 }finally{
  saveHistory();saveJobs();touchProject(projectState);
 }
}
async function execute(job){const abort=new AbortController();controllers.set(job.id,abort);const t0=Date.now();try{
  const p=effectiveProvider(provider(job.providerId),job.capability||'image');emptyProvider(p);
  const media=[];if(job.sourceId){const original=history.find(x=>x.id===job.sourceId);if(!original)throw Error('源图片已不存在');media.push(fetchMedia(original.file))}
  for(const f of job.referenceMedia||[])media.push(fetchMedia(f));
  const mask=job.maskMedia?fetchMedia(job.maskMedia):null;if(mask&&job.maskSourceMedia){const override=fetchMedia(job.maskSourceMedia);if(override.mime!=='image/png'||JSON.stringify(pngDimensions(override.bytes))!==JSON.stringify(pngDimensions(mask.bytes)))throw Error('局部重绘：PNG 源图与蒙版尺寸不一致');if(!media.length)throw Error('局部重绘缺少源图');media[0]=override}
  if(mask&&!(p.mode==='openai'&&(p.imageMode||'images')==='images'))throw Error('当前接口不支持蒙版局部重绘，请使用 OpenAI 图片接口');
  let output=DEMO_MODE ? {mime:'image/webp',bytes:fs.readFileSync(path.join(ROOT,'assets/hamoki-avatar-128.webp'))} : await generate(p,job,media,mask,abort.signal,progress=>{job.upstreamId=progress.id||job.upstreamId;job.progress=Math.max(0,Math.min(100,Number(progress.progress)||0));job.updatedAt=time();saveJobs()});
  if(job.componentItemId){
   const result=require('node:child_process').spawnSync('python3',[path.join(ROOT,'lib/component-png.py')],{input:output.bytes,encoding:null,timeout:35000,maxBuffer:40*1024*1024});
   if(result.error||result.status!==0)throw Error('组件 PNG 标准化失败：'+String(result.stderr||result.error?.message||'转换异常').slice(0,220));
   job.componentTransparent=/TRANSPARENT=1/.test(String(result.stderr));
   output={mime:'image/png',bytes:result.stdout};
  }
  recordCapability(p,mask?'mask':job.transparentBg?'transparentBackground':media.length?'referenceImage':'textToImage',true,job.model,{ratio:job.ratio,resolution:job.resolution,durationMs:Date.now()-t0});
  if(job.status==='cancelled')return;
  const file=storeMedia(output),id=crypto.randomUUID();const entry={id,file,createdAt:time(),projectId:job.projectId||defaultProject()?.id,providerId:job.providerId,providerName:job.providerName,model:job.model,prompt:job.prompt,ratio:job.ratio,resolution:job.resolution,parentId:job.sourceId||null,groupId:job.groupId||null,referenceMedia:job.referenceMedia||[],masked:!!mask,transparentBg:!!job.transparentBg,editInstruction:job.editInstruction||'',roleHints:job.roleHints||[],jobId:job.id,componentTransparent:job.componentItemId?!!job.componentTransparent:null,componentItemId:job.componentItemId||null,favorite:false,durationMs:Date.now()-t0};
  history.unshift(entry);saveHistory();appendGeneratedNode(entry,job);job.resultId=id;jobStatusOk(job,'done');
  if(job.review&&!DEMO_MODE)setImmediate(()=>{void reviewGenerated(job,entry)});
}catch(e){if(job.status==='cancelled')return;job.error=String(e?.message||'请求失败').slice(0,380);job.durationMs=Date.now()-t0;
  diag({source:'queue',level:e.upstreamStatus===429?'warning':'error',action:'image_generation',path:'/api/jobs',method:'POST',model:job.model,status:e.upstreamStatus||undefined,message:job.error});
  if(e.upstreamStatus===429&&job.attempts<3){
    const delay=Math.min(30000,e.retryAfterMs||Math.round(1600*2**(job.attempts-1)+Math.random()*600));
    job.status='queued';job.nextRunAt=Date.now()+delay;job.error+='（上游429限流，'+Math.ceil(delay/1000)+' 秒后重试，最多3次）';job.updatedAt=time();saveJobs();schedule();
  }else jobStatusOk(job,'failed');
}finally{controllers.delete(job.id)}}
function makeJob(b,store,providerId,model,groupId){const p=effectiveProvider(provider(providerId),b.capability||'image');emptyProvider(p);return {id:crypto.randomUUID(),groupId,providerId,capability:b.capability||'image',providerName:p.name,model:assertModel(model||p.imageModel),prompt:b.prompt,editInstruction:b.editInstruction||'',roleHints:store.roleHints||[],transparentBg:!!b.transparentBg,ratio:b.ratio,resolution:b.resolution,quality:b.quality,sourceId:b.sourceId||null,referenceMedia:store.input,maskMedia:store.mask,maskSourceMedia:store.maskSource,projectId:b.projectId,sourceNodeId:b.sourceNodeId||null,canvasX:b.canvasX,canvasY:b.canvasY,batchIndex:b.batchIndex||0,review:b.review||null,reviewStatus:b.review?'pending':null,createdAt:time(),updatedAt:time(),status:'queued',attempts:0,resultId:null,error:'',retryOf:b.retryOf||null}}
const REFERENCE_ROLES={shape:'角色造型、身份及结构',color:'颜色与配色，不复制其主体',style:'绘画风格、线条和上色技巧，不复制内容',pose:'动作与构图',background:'背景与场景',general:'综合参考'};
function validateCreation(b){
 const instruction=trim(b.prompt,16000),refs=Array.isArray(b.references)?b.references:[];
 if(!instruction)throw Error('请输入创作描述');
 const targetProject=assertProject(b.projectId||defaultProject()?.id);
 const sourceNodeId=typeof b.sourceNodeId==='string'&&targetProject.nodes.some(x=>x.id===b.sourceNodeId)?b.sourceNodeId:null;
 if(refs.length>8)throw Error('最多 8 张本地上传参考图');
 const referenceNodes=Array.isArray(b.referenceNodes)?b.referenceNodes:[];
 if(referenceNodes.length>8||refs.length+referenceNodes.length>8)throw Error('最多使用 8 张参考图');
 const images=referenceNodes.map(item=>{
   const node=targetProject.nodes.find(n=>n.id===item.nodeId&&n.kind!=='note');if(!node)throw Error('选中的参考图不在当前项目');
   const role=REFERENCE_ROLES[item.role]?item.role:'general';let file,historyId=null;
   if(node.kind==='reference')file=node.assetFile;
   else {const h=history.find(h=>h.id===node.historyId&&h.projectId===targetProject.id);if(!h)throw Error('画布图片没有对应的历史记录');file=h.file;historyId=h.id}
   return {file,role,nodeId:node.id,historyId};
 });
 // Approved images are real style anchors, not only text preferences.
 if(b.useProjectStyle!==false&&!images.some(x=>x.role==='style')&&refs.length+images.length<8){
  const approved=assistantMemory.normalize(targetProject.assistantMemory).approved.slice().reverse();
  for(const a of approved){
   const node=targetProject.nodes.find(n=>n.id===a.nodeId&&n.kind==='generated'&&n.historyId===a.historyId);
   const h=node&&history.find(x=>x.id===a.historyId&&x.projectId===targetProject.id);
   if(h&&a.historyId!==b.sourceId&&!images.some(x=>x.nodeId===node.id)){
    images.push({file:h.file,role:'style',nodeId:node.id,historyId:h.id});
    break;
   }
  }
 }
 const count=Number(b.count||1);
 if(!Number.isInteger(count)||count<1||count>8)throw Error('单次最多 8 张，建议先试 1 张');
 const capability=b.sourceId||b.mask?'edit':'image';
 const targets=Array.isArray(b.targets)&&b.targets.length?b.targets:[{providerId:b.providerId||state.activeId,model:b.model||''}];
 if(targets.length>2||targets.length*count>12)throw Error('每批最多 2 个模型、合计 12 个任务');
 if(jobs.filter(j=>['queued','running'].includes(j.status)).length+targets.length*count>MAX_QUEUED)throw Error('待处理任务最多 '+MAX_QUEUED+' 个，请稍后再提交');
 const ratio=trim(b.ratio||'1:1',10),resolution=trim(b.resolution||'1K',5),quality=trim(b.quality||'auto',8);
 if(!['1:1','3:2','2:3','16:9','9:16','4:3','3:4'].includes(ratio))throw Error('比例不支持');
 if(!['1K','2K','4K'].includes(resolution))throw Error('分辨率不支持');
 if(!['auto','low','medium','high'].includes(quality))throw Error('画质参数不支持');
 const candidate=b.sourceId||images.find(n=>n.historyId&&n.role!=='style')?.historyId;
 const source=candidate?history.find(h=>h.id===candidate&&h.projectId===targetProject.id):null;
 if(candidate&&!source)throw Error('找不到当前项目中的源图片');
 if(b.mask&&!source)throw Error('局部蒙版必须先选择一张已生成图片');
 if(b.mask&&targets.some(t=>{const p=effectiveProvider(provider(t.providerId),capability);return !p||p.mode!=='openai'||(p.imageMode||'images')!=='images'}))throw Error('局部蒙版需要支持 OpenAI Images Edits 的接口');
 const transparentBg=!!b.transparentBg;
 if(transparentBg&&targets.some(t=>{const p=effectiveProvider(provider(t.providerId),capability);return !p||p.mode!=='openai'||(p.imageMode||'images')!=='images'}))throw Error('透明背景当前仅允许 OpenAI Images 模式（模型仍需支持透明输出）');
 const review=b.review?.enabled===true?(()=>{
   if(b.review.confirmed!==true)throw Error('必须确认额外的一次视觉审图费用');
   const rp=effectiveProvider(provider(b.review.providerId||state.activeId),'vision');emptyProvider(rp);
   const model=creativeModel(rp,'vision',b.review.model);
   const f=targetProject.creativeWorkflow||{},page=(f.pages||[]).find(x=>x.id===f.activePageId);
   return {providerId:rp.id,model,pageId:page?.id||null,
     rules:assistantMemory.guide(targetProject.assistantMemory,f.styleDNA||'',page?.requirements||'').slice(0,6500),
     requirements:String(page?.requirements||'').slice(0,2500)};
  })():null;
 const editMode=!!source&&b.editMode!=='new';
 const draftPrompt=editMode?('根据第一张参考原图精确编辑。除本轮明确要求改变的内容外，保持主体身份、脸部、服装结构、姿势、画面构图和风格一致。\n历史创作描述：'+source.prompt.slice(0,6500)+'\n本轮修改要求：'+instruction):instruction;
 const prompt=assistantMemory.generationPrompt(draftPrompt,targetProject.assistantMemory,targetProject.creativeWorkflow?.styleDNA||'',(targetProject.creativeWorkflow?.pages||[]).find(x=>x.id===targetProject.creativeWorkflow?.activePageId)?.requirements||'');
 return {capability,prompt,editInstruction:instruction,refs,referenceNodes:images,count,targets,ratio,resolution,quality,review,transparentBg,sourceId:source?.id||null,sourceNodeId,projectId:targetProject.id,canvasX:num(b.canvasX,180),canvasY:num(b.canvasY,170),mask:b.mask||null,maskSourceImage:b.maskSourceImage||null};
}
function submit(b){
 const valid=validateCreation(b);
 for(const t of valid.targets){const p=effectiveProvider(provider(t.providerId),valid.capability);emptyProvider(p);t.model=assertModel(t.model||p.imageModel)}
 const store=saveSourceFiles(valid.refs,valid.mask,valid.maskSourceImage);
 const uploadMedia=store.input.splice(0);store.roleHints=[];
 const source=valid.sourceId?history.find(h=>h.id===valid.sourceId):null;
 const effectiveRefs=valid.referenceNodes.filter(item=>!source||item.historyId!==source.id);
 for(const r of effectiveRefs){store.input.push(r.file);store.roleHints.push(r.role)}
 store.input.push(...uploadMedia);store.roleHints.push(...valid.refs.map(()=> 'general'));
 const groupId=crypto.randomUUID(),created=[];
 for(const t of valid.targets)for(let i=0;i<valid.count;i++)created.push(makeJob({...valid,batchIndex:created.length},store,t.providerId,t.model,groupId));
 jobs.unshift(...created);saveJobs();const proj=assertProject(valid.projectId);
 proj.messages.push({id:crypto.randomUUID(),role:'user',content:valid.editInstruction,createdAt:time(),groupId,sourceId:valid.sourceId,referenceRoles:valid.referenceNodes.map(n=>({nodeId:n.nodeId,role:n.role})),providerIds:valid.targets.map(t=>t.providerId)});
 proj.messages=proj.messages.slice(-400);touchProject(proj);schedule();return {jobs:created.map(publicJob),groupId};
}
const aiComponent=require('./lib/ai-component-plan');
const derivedAssets=require('./lib/asset-derivation');
const derivationBusy=new Set();
function derivationState(p){
 return p.assetDerivation||(p.assetDerivation={version:1,status:'idle',phase:'',error:'',styleDNA:'',referenceNodeIds:[],drafts:[],updatedAt:time()});
}
function derivationView(p){
 const d=derivationState(p),saved=p.creativeWorkflow?.styleDNA||'';
 return {derivation:{...d,styleDNA:d.styleDNA||'',drafts:(d.drafts||[]).map(item=>{
   const job=jobs.find(j=>j.id===item.jobId&&j.projectId===p.id);
   return {...item,status:job?.status||item.status,resultId:job?.resultId||null,error:job?.error||''};
  })},projectStyle:{available:!!saved,styleDNA:saved},types:derivedAssets.list()};
}
function validateStyleRefs(p,ids,required=false){
 if(!Array.isArray(ids)||ids.length>5||new Set(ids).size!==ids.length||(required&&!ids.length))
  throw Error('请选择 1 至 5 张不同的游戏风格参考图');
 for(const id of ids)creativePictureFromNode(p,id);
 return ids.slice();
}
function deriveProvider(config,cap){
 if(!config||typeof config!=='object')throw Error('请配置'+cap+'模型');
 const selected=effectiveProvider(provider(config.providerId||state.activeId),cap);
 emptyProvider(selected);
 return {provider:selected,model:creativeModel(selected,cap,config.model)};
}
function derivationStarted(p,phase){
 if(DEMO_MODE)throw Error('演示模式不能执行真实付费 AI');
 if(derivationBusy.has(p.id)||creativeBusy.has(p.id))throw Object.assign(Error('当前项目有分析任务正在运行'),{status:409});
 derivationBusy.add(p.id);
 const d=derivationState(p);
 d.status='running';d.phase=phase;d.error='';d.startedAt=time();d.updatedAt=time();touchProject(p);
 return d;
}
async function deriveStyle(p,ids,setting){
 const d=derivationStarted(p,'style');
 try{
  const conf=deriveProvider(setting,'vision');
  const refs=ids.map(id=>creativePictureFromNode(p,id));
  const text=await options.limiter.run(()=>analyzeCreativeImages(conf.provider,refs,conf.model,
    creativeUpstream.stylePrompt('为后续多个游戏素材提取共用 Style DNA；一张真实游戏画风图也可以使用。'),{timeoutMs:180000}));
  const guide=creativeUpstream.validateGuide(text);
  d.styleDNA=guide.yaml;d.referenceNodeIds=ids;d.styleReview=guide.review;
  // Plans produced for a previous visual DNA must not be silently submitted.
  for(const draft of d.drafts||[])if(draft.status==='draft')draft.status='stale';
  d.status='ready';d.phase='';d.updatedAt=time();touchProject(p);
 }catch(e){d.status='failed';d.error=String(e.message||e).slice(0,450);touchProject(p);throw e}
 finally{derivationBusy.delete(p.id)}
}
async function derivePrepare(p,items,ids,styleSource,setting){
 const d=derivationStarted(p,'prepare');
 try{
  const styleDNA=styleSource==='project'?p.creativeWorkflow?.styleDNA:d.styleDNA;
  if(styleSource==='derived'&&ids.length&&JSON.stringify(ids)!==JSON.stringify(d.referenceNodeIds||[]))
   throw Error('所选参考图与当前分析的画风不一致；请重新识图或取消本次参考图选择');
  if(!styleDNA)throw Error('没有可复用的 Style DNA，请先分析参考图');
  const conf=deriveProvider(setting,'text');
  const instruction=derivedAssets.buildPlanPrompt(items,styleDNA);
  const response=await options.limiter.run(()=>generateText(conf.provider,
   {model:conf.model,prompt:instruction,maxPromptChars:58000,maxOutputTokens:7600,timeoutMs:330000}));
  const next=derivedAssets.parsePlan(response,items);
  d.referenceNodeIds=ids;d.source=styleSource;
  d.styleHash=crypto.createHash('sha256').update(styleDNA).digest('hex');
  d.drafts=next.map(x=>({...x,id:crypto.randomUUID(),createdAt:time(),jobId:null}));
  d.status='ready';d.phase='';d.updatedAt=time();touchProject(p);
 }catch(e){d.status='failed';d.error=String(e.message||e).slice(0,450);touchProject(p);throw e}
 finally{derivationBusy.delete(p.id)}
}
function submitDerivation(p,body){
 if(DEMO_MODE)throw Error('演示模式不可调用付费图片生成');
 if(body.confirmCost!==true)throw Error('必须人工确认此次批量生图会产生费用');
 if(derivationBusy.has(p.id)||creativeBusy.has(p.id))throw Object.assign(Error('分析正在运行，请等待完成'),{status:409});
 const d=derivationState(p),ids=body.ids;
 const latestStyle=d.source==='project'?p.creativeWorkflow?.styleDNA:d.styleDNA;
 if(!latestStyle||crypto.createHash('sha256').update(latestStyle).digest('hex')!==d.styleHash)
  throw Error('Style DNA 已发生改变；旧草稿需要重新准备，不能直接批量生成');
 if(!Array.isArray(ids)||ids.length<1||ids.length>8||new Set(ids).size!==ids.length)throw Error('每次只能提交 1 至 8 个不同的草稿');
 const drafts=ids.map(id=>d.drafts.find(x=>x.id===id));
 if(drafts.some(x=>!x||x.status!=='draft'||x.jobId))throw Error('草稿不存在或已提交，不能重复扣费');
 if(jobs.filter(j=>['queued','running'].includes(j.status)).length+drafts.length>MAX_QUEUED)
  throw Error('生图队列已满，请等待现有任务完成');
 const conf=deriveProvider(body.image,'image');
 const refs=validateStyleRefs(p,d.referenceNodeIds||[]);
 const valid=drafts.map((draft,index)=>{
  const request={projectId:p.id,prompt:draft.prompt,referenceNodes:refs.map(nodeId=>({nodeId,role:'style'})),providerId:body.image.providerId,
   model:conf.model,ratio:draft.ratio,resolution:body.resolution||'1K',quality:body.quality||'auto',count:1,
   canvasX:220+(index%4)*330,canvasY:180+Math.floor(index/4)*400};
  const checked=validateCreation(request);
  if(checked.capability!=='image')throw Error('衍生素材只能走独立图片生成通道');
  return checked;
 });
 // All requests, image references, models, queue capacity and draft state are
 // verified BEFORE a single paid job is persisted. No partial batch submissions.
 const groupId=crypto.randomUUID(),created=[];
 for(let i=0;i<valid.length;i++){
  const entry=valid[i],refs=entry.referenceNodes,store={input:refs.map(r=>r.file),roleHints:refs.map(r=>r.role),mask:null,maskSource:null};
  created.push(makeJob({...entry,batchIndex:i},store,conf.provider.id,conf.model,groupId));
 }
 jobs.unshift(...created);saveJobs();
 drafts.forEach((draft,i)=>{draft.status='queued';draft.jobId=created[i].id});
 d.status='submitted';d.lastGroupId=groupId;d.updatedAt=time();
 p.messages.push({id:crypto.randomUUID(),role:'user',createdAt:time(),groupId,
  content:'一图衍生素材：'+drafts.map(x=>derivedAssets.TYPES[x.kind].label+' / '+x.description).join('；'),
  providerIds:[conf.provider.id]});
 p.messages=p.messages.slice(-400);touchProject(p);schedule();
 return {groupId,jobs:created.map(publicJob)};
}

const componentBusy=new Set();
function componentView(p){
 const plan=p.aiComponentPlan;if(!plan)return {plan:null};
 return {plan:{...plan,items:plan.items.map(item=>{
  const job=jobs.find(j=>j.id===item.jobId&&j.projectId===p.id);
  const resultId=job?.resultId||item.importedResultId;const result=resultId&&history.find(h=>h.id===resultId&&h.projectId===p.id);
  return {...item,status:job?.status||item.status,error:job?.error||"",resultId:result?.id||null,transparentVerified:result?.componentTransparent??null,url:result?BASE+"/api/media/"+result.file:null};
 })}};
}
async function componentAnalyze(p,b){
 if(DEMO_MODE)throw Error("演示模式不能调用付费模型");
 if(b.confirmCost!==true)throw Error("必须先确认识图费用");
 if(typeof b.historyId!=="string")throw Error("每次只能选择一张图片");
 const image=history.find(h=>h.id===b.historyId&&h.projectId===p.id);
 if(!image||!p.nodes.some(n=>n.kind==="generated"&&n.historyId===image.id))throw Error("请选择本项目画布上一张已生成图片");
 if(componentBusy.has(p.id)||creativeBusy.has(p.id)||derivationBusy.has(p.id))throw Object.assign(Error("当前项目已有分析任务"),{status:409});
 if((p.aiComponentPlan?.items||[]).some(item=>{const j=jobs.find(j=>j.id===item.jobId);return j&&["queued","running"].includes(j.status)}))throw Object.assign(Error("上一张图仍有组件正在生成，请先完成或取消后再识别新图"),{status:409});
 const cfg=b.vision||p.creativeWorkflow?.routing?.vision||{};
 const vision=effectiveProvider(provider(cfg.providerId||state.activeId),"vision");emptyProvider(vision);
 const model=creativeModel(vision,"vision",cfg.model);
 const plan={id:crypto.randomUUID(),sourceId:image.id,status:"analyzing",items:[],createdAt:time(),error:""};
 componentBusy.add(p.id);p.aiComponentPlan=plan;touchProject(p);
 try{
  const raw=await options.limiter.run(()=>analyzeCreativeImages(vision,[fetchMedia(image.file)],model,aiComponent.analysisPrompt(p.creativeWorkflow?.styleDNA||""),{timeoutMs:165000}));
  plan.items=aiComponent.parseInventory(raw).map(x=>({...x,id:crypto.randomUUID(),jobId:null}));
  plan.status="ready";plan.finishedAt=time();touchProject(p);
 }catch(e){plan.status="failed";plan.error=String(e.message||e).slice(0,350);touchProject(p);throw e}
 finally{componentBusy.delete(p.id)}
}
function componentAutoContinue(p){
 const plan=p.aiComponentPlan,auto=plan?.auto;if(!auto?.enabled)return;
 try{
  while(jobs.filter(j=>["queued","running"].includes(j.status)).length<MAX_QUEUED){
   const item=plan.items.find(x=>!x.jobId);if(!item)break;
   componentGenerate(p,{itemId:item.id,confirmCost:true,image:{providerId:auto.providerId,model:auto.model},resolution:auto.resolution,quality:auto.quality});
  }
  if(plan.items.every(x=>x.jobId)){auto.enabled=false;auto.submittedAt=time();touchProject(p)}
 }catch(e){auto.enabled=false;auto.error=String(e.message||e).slice(0,330);touchProject(p)}
}
function componentGenerateAll(p,b){
 if(DEMO_MODE)throw Error("演示模式禁止付费自动生图");
 if(b.confirmCost!==true)throw Error("请确认将为所有待制作组件调用付费图片模型");
 const plan=p.aiComponentPlan;if(plan?.status!=="ready")throw Error("请先识别这一张图片");
 if(plan.auto?.enabled)throw Object.assign(Error("正在自动制作此图组件"),{status:409});
 const pending=plan.items.filter(item=>!item.jobId);if(!pending.length)throw Error("没有待自动制作的组件，可单独重试失败项");
 const cfg=b.image||p.creativeWorkflow?.routing?.image||{};const conf=deriveProvider(cfg,"image");
 plan.auto={enabled:true,providerId:conf.provider.id,model:conf.model,resolution:b.resolution||"1K",quality:b.quality||"auto",approvedCount:pending.length,startedAt:time(),error:""};
 touchProject(p);componentAutoContinue(p);return {approvedCount:pending.length,plan:componentView(p).plan};
}
function componentGenerate(p,b){
 if(DEMO_MODE)throw Error("演示模式不能生成付费组件");
 if(b.confirmCost!==true)throw Error("必须确认组件生成费用");
 const plan=p.aiComponentPlan;if(plan?.status!=="ready")throw Error("请先完成 AI 组件识别");
 const item=plan.items.find(x=>x.id===b.itemId);if(!item)throw Error("组件不存在");
 const old=jobs.find(j=>j.id===item.jobId&&j.projectId===p.id);
 if(old&&["queued","running"].includes(old.status))throw Object.assign(Error("组件生成中，请勿重复提交"),{status:409});
 if(old?.status==="done"&&b.retry!==true)throw Error("需要明确确认重新生成");
 if(jobs.filter(j=>["queued","running"].includes(j.status)).length>=MAX_QUEUED)throw Error("队列已满");
 const source=history.find(h=>h.id===plan.sourceId&&h.projectId===p.id);if(!source)throw Error("原图不存在");
 const config=b.image||p.creativeWorkflow?.routing?.image||{};const conf=deriveProvider(config,"image");
 const node=p.nodes.find(n=>n.kind==="generated"&&n.historyId===source.id);
 const job=makeJob({capability:"image",projectId:p.id,sourceId:source.id,prompt:aiComponent.componentPrompt(item,p.creativeWorkflow?.styleDNA||""),
  transparentBg:item.category!=="background",ratio:item.category==="background"?"9:16":"1:1",resolution:b.resolution||"1K",quality:b.quality||"auto",sourceNodeId:node?.id},
  {input:[],roleHints:[],mask:null,maskSource:null},conf.provider.id,conf.model,plan.id);
 job.componentItemId=item.id;
 jobs.unshift(job);saveJobs();item.jobId=job.id;item.status="queued";touchProject(p);schedule();
 return {job:publicJob(job)};
}
// Pinned upstream sprite splitting / atlas delivery integration. Each workspace
// writes only inside its own DATA_DIR, never into public/static paths.
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const deliveryExecute=promisify(execFile);
const deliveryBusy=new Set();
const DELIVERY_ROOT=path.join(DATA_DIR,'game-ui-deliveries');
fs.mkdirSync(DELIVERY_ROOT,{recursive:true,mode:0o700});
function deliveryPack(p,id){
 const item=(p.uiDeliveryPacks||[]).find(x=>x.id===id);
 if(!item)throw Object.assign(Error('组件包不存在'),{status:404});
 return item;
}
function deliveryPath(p,pack){
 if(!/^[a-f0-9-]{36}$/.test(p.id)||!/^[a-f0-9-]{36}$/.test(pack.id))throw Error('交付包标识不合法');
 return path.join(DELIVERY_ROOT,p.id,pack.id);
}
function deliveryView(p){
 const files=(p.uiDeliveryPacks||[]).map(pack=>({
  ...pack,
  items:pack.items||[],
  pngPreview:(pack.items||[]).map((item,index)=>BASE+'/api/projects/'+p.id+'/delivery/'+pack.id+'/file/sprite/'+index),
  zipURL:pack.status==='delivered'?BASE+'/api/projects/'+p.id+'/delivery/'+pack.id+'/file/zip':null,
  atlasURL:pack.status==='delivered'?BASE+'/api/projects/'+p.id+'/delivery/'+pack.id+'/file/atlas':null,
  reviewedZipURL:pack.status==='delivered'?BASE+'/api/projects/'+p.id+'/delivery/'+pack.id+'/file/reviewed-zip':null
 }));
 return {packs:files,sources:history.filter(h=>h.projectId===p.id&&h.file).slice(0,120).map(h=>({
  id:h.id,createdAt:h.createdAt,previewURL:BASE+'/api/previews/'+h.file,
  url:BASE+'/api/media/'+h.file,prompt:(h.prompt||'').slice(0,140),size:h.resolution
 })),maxPacks:20};
}
async function deliveryWorker(p,pack,task){
 const dir=deliveryPath(p,pack);
 try{
  const {stdout}=await deliveryExecute('python3',[path.join(ROOT,'lib/game-ui-delivery.py'),task,dir],
   {cwd:ROOT,timeout:task==='split'?110000:135000,maxBuffer:1024*1024,
    env:{...nativeProcess.env,PYTHONUNBUFFERED:'1'}});
  const output=JSON.parse(stdout.trim());
  if(task==='split'){
   pack.status='review';pack.items=output.items;pack.detectedMode=output.detectedMode;
  }else{
   pack.status='delivered';pack.atlasSize=output.atlasSize;pack.targets=output.manifestTargets;
  }
  pack.error='';pack.updatedAt=time();touchProject(p);
 }catch(e){
  pack.status='failed';pack.error=String(e.stderr||e.message||'本地资源处理失败').slice(0,450);
  pack.updatedAt=time();touchProject(p);
  diag({source:'delivery',level:'error',action:task,message:pack.error});
 }finally{deliveryBusy.delete(p.id)}
}
function deliveryStart(p,body){
 if(DEMO_MODE)throw Error('演示模式不支持素材切割');
 if(deliveryBusy.has(p.id))throw Object.assign(Error('该项目已有切图任务进行中'),{status:409});
 if((p.uiDeliveryPacks||[]).length>=20)throw Error('该项目最多保留 20 个交付包');
 if(body.approvedPage!==true)throw Error('请先人工确认这是已批准的 UI Kit / 素材板，不是混杂文字的完整页面');
 const item=history.find(h=>h.id===body.historyId&&h.projectId===p.id);
 if(!item)throw Error('请选择当前项目已有的一张真实生图作品');
 const mode=body.mode||'auto';
 if(!['auto','alpha','background'].includes(mode))throw Error('切图识别模式不支持');
 const tolerance=Number(body.tolerance??20),connectGap=Number(body.connectGap??2);
 if(!Number.isInteger(tolerance)||tolerance<0||tolerance>80||
   !Number.isInteger(connectGap)||connectGap<0||connectGap>10)throw Error('切图参数超出允许范围');
 const file=mediaPath(item.file);
 if(fs.statSync(file).size>18*1024*1024)throw Error('源图片超过 18 MB，无法安全切图');
 const pack={id:crypto.randomUUID(),historyId:item.id,createdAt:time(),updatedAt:time(),status:'splitting',
  error:'',detectedMode:'',items:[],sourcePrompt:(item.prompt||'').slice(0,700)};
 const directory=deliveryPath(p,pack);
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 fs.copyFileSync(file,path.join(directory,'source.png'));
 fs.writeFileSync(path.join(directory,'split-config.json'),JSON.stringify({mode,tolerance,connectGap}),{mode:0o600});
 p.uiDeliveryPacks=[pack,...(p.uiDeliveryPacks||[])];touchProject(p);deliveryBusy.add(p.id);
 void deliveryWorker(p,pack,'split');
 return pack;
}
function deliveryApprove(p,pack,body){
 if(deliveryBusy.has(p.id)||pack.status==='delivering')throw Object.assign(Error('组件包还在处理中'),{status:409});
 if(pack.status!=='review')throw Error('请先拆分素材板并检查所有切片');
 if(body.confirmTextFree!==true||body.confirmSlices!==true)throw Error('请确认切片无文字且透明边缘完整');
 const items=body.items;
 if(!Array.isArray(items)||items.length!==pack.items.length||items.length<1||items.length>64)throw Error('组件映射数量不匹配');
 const names=new Set();
 for(let i=0;i<items.length;i++){
  const o=items[i],n=o?.semanticName;
  if(o?.id!==pack.items[i].id||typeof n!=='string'||!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(n)||n.length>64||names.has(n))
   throw Error('第 '+(i+1)+' 个组件的命名重复或非法（使用英文 kebab-case）');
  names.add(n);
  if(!['control','container','icon','character','decoration','background','object'].includes(o.category)||
   !['default','pressed','selected','disabled','locked','claimed','loading'].includes(o.state)||
   !['full','1:1','tile','9-slice'].includes(o.sliceType))throw Error('组件类别/状态/切片类型无效');
  const m=o.margins;
  if(!Array.isArray(m)||m.length!==4||m.some(v=>!Number.isInteger(v)||v<0||v>10000))throw Error('9-slice 边距必须为非负整数');
  const [w,h]=pack.items[i].dimensions;
  if(o.sliceType==='9-slice'&&(m[0]+m[1]>=w||m[2]+m[3]>=h))throw Error('9-slice 边距不能超出组件尺寸');
 }
 const dir=deliveryPath(p,pack);
 fs.writeFileSync(path.join(dir,'delivery-config.json'),JSON.stringify({items}),{mode:0o600});
 pack.items=pack.items.map((x,i)=>({...x,semanticName:items[i].semanticName,category:items[i].category,
    state:items[i].state,sliceType:items[i].sliceType,margins:items[i].margins}));
 pack.status='delivering';pack.updatedAt=time();touchProject(p);deliveryBusy.add(p.id);
 void deliveryWorker(p,pack,'deliver');
 return pack;
}
function deliveryDownload(req,res,p,pack,kind,index){
 if(!['review','delivered'].includes(pack.status))throw Error('组件文件尚未准备完成');
 const root=deliveryPath(p,pack);
 let file,mime='application/octet-stream',download=false;
 if(kind==='sprite'){
  const i=Number(index);
  if(!Number.isInteger(i)||i<0||i>63||i>=pack.items.length)throw Error('组件不存在');
  file=path.join(root,'assets/sprites/detected',pack.items[i].filename);
  mime='image/png';
 }else{
  if(pack.status!=='delivered')throw Error('请先人工审核组件后再导出');
  const map={
   'zip':['packages/game-ui-delivery.zip','application/zip'],
   'reviewed-zip':['packages/sprites-reviewed.zip','application/zip'],
   'atlas':['assets/atlases/main.png','image/png'],
   'unity':['exports/unity/main.json','application/json'],
   'cocos':['exports/cocos/main.json','application/json'],
   'godot':['exports/godot/main.json','application/json'],
   'generic':['exports/generic/main.json','application/json']
  };
  const found=map[kind];
  if(!found)throw Error('不支持此组件资源');
  file=path.join(root,found[0]);mime=found[1];download=true;
 }
 if(!fs.existsSync(file))return fail(res,404,'该组件文件尚未生成');
 if(download)res.setHeader('Content-Disposition','attachment; filename="hamoki-'+pack.id.slice(0,8)+'-'+kind+(mime==='application/zip'?'.zip':mime==='image/png'?'.png':'.json')+'"');
 return sendMedia(req,res,file,mime,'private, no-store');
}

function staticFile(res,pathname){if(pathname==='/')pathname='/index.html';if(!/^\/(?:index\.html|assets\/[a-zA-Z0-9-]+\.(?:css|js|png|webp|ico))$/.test(pathname))return fail(res,404,'资源不存在');fs.readFile(path.join(ROOT,pathname),(e,buf)=>{if(e)return fail(res,404,'资源不存在');const ext=path.extname(pathname);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'})[ext],'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",'Cache-Control':'no-cache'});res.end(buf)})}
async function handler(req,res){if(ALLOWED_HOST&&String(req.headers.host||'').split(':')[0].toLowerCase()!==ALLOWED_HOST)return fail(res,421,'请求域名不符合独立安全域名配置');const url=new URL(req.url,'http://localhost');
  if(BASE && url.pathname===BASE){res.writeHead(308,{Location:BASE+'/'});return res.end()}
  if(BASE && !url.pathname.startsWith(BASE+'/'))return fail(res,404,'项目路径不存在');
  const route=BASE?url.pathname.slice(BASE.length):url.pathname;
  if(!route.startsWith('/api/'))return staticFile(res,route);
  try{
    if(req.method==='GET'&&route==='/api/status')return respond(res,200,{backend:true,authenticated:auth(req),version:'0.6.3',anonymous:process.env.ANON_WORKSPACE==='1',demoMode:DEMO_MODE,basePath:BASE});
    if(req.method==='POST'&&route==='/api/login'){if(process.env.ANON_WORKSPACE==='1')return fail(res,404,'免登录工作区无需密码');
      const address=req.socket.remoteAddress||'?';const hit=attempts.get(address)||{count:0,until:0};if(hit.count>=10&&hit.until>Date.now())return fail(res,429,'尝试次数过多，请稍后再试');
      const incoming=await readJSON(req);const entered=crypto.createHash('sha256').update(String(incoming.password||'')).digest(),expected=crypto.createHash('sha256').update(PASSWORD).digest();
      if(!crypto.timingSafeEqual(entered,expected)){attempts.set(address,{count:hit.count+1,until:Date.now()+900000});return fail(res,401,'管理密码不正确')}
      attempts.delete(address);const token=crypto.randomBytes(32).toString('hex');sessions.set(token,Date.now()+43200000);res.setHeader('Set-Cookie',`hs_session=${token}; HttpOnly; SameSite=Strict; Path=${BASE||''}/; Max-Age=43200${req.socket.encrypted||process.env.COOKIE_SECURE==='1'?'; Secure':''}`);return respond(res,200,{ok:true});
    }
    if(!auth(req))return fail(res,401,'请先输入管理密码解锁');
    if(req.method!=='GET'){
      if(req.method!=='DELETE'&&req.headers['content-type']?.split(';')[0]!=='application/json')return fail(res,415,'需要 application/json 请求');
      if(req.headers.origin){const origin=new URL(req.headers.origin);if(origin.host!==req.headers.host||!['http:','https:'].includes(origin.protocol))return fail(res,403,'禁止跨站请求')}
    }
    if(DEMO_MODE && ((route.startsWith('/api/providers') && req.method!=='GET' && !(route.endsWith('/activate') && req.method==='POST')) || ['/api/models','/api/reverse'].includes(route) || /\/(?:check|probe)$/.test(route)))return fail(res,403,'共享测试站只演示画布与生成流程，不允许保存真实 API Key 或执行上游请求；请在独立域名启用真实服务');
    if(route==='/api/logout'&&req.method==='POST'&&process.env.ANON_WORKSPACE==='1')return fail(res,405,'免登录工作区无需退出');
    if(route==='/api/logout'&&req.method==='POST'){sessions.delete(cookie(req));res.setHeader('Set-Cookie',`hs_session=; HttpOnly; SameSite=Strict; Path=${BASE||''}/; Max-Age=0`);return respond(res,200,{ok:true})}
    if(req.method==='GET'&&route==='/api/storage')return respond(res,200,{...storageUsage(),mode:'local',concurrency:CONCURRENCY,notice:'每个账号默认 1GB 空间，空间不足时会自动清理最旧的历史图片和浏览器预览；请定期导出重要作品。'});
    const creativeMatch=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/creative(?:\/(document|document-remove|settings|analyze|director-retry|quality|split|page))?$/);
    if(creativeMatch){
      const p=assertProject(creativeMatch[1]),action=creativeMatch[2],f=creativeState(p);
      if(!action&&req.method==='GET')return respond(res,200,creativeView(p));
      if(creativeBusy.has(p.id))return fail(res,409,'此项目的 AI 任务正在运行，请待完成后再修改');
      if(action==='document'&&req.method==='POST'){
        const b=await readJSON(req);
        if(typeof b.name!=='string'||!b.name.toLowerCase().endsWith('.docx'))throw Error('只支持 Word .docx 文件');
        if(f.documents.length>=creativePages.MAX_DOCUMENTS)throw Error('当前项目最多保存 12 份 Word，请另建一个项目');
        if(typeof b.data!=='string'||b.data.length>MAX_DOCX*1.38||!/^([A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.data))throw Error('Word 文件格式错误或超过 12MB');
        const raw=Buffer.from(b.data,'base64'),hash=crypto.createHash('sha256').update(raw).digest('hex');
        if(f.documents.some(x=>x.name===b.name))return fail(res,409,'已有同名 Word，请先删除旧文件或换一个文件名后重新上传');
        if(f.documents.some(x=>x.hash===hash))return fail(res,409,'这份 Word 已经上传过了，避免重复导入');
        if(p.nodes.length+20>1800)throw Error('画布素材数量不足，无法继续导入原型图');
        const extracted=await parseDocx(raw,img=>storeMedia(img));
        const doc={id:crypto.randomUUID(),name:clampText(b.name,140),text:extracted.text,blocks:extracted.blocks,
          images:extracted.images.map(im=>({...im,nodeId:null})),hash:extracted.hash,warnings:extracted.warnings,importedAt:time()};
        for(const im of doc.images){
          const i=p.nodes.length;
          const node={id:crypto.randomUUID(),kind:'reference',assetFile:im.file,title:doc.name+' · 原型 '+(im.index+1),
            x:80+(i%6)*330,y:70+Math.floor(i/6)*360,w:288,h:320,createdAt:time()};
          p.nodes.push(node);im.nodeId=node.id;
        }
        f.documents.push(doc);f.document=doc;
        f.pages=creativePages.mergePages(f.pages,f.documents);
        if(!f.activePageId||!f.pages.some(x=>x.id===f.activePageId))f.activePageId=f.pages[0]?.id||null;
        f.analysis=creativeCurrent(f)?.analysis||{};f.quality=creativeCurrent(f)?.quality||null;
        f.stages.document='done';f.status=f.analysis.prompt?'ready':'document-ready';f.error='';f.progress=null;
        touchProject(p);
        return respond(res,201,{...creativeView(p),importedImages:doc.images.length,createdPages:f.pages.length});
      }
      if(action==='document-remove'&&req.method==='POST'){
        const b=await readJSON(req),doc=f.documents.find(x=>x.id===b.docId);
        if(!doc)throw Error('指定 Word 文档不存在');
        const deletedIds=new Set((doc.images||[]).map(x=>x.nodeId));
        f.documents=f.documents.filter(x=>x.id!==doc.id);
        f.document=f.documents.at(-1)||null;
        f.pages=f.pages.filter(x=>x.docId!==doc.id);
        p.nodes=p.nodes.filter(x=>!deletedIds.has(x.id));
        cleanupMessages(p,null,deletedIds);
        const refs=f.styleNodeIds.filter(x=>!deletedIds.has(x));
        if(refs.length!==f.styleNodeIds.length){f.styleNodeIds=refs;f.styleDNA='';f.styleLocked=false}
        if(!f.pages.some(x=>x.id===f.activePageId))f.activePageId=f.pages[0]?.id||null;
        f.analysis=creativeCurrent(f)?.analysis||{};f.quality=creativeCurrent(f)?.quality||null;
        f.status=f.analysis.prompt?'ready':f.documents.length?'document-ready':'empty';
        f.stages.document=f.documents.length?'done':'pending';f.error='';
        touchProject(p);return respond(res,200,creativeView(p));
      }
      if(action==='settings'&&req.method==='POST'){
        const oldRefs=JSON.stringify(f.styleNodeIds||[]);
        creativeSetup(await readJSON(req),f,p);
        f.analysis=creativeCurrent(f)?.analysis||{};
        f.quality=creativeCurrent(f)?.quality||null;
        if(oldRefs!==JSON.stringify(f.styleNodeIds||[])){f.stages.style='pending';f.stages.director='pending'}
        f.error='';f.status=f.analysis.prompt?'ready':f.documents.length?'document-ready':'empty';
        p.creativeWorkflow=f;touchProject(p);return respond(res,200,creativeView(p));
      }
      if(action==='page'&&req.method==='POST'){
        const b=await readJSON(req),page=f.pages.find(x=>x.id===b.pageId);
        if(!page)throw Error('无法找到所选页面');
        f.activePageId=page.id;
        let changed=false;
        const d=creativePageDoc(f,page);
        if(b.prototypeIndex!==undefined){
          const idx=Number(b.prototypeIndex);
          if(!Number.isInteger(idx)||idx< -1||idx>=d.images.length)throw Error('原型编号超出文档范围');
          const before=page.layoutImageIndex??page.imageIndexes?.[0]??null;
          const after=idx<0?null:idx;
          if(before!==after){page.layoutImageIndex=after;page.imageIndexes=after===null?[]:[after];changed=true}
        }
        if(b.requirements!==undefined){
          const next=clampText(b.requirements,4400).trim();
          if(!next)throw Error('本页需求不能为空');
          if(next!==page.requirements){page.requirements=next;changed=true}
        }
        if(b.reset===true)changed=true;
        if(changed){page.analysis={};page.quality=null;page.status='draft';f.stages.director='pending';f.stages.layout='pending'}
        f.analysis=page.analysis||{};f.quality=page.quality||null;f.status=f.analysis.prompt?'ready':'document-ready';
        touchProject(p);return respond(res,200,creativeView(p));
      }
      if(action==='split'&&req.method==='POST'){
        if(!f.documents.length)throw Error('请先上传 Word 策划文档');
        if(!state.providers.length)throw Error('请先在中转站管理配置文字模型');
        creativeCheckModels(f,'split');
        void creativeSplit(p).catch(e=>diag({source:'creative',level:'error',action:'split',message:String(e.message||e).slice(0,350)}));
        return respond(res,202,{started:true,flowStatus:'running'});
      }
      if(action==='analyze'&&req.method==='POST'){
        if(!f.documents.length||!f.pages.length)throw Error('请先上传 Word 并拆解页面');
        if(!state.providers.length)throw Error('请先配置文字模型，才能执行 AI 分析');
        const b=await readJSON(req);
        if(b.pageId&&!f.pages.some(x=>x.id===b.pageId))throw Error('未找到该页面');
        creativeCheckModels(f,'analyze',{pageId:b.pageId,batch:b.batch===true});
        void creativeAnalyze(p,{pageId:b.pageId,batch:b.batch===true}).catch(e=>diag({source:'creative',level:'error',action:'analyze',message:String(e.message||e).slice(0,350)}));
        return respond(res,202,{started:true,flowStatus:'running'});
      }
      if(action==='director-retry'&&req.method==='POST'){
        const b=await readJSON(req);
        if(!state.providers.length)throw Error('请先配置文字模型');
        creativeCheckModels(f,'director-retry');
        const page=f.pages.find(x=>x.id===(b.pageId||f.activePageId));
        if(!page?.analysis?.layout||page.analysis?.prompt||page.status!=='failed'||f.stages.director!=='failed')
          throw Error('没有可以单独重试的美术总监失败任务');
        void creativeRetryDirector(p,{pageId:b.pageId}).catch(e=>diag({source:'creative',level:'error',action:'director-retry',message:String(e.message||e).slice(0,350)}));
        return respond(res,202,{started:true,flowStatus:'running'});
      }
      if(action==='quality'&&req.method==='POST'){
        const b=await readJSON(req);
        if(typeof b.historyId!=='string'||!history.some(h=>h.id===b.historyId&&h.projectId===p.id))throw Error('请选择当前项目的一张有效生成图');
        creativeCheckModels(f,'quality');
        void creativeQuality(p,b.historyId).catch(e=>diag({source:'creative',level:'error',action:'quality',message:String(e.message||e).slice(0,350)}));
        return respond(res,202,{started:true,flowStatus:'running'});
      }
      return fail(res,405,'此工作流接口不支持该操作');
    }
    // Private project-scoped sprite slicing / engine export. No paid AI calls.
    const packFileMatch=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/delivery\/([a-f0-9-]{36})\/file\/(sprite|zip|reviewed-zip|atlas|unity|cocos|godot|generic)(?:\/(\d+))?$/);
    if(packFileMatch&&req.method==='GET'){
     const p=assertProject(packFileMatch[1]),pack=deliveryPack(p,packFileMatch[2]);
     return deliveryDownload(req,res,p,pack,packFileMatch[3],packFileMatch[4]);
    }
    const componentRoute=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/ai-components(?:\/(analyze|generate|generate-all))?$/);
    if(componentRoute){
     const p=assertProject(componentRoute[1]),action=componentRoute[2];
     if(!action&&req.method==="GET")return respond(res,200,componentView(p));
     if(action==="analyze"&&req.method==="POST"){
      const b=await readJSON(req);
      if(componentBusy.has(p.id))return fail(res,409,"正在识别组件");
      if(b.confirmCost!==true)throw Error("需确认识图费用");
      if(typeof b.historyId!=="string"||!history.some(h=>h.id===b.historyId&&h.projectId===p.id))throw Error("图片不属于当前项目");
      const cfg=b.vision||p.creativeWorkflow?.routing?.vision||{};
      const vp=effectiveProvider(provider(cfg.providerId||state.activeId),"vision");emptyProvider(vp);creativeModel(vp,"vision",cfg.model);
      if((p.aiComponentPlan?.items||[]).some(item=>{const j=jobs.find(j=>j.id===item.jobId);return j&&["queued","running"].includes(j.status)}))return fail(res,409,"仍有拆解组件生成中，不能覆盖原图");
      void componentAnalyze(p,b).catch(e=>diag({source:"components",level:"error",action:"analyze",message:String(e.message||e).slice(0,350)}));
      return respond(res,202,{started:true});
     }
     if(action==="generate"&&req.method==="POST")return respond(res,202,componentGenerate(p,await readJSON(req)));
     if(action==="generate-all"&&req.method==="POST")return respond(res,202,componentGenerateAll(p,await readJSON(req)));
     return fail(res,405,"不支持的拆件操作");
    }
    const deliveryRoute=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/delivery(?:\/(split|approve))?$/);
    if(deliveryRoute){
     const p=assertProject(deliveryRoute[1]),action=deliveryRoute[2];
     if(!action&&req.method==='GET')return respond(res,200,deliveryView(p));
     if(action==='split'&&req.method==='POST'){
      const b=await readJSON(req);return respond(res,202,{pack:deliveryStart(p,b)});
     }
     if(action==='approve'&&req.method==='POST'){
      const b=await readJSON(req),pack=deliveryPack(p,b.packId);
      return respond(res,202,{pack:deliveryApprove(p,pack,b)});
     }
     return fail(res,405,'此素材交付接口操作不支持');
    }
    const deriveMatch=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/derive(?:\/(style|prepare|drafts|submit))?$/);
    if(deriveMatch){
      const p=assertProject(deriveMatch[1]),action=deriveMatch[2],d=derivationState(p);
      if(!action&&req.method==='GET')return respond(res,200,derivationView(p));
      if(derivationBusy.has(p.id)||creativeBusy.has(p.id))return fail(res,409,'此项目已有 AI 分析任务，请稍后再操作');
      if(action==='style'&&req.method==='POST'){
       const b=await readJSON(req);
       if(b.confirmCost!==true)throw Error('必须确认付费风格识图请求');
       const ids=validateStyleRefs(p,b.referenceNodeIds,true);
       deriveProvider(b.vision,'vision');
       void deriveStyle(p,ids,b.vision).catch(e=>diag({source:'derive',level:'error',action:'style',message:String(e.message||e).slice(0,300)}));
       return respond(res,202,{started:true,phase:'style'});
      }
      if(action==='prepare'&&req.method==='POST'){
       const b=await readJSON(req),items=derivedAssets.validateItems(b.items);
       const ids=validateStyleRefs(p,b.referenceNodeIds||[]);
       if(b.styleSource!=='project'&&b.styleSource!=='derived')throw Error('必须选择要使用的 Style DNA');
       const style=b.styleSource==='project'?p.creativeWorkflow?.styleDNA:d.styleDNA;
       if(!style)throw Error('当前没有已分析的 Style DNA');
       if(b.confirmCost!==true)throw Error('必须确认付费文字模型会用于准备素材草稿');
       deriveProvider(b.text,'text');
       void derivePrepare(p,items,ids,b.styleSource,b.text).catch(e=>diag({source:'derive',level:'error',action:'prepare',message:String(e.message||e).slice(0,300)}));
       return respond(res,202,{started:true,phase:'prepare'});
      }
      if(action==='drafts'&&req.method==='POST'){
       const b=await readJSON(req),edits=b.edits;
       if(!Array.isArray(edits)||edits.length<1||edits.length>8||new Set(edits.map(x=>x.id)).size!==edits.length)throw Error('草稿更新格式无效');
       for(const edit of edits){
        const draft=d.drafts?.find(x=>x.id===edit.id);
        if(!draft||draft.status!=='draft'||draft.jobId)throw Error('草稿已提交或不存在');
        if(typeof edit.prompt!=='string'||edit.prompt.trim().length<40||edit.prompt.length>7000)throw Error('提示词需为 40 至 7000 字');
        if(edit.ratio!==undefined&&!['1:1','3:2','2:3','16:9','9:16','4:3','3:4'].includes(edit.ratio))throw Error('不支持此生图比例');
       }
       for(const edit of edits){
        const draft=d.drafts.find(x=>x.id===edit.id);draft.prompt=edit.prompt.trim();if(edit.ratio)draft.ratio=edit.ratio;
       }
       d.updatedAt=time();touchProject(p);return respond(res,200,derivationView(p));
      }
      if(action==='submit'&&req.method==='POST'){
       const b=await readJSON(req);
       return respond(res,201,submitDerivation(p,b));
      }
      return fail(res,405,'衍生素材接口操作不支持');
    }
    // Project, board, and conversation state are stored on the server, not localStorage.
    if(route==='/api/assistant/plan'&&req.method==='POST'){
      if(DEMO_MODE)return fail(res,403,'演示模式不支持 AI 意图分析');
      const b=await readJSON(req),target=assertProject(b.projectId);
      const prompt=clampText(b.prompt,3000).trim();
      if(!prompt)throw Error('请先输入你的要求');
      const pp=effectiveProvider(provider(b.providerId||state.activeId),'text');
      emptyProvider(pp);
      const model=assertModel(b.model||normalizedCapability(pp,'text').defaultModel);
      const n=target.nodes.find(x=>x.id===b.selectedNodeId);
      const hasImage=!!(n&&n.kind==='generated');
      const context=assistantMemory.guide(target.assistantMemory,target.creativeWorkflow?.styleDNA||'',(target.creativeWorkflow?.pages||[]).find(x=>x.id===target.creativeWorkflow?.activePageId)?.requirements||'')
        +'\n当前选中已生成图片：'+(hasImage?'是':'否')+'\n最近聊天：'+target.messages.slice(-8).map(x=>x.role+': '+clampText(x.content,280)).join('\n');
      const raw=await options.limiter.run(()=>generateText(pp,{model,prompt:assistantMemory.planningPrompt(prompt,context),maxOutputTokens:700,timeoutMs:90000}));
      const plan=assistantMemory.parsePlan(raw);
      if(plan.mode==='edit'&&!hasImage)return respond(res,200,{plan:{action:'chat',reply:'请先选中你要修改的图片，我会只针对它继续创作。'}});
      return respond(res,200,{plan});
    }
    if(route==='/api/projects'&&req.method==='GET')return respond(res,200,{projects:projects.filter(p=>!p.archived).map(p=>({id:p.id,title:p.title,createdAt:p.createdAt,updatedAt:p.updatedAt,imageCount:p.nodes.filter(n=>n.kind!=='note').length})),defaultId:defaultProject()?.id||null});
    if(route==='/api/projects'&&req.method==='POST'){
      if(projects.filter(p=>!p.archived).length>=80)throw Error('项目数量已达到上限');
      const b=await readJSON(req),p=makeProject(clampText(b.title,70).trim()||'未命名项目');projects.unshift(p);saveProjects();return respond(res,201,{project:projectView(p)});
    }
    if(route==='/api/projects/import'&&req.method==='POST'){const b=await readJSON(req);return respond(res,201,{project:importProject(b)})}
    const backupMatch=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/backup$/);
    if(backupMatch&&req.method==='GET'){
      const p=assertProject(backupMatch[1]),archive=projectBackup(p);
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':archive.length,'Content-Disposition':'attachment; filename="hamoki-project-'+p.id.slice(0,8)+'.hamoki"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return res.end(archive);
    }
    const memoryMatch=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/memory(?:\/(rule|feedback))?$/);
    if(memoryMatch){
      const p=assertProject(memoryMatch[1]),kind=memoryMatch[2];
      if(req.method==='GET'&&!kind)return respond(res,200,{memory:assistantMemory.normalize(p.assistantMemory)});
      if(req.method==='POST'&&kind==='rule'){
        const b=await readJSON(req);
        p.assistantMemory=assistantMemory.learnRule(p.assistantMemory,b.text,crypto.randomUUID(),time());
        touchProject(p);return respond(res,200,{memory:p.assistantMemory});
      }
      if(req.method==='DELETE'&&kind==='rule'){
        const b=await readJSON(req);p.assistantMemory=assistantMemory.forgetRule(p.assistantMemory,b.id);
        touchProject(p);return respond(res,200,{memory:p.assistantMemory});
      }
      if(req.method==='POST'&&kind==='feedback'){
        const b=await readJSON(req),n=p.nodes.find(x=>x.id===b.nodeId&&x.kind==='generated');
        if(!n||n.historyId!==b.historyId)throw Error('选中图片与项目不匹配');
        p.assistantMemory=assistantMemory.mark(p.assistantMemory,b.kind,n.id,n.historyId,b.note,time());
        touchProject(p);return respond(res,200,{memory:p.assistantMemory});
      }
      return fail(res,405,'记忆操作不支持');
    }
    // Bulk operations are project-scoped: asset files and generated history must belong to this account/project.
    const exportNodes=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/nodes\/export$/);
    if(exportNodes&&req.method==='GET'){
      const p=assertProject(exportNodes[1]),ids=(url.searchParams.get('ids')||'').split(',').filter(Boolean);
      if(!ids.length||ids.length>80||new Set(ids).size!==ids.length||ids.some(id=>!/^[a-f0-9-]{36}$/.test(id)))throw Error('请选择 1 至 80 张不同的图片');
      const refs=new Map(p.nodes.filter(n=>n.kind!=='note').map(n=>[n.id,n]));
      if(ids.some(id=>!refs.has(id)))return fail(res,404,'部分图片已不在当前画布');
      const files=ids.map((id,i)=>{
        const n=refs.get(id);
        const h=n.kind==='reference'?null:history.find(x=>x.id===n.historyId&&x.projectId===p.id);
        const name=n.kind==='reference'?n.assetFile:h?.file;
        if(!name||!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(name))throw Error('选中图片缺少有效原图');
        const raw=fs.readFileSync(mediaPath(name));
        return {name:'hamoki-'+String(i+1).padStart(3,'0')+'-'+id.slice(0,8)+'.'+name.split('.').pop(),bytes:raw};
      });
      if(files.reduce((total,f)=>total+f.bytes.length,0)>180*1024*1024)throw Error('选择图片总大小超过 180MB，请分批下载');
      const zip=pack(files);
      res.writeHead(200,{'Content-Type':'application/zip','Content-Length':zip.length,'Content-Disposition':'attachment; filename="hamoki-selected-images.zip"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return res.end(zip);
    }
    const restoreNodes=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/nodes\/restore$/);
    if(restoreNodes&&req.method==='POST'){
      const p=assertProject(restoreNodes[1]),b=await readJSON(req);
      const batch=(p.removedBatches||[]).find(x=>x.id===b.batchId);
      if(!batch)return fail(res,404,'无法恢复：删除记录不存在');
      const existing=new Set(p.nodes.map(n=>n.id));
      if(batch.nodes.some(n=>existing.has(n.id)))throw Error('部分删除的元素已经恢复，不能重复操作');
      if(p.nodes.length+batch.nodes.length>1800)throw Error('恢复后画布元素超出上限');
      const byId=new Map([...p.nodes,...batch.nodes].map(n=>[n.id,n]));
      p.nodes=[...batch.order.map(id=>byId.get(id)).filter(Boolean),...p.nodes.filter(n=>!batch.order.includes(n.id))];
      p.removedBatches=p.removedBatches.filter(x=>x.id!==batch.id);
      touchProject(p);
      return respond(res,200,{restored:batch.nodes.map(n=>nodeView(n)),revision:p.revision});
    }
    const removeNodes=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/nodes\/batch$/);
    if(removeNodes&&req.method==='DELETE'){
      const p=assertProject(removeNodes[1]),b=await readJSON(req),ids=b.ids;
      if(!Array.isArray(ids)||!ids.length||ids.length>120||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))throw Error('请选择 1 至 120 个不同的画布元素');
      const selected=new Set(ids),nodes=p.nodes.filter(n=>selected.has(n.id));
      if(nodes.length!==ids.length)throw Error('选中的画布元素已经改变，请刷新后重试');
      const batchId=crypto.randomUUID();
      p.removedBatches=[...(p.removedBatches||[]),{id:batchId,nodes,order:p.nodes.map(n=>n.id),removedAt:time()}].slice(-15);
      p.nodes=p.nodes.filter(n=>!selected.has(n.id));
      touchProject(p);
      return respond(res,200,{removed:ids,batchId,revision:p.revision});
    }
    const batchMatch=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/nodes\/batch$/);
    if(batchMatch&&req.method==='PATCH'){
      const p=assertProject(batchMatch[1]),b=await readJSON(req),changes=b.updates;
      if(!Array.isArray(changes)||changes.length<1||changes.length>120)throw Error('每次最多修改120个画布元素');
      const known=new Map(p.nodes.map(n=>[n.id,n]));const seen=new Set();
      for(const item of changes)if(!item||typeof item.id!=='string'||!known.has(item.id)||seen.has(item.id))throw Error('包含无效或重复的画布元素');else seen.add(item.id);
      for(const item of changes)if(item.groupId!==undefined&&item.groupId!==null&&!/^[a-f0-9-]{36}$/.test(item.groupId))throw Error('画布分组标识不合法');
      if(b.orderIds!==undefined&&(!Array.isArray(b.orderIds)||b.orderIds.length!==p.nodes.length||new Set(b.orderIds).size!==p.nodes.length||b.orderIds.some(id=>!known.has(id))))throw Error('图层顺序不合法');
      for(const item of changes){const node=known.get(item.id);for(const k of ['x','y','w','h'])if(item[k]!==undefined)node[k]=num(item[k],node[k],k==='w'||k==='h'?90:-200000,k==='w'||k==='h'?1200:200000);if(item.groupId!==undefined)node.groupId=item.groupId;if(item.text!==undefined&&node.kind==='note')node.text=clampText(item.text,1600);}
      if(b.front===true){const chosen=new Set(changes.map(x=>x.id));p.nodes=[...p.nodes.filter(x=>!chosen.has(x.id)),...p.nodes.filter(x=>chosen.has(x.id))]}
      if(b.back===true){const chosen=new Set(changes.map(x=>x.id));p.nodes=[...p.nodes.filter(x=>chosen.has(x.id)),...p.nodes.filter(x=>!chosen.has(x.id))]}
      if(Array.isArray(b.orderIds))p.nodes=b.orderIds.map(id=>known.get(id))
      touchProject(p);return respond(res,200,{revision:p.revision,nodes:changes.map(x=>nodeView(known.get(x.id)))});
    }
    const projectMatch=route.match(/^\/api\/projects\/([a-f0-9-]{36})(?:\/(assets|notes|viewport|messages))?$/);
    if(projectMatch){const p=assertProject(projectMatch[1]);const action=projectMatch[2];
      if(!action&&req.method==='GET')return respond(res,200,{project:projectView(p)});
      if(!action&&req.method==='PATCH'){
        const b=await readJSON(req),title=clampText(b.title,70).trim();if(!title)throw Error('项目名称不能为空');p.title=title;touchProject(p);return respond(res,200,{project:projectView(p)});
      }
      if(!action&&req.method==='DELETE'){
        if(projects.filter(x=>!x.archived).length<=1)throw Error('至少保留一个项目');p.archived=true;touchProject(p);return respond(res,200,{archived:true});
      }
      if(action==='assets'&&req.method==='POST'){
        if(p.nodes.length>=1800)throw Error('画布素材数量已达到上限');
        const b=await readJSON(req),img=imageFromDataURL(b.image),file=storeMedia(img);
        if(b.preview){try{storePreview(file,imageFromDataURL(b.preview))}catch(e){console.warn('[Hamoki] browser preview rejected:',String(e.message).slice(0,100))}}
        const node={id:crypto.randomUUID(),kind:'reference',assetFile:file,title:clampText(b.name||'参考图片',100),...posNode(b),createdAt:time(),parentNodeId:p.nodes.some(n=>n.id===b.parentNodeId)?b.parentNodeId:null};
        p.nodes.push(node);touchProject(p);return respond(res,201,{node:nodeView(node)});
      }
      if(action==='notes'&&req.method==='POST'){
        if(p.nodes.length>=1800)throw Error('画布素材数量已达到上限');
        const b=await readJSON(req),node={id:crypto.randomUUID(),kind:'note',text:clampText(b.text||'双击编辑便签',1600),...posNode({...b,w:b.w||245,h:b.h||155}),createdAt:time()};p.nodes.push(node);touchProject(p);return respond(res,201,{node});
      }
      if(action==='viewport'&&req.method==='POST'){
        const b=await readJSON(req);p.viewport={x:num(b.x,0,-500000,500000),y:num(b.y,0,-500000,500000),scale:num(b.scale,1,.18,2.8)};touchProject(p);return respond(res,200,{viewport:p.viewport});
      }
      if(action==='messages'&&req.method==='POST'){
        const b=await readJSON(req),content=clampText(b.content,4000).trim();if(!content)throw Error('消息不能为空');
        const message={id:crypto.randomUUID(),role:'user',content,createdAt:time()};p.messages.push(message);p.messages=p.messages.slice(-400);touchProject(p);return respond(res,201,{message});
      }
    }
    const nodeMatch=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/nodes\/([a-f0-9-]{36})$/);
    if(nodeMatch){const p=assertProject(nodeMatch[1]),n=p.nodes.find(n=>n.id===nodeMatch[2]);if(!n)return fail(res,404,'画布元素不存在');
      if(req.method==='PATCH'){const b=await readJSON(req);for(const k of ['x','y','w','h'])if(b[k]!==undefined)n[k]=num(b[k],n[k],k==='w'||k==='h'?90:-200000,k==='w'||k==='h'?1200:200000);if(n.kind==='note'&&b.text!==undefined)n.text=clampText(b.text,1600);if(b.title!==undefined)n.title=clampText(b.title,100);touchProject(p);return respond(res,200,{node:nodeView(n)});}
      if(req.method==='DELETE'){p.nodes=p.nodes.filter(a=>a.id!==n.id);touchProject(p);return respond(res,200,{removed:true});}
    }
    // Unsaved provider diagnostics: scoped to this authenticated workspace, never mutate or encrypt provider state.
    if((route==='/api/providers/draft/check'||route==='/api/providers/draft/models')&&req.method==='POST'){
      if(DEMO_MODE)throw Error('共享演示站不允许填写或测试真实密钥');
      const b=await readJSON(req),saved=b.savedId?provider(b.savedId):null;
      if(b.savedId&&!saved)throw Error('当前已保存的中转站不存在');
      const url=trim(b.url,600),mode=b.mode,apiKey=trim(b.apiKey,1200)||(saved?.apiKey||'');
      if(saved&&!trim(b.apiKey,1200)&&url!==saved.url)throw Error('基础 API 地址已经改变：为保护旧 Key，请输入本次测试使用的 Key');
      if(!url||!apiKey)throw Error('请先填写 API 地址和 Key');
      if(!['gemini','openai','grsai'].includes(mode))throw Error('请先选择接口协议');
      const validated=await checkedURL(url);if(validated.u.search)throw Error('基础地址不能包含查询参数');
      const cap=['image','vision','text'].includes(b.capability)?b.capability:'image';
      const settings=b.baseOnly?{}:(b.capabilities?.[cap]||{});
      const c={enabled:true,inheritBaseUrl:settings.inheritBaseUrl!==false,inheritApiKey:settings.inheritApiKey!==false,inheritProtocol:settings.inheritProtocol!==false,
        baseUrl:trim(settings.baseUrl,600),apiKey:trim(settings.apiKey,1200),mode:settings.mode||mode,defaultModel:trim(settings.defaultModel,150)};
      const temporary={id:'draft',name:'临时测试',url,apiKey,mode,imageMode:mode==='gemini'?'gemini':(['chat','responses','images'].includes(b.imageMode)?b.imageMode:'images'),
        imageModel:trim(b.imageModel,150)||'test-image-model',visionModel:trim(b.visionModel,150)||'test-vision-model',capabilities:{[cap]:c}};
      if(saved&&c.inheritApiKey===false&&!c.apiKey){const previous=normalizedCapability(saved,cap);if(c.inheritBaseUrl===false&&c.baseUrl!==previous.baseUrl)throw Error('独立 API 地址已修改：请填写独立 Key 再测试');c.apiKey=previous.apiKey;}
      const effective=effectiveProvider(temporary,cap);emptyProvider(effective);
      const begin=Date.now();
      try{
        const models=await listModels(effective);
        return respond(res,200,{reachable:true,models,latencyMs:Date.now()-begin,notice:'模型列表可用；这不代表已经实测生图。临时配置尚未保存。'});
      }catch(e){
        diag({source:'upstream',action:'check_models',path:'/api/providers/draft/check',method:'POST',status:e.upstreamStatus||undefined,message:e.message,durationMs:Date.now()-begin});
        return respond(res,200,{reachable:false,models:[],latencyMs:Date.now()-begin,error:String(e.message).slice(0,250),
          notice:'无法通过 /models 判断连接是否可用。部分服务商不开放模型列表；临时配置尚未保存。'});
      }
    }
    if(route==='/api/providers'&&req.method==='GET')return respond(res,200,{providers:state.providers.map(safe),activeId:state.activeId});
    if(route==='/api/providers'&&req.method==='POST'){
      const b=await readJSON(req);if(state.providers.length>=30)throw Error('最多 30 个服务商');const name=trim(b.name,60),mode=b.mode,base=trim(b.url,600);if(!name||!base)throw Error('请填写服务商名称与地址');if(!['openai','gemini','grsai'].includes(mode))throw Error('不支持的接口类型');if((await checkedURL(base)).u.search)throw Error('基础地址不要包含查询参数');
      const p={id:crypto.randomUUID(),name,mode,url:base,imageMode:mode==='gemini'?'gemini':mode==='grsai'?'grsai':['images','chat','responses'].includes(b.imageMode)?b.imageMode:'images',imageModel:b.imageModel?assertModel(b.imageModel):'',visionModel:b.visionModel?assertModel(b.visionModel):'',responseModel:trim(b.responseModel,150),apiKey:trim(b.apiKey,1200)};
      await updateCapabilities(p,b.capabilities);state.providers.push(p);if(!state.activeId)state.activeId=p.id;encrypt(state);return respond(res,201,{provider:safe(p),activeId:state.activeId});
    }
    const pm=route.match(/^\/api\/providers\/([a-f0-9-]{36})(?:\/(activate|check|capabilities|probe))?$/);
    if(pm){const p=provider(pm[1]);if(!p)return fail(res,404,'服务商不存在');
      if(req.method==='POST'&&pm[2]==='activate'){state.activeId=p.id;encrypt(state);return respond(res,200,{activeId:p.id})}
      if(req.method==='GET'&&pm[2]==='capabilities')return respond(res,200,capabilities(p));
      if(req.method==='POST'&&pm[2]==='probe'){
        if(DEMO_MODE)return fail(res,403,'演示站禁止真实 API 测试');
        const b=await readJSON(req);if(b.confirmCost!==true)throw Error('必须确认能力测试会扣费');
        const effective=effectiveProvider(p,b.kind==='reverse'?'vision':'image');emptyProvider(effective);const model=assertModel(b.model||(b.kind==='reverse'?effective.visionModel:effective.imageModel));
        if(!['reverse','generate','edit'].includes(b.kind))throw Error('未知的实测类型');
        const start=Date.now();try{let previewUrl=null,summary='';
          const sampleBytes=fs.readFileSync(path.join(ROOT,'assets/hamoki-avatar-128.webp'));const sample={mime:'image/webp',bytes:sampleBytes,base64:sampleBytes.toString('base64')};
          if(b.kind==='reverse')summary=(await reverse(effective,sample,model,'detailed')).slice(0,500);
          else {const input=b.kind==='edit'?[sample]:[]; const output=await generate(effective,{model,prompt:b.kind==='edit'?'把参考图片变成极简线条插画，保持主体':'画一颗绿色的小星星，白色背景',ratio:'1:1',resolution:'1K',quality:'low'},input,null);const file=storeMedia(output);previewUrl=BASE+'/api/media/'+file;summary='上游已返回有效图片（请检查预览）'}
          const field=b.kind==='reverse'?'imageReverse':b.kind==='edit'?'referenceImage':'textToImage';recordCapability(p,field,true,model,{durationMs:Date.now()-start});return respond(res,200,{success:true,kind:b.kind,model,latencyMs:Date.now()-start,previewUrl,summary});
        }catch(e){diag({source:'upstream',action:'probe_'+b.kind,path:'/api/providers/:id/probe',method:'POST',model,status:e.upstreamStatus||undefined,message:e.message});const field=b.kind==='reverse'?'imageReverse':b.kind==='edit'?'referenceImage':'textToImage';recordCapability(p,field,false,model,{error:String(e.message).slice(0,250),durationMs:Date.now()-start});return respond(res,200,{success:false,kind:b.kind,model,latencyMs:Date.now()-start,error:String(e.message).slice(0,320)})}
      }
            if(req.method==='DELETE'&&!pm[2]){if(jobs.some(j=>['running','queued'].includes(j.status)&&j.providerId===p.id))throw Error('此站仍有运行或排队任务，请先完成或取消');state.providers=state.providers.filter(x=>x.id!==p.id);if(state.activeId===p.id)state.activeId=state.providers[0]?.id||null;encrypt(state);return respond(res,200,{activeId:state.activeId})}
      if(req.method==='PUT'&&!pm[2]){const b=await readJSON(req),name=trim(b.name,60),base=trim(b.url,600);if(!name||!base)throw Error('请填写服务商名称与地址');if(!['openai','gemini','grsai'].includes(b.mode))throw Error('接口类型不支持');if(jobs.some(j=>['queued','running'].includes(j.status)&&j.providerId===p.id))throw Error('当前中转站有未完成任务，请先等待或取消，之后再修改地址与密钥');if((await checkedURL(base)).u.search)throw Error('基础地址不要包含查询参数');Object.assign(p,{name,url:base,mode:b.mode,imageMode:b.mode==='gemini'?'gemini':b.mode==='grsai'?'grsai':['images','chat','responses'].includes(b.imageMode)?b.imageMode:'images',imageModel:b.imageModel?assertModel(b.imageModel):'',visionModel:b.visionModel?assertModel(b.visionModel):'',responseModel:trim(b.responseModel,150)});if(b.apiKey)p.apiKey=trim(b.apiKey,1200);if(b.clearKey)p.apiKey='';await updateCapabilities(p,b.capabilities);encrypt(state);return respond(res,200,{provider:safe(p)})}
    }
         if(req.method==='POST'&&(route==='/api/chat'||route==='/api/chat/stream')){
      if(DEMO_MODE)return fail(res,403,'演示站不允许调用付费模型');
      const streaming=route.endsWith('/stream');
      const b=await readJSON(req),p=effectiveProvider(provider(b.providerId||state.activeId),'text');
      const model=assertModel(b.model||normalizedCapability(p,'text').defaultModel);
      const prompt=clampText(b.prompt,8000).trim();if(!prompt)throw Error('请先输入文字消息');
      const target=b.projectId?assertProject(b.projectId):defaultProject();if(!target)throw Error('没有可用项目');
      if(activeChats.has(target.id))return fail(res,409,'此项目已有正在回复的文字任务，请等待或停止后再试');
      const history=target.messages.filter(x=>x.capability==='text'&&['user','assistant'].includes(x.role))
        .slice(-24).map(x=>({role:x.role,content:clampText(x.content,3000)}));
      const started=Date.now();activeChats.add(target.id);
      const saveAnswer=answer=>{
        target.messages.push({id:crypto.randomUUID(),role:'user',content:prompt,createdAt:time(),capability:'text'});
        target.messages.push({id:crypto.randomUUID(),role:'assistant',content:answer,createdAt:time(),providerId:p.id,model,capability:'text'});
        target.messages=target.messages.slice(-400);touchProject(target);
      };
      try{
        if(!streaming){
          const answer=await options.limiter.run(()=>generateText(p,{model,prompt,history}));
          saveAnswer(answer);return respond(res,200,{answer,model,providerName:p.name});
        }
        const controller=new AbortController();
        res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff','Connection':'keep-alive'});
        const event=(type,payload)=>{if(!res.destroyed&&!res.writableEnded)res.write('event: '+type+'\ndata: '+JSON.stringify(payload)+'\n\n')};
        let completed=false;
        const disconnected=()=>{if(!completed)controller.abort()};
        res.on('close',disconnected);
        event('start',{model,providerName:p.name,historyTurns:history.length});
        const answer=await options.limiter.run(()=>streamText(p,{model,prompt,history},delta=>event('delta',{text:delta}),controller.signal));
        completed=true;saveAnswer(answer);
        event('done',{saved:true,model,providerName:p.name});
        res.end();return;
      }catch(e){
        diag({source:'upstream',action:streaming?'text_chat_stream':'text_chat',path:route,method:'POST',model,status:e.upstreamStatus||undefined,message:e.message,durationMs:Date.now()-started});
        if(streaming&&res.headersSent){if(!res.destroyed){res.write('event: error\ndata: '+JSON.stringify({error:String(e.message||'文字模型请求失败').slice(0,350)})+'\n\n');res.end()}return}
        throw e;
      }finally{activeChats.delete(target.id)}
    }
    if(req.method==='GET'&&route==='/api/models'){const cap=CAPABILITIES.includes(url.searchParams.get('capability'))?url.searchParams.get('capability'):'image';const p=effectiveProvider(provider(url.searchParams.get('providerId')||state.activeId),cap);emptyProvider(p);return respond(res,200,{models:await listModels(p)})}
    if(req.method==='POST'&&route==='/api/reverse'){const b=await readJSON(req),p=effectiveProvider(provider(b.providerId||state.activeId),'vision');emptyProvider(p);const pic=imageFromDataURL(b.image),model=assertModel(b.model||p.visionModel);const start=Date.now(),prompt=await reverse(p,pic,model,b.kind);recordCapability(p,'imageReverse',true,model,{durationMs:Date.now()-start});return respond(res,200,{prompt,providerName:p.name,model})}
    if(req.method==='POST'&&route==='/api/jobs'){const b=await readJSON(req);const result=submit(b);return respond(res,201,result)}
    if(req.method==='GET'&&route==='/api/jobs')return respond(res,200,{paused,running,concurrency:CONCURRENCY,jobs:jobs.filter(j=>!url.searchParams.get('projectId')||j.projectId===url.searchParams.get('projectId')).slice(0,300).map(publicJob)});
    if(req.method==='POST'&&route==='/api/queue'){const b=await readJSON(req);if(!['pause','resume'].includes(b.action))throw Error('无效队列操作');paused=b.action==='pause';saveJobs();if(!paused)schedule();return respond(res,200,{paused})}
    const jm=route.match(/^\/api\/jobs\/([a-f0-9-]{36})\/(cancel|retry)$/);
    if(jm&&req.method==='POST'){const j=jobs.find(x=>x.id===jm[1]);if(!j)return fail(res,404,'任务不存在');if(jm[2]==='cancel'){if(!['queued','running','interrupted'].includes(j.status))throw Error('任务当前不可取消');j.status='cancelled';j.updatedAt=time();controllers.get(j.id)?.abort();saveJobs();return respond(res,200,{job:publicJob(j)})}
      if(!['failed','cancelled','interrupted'].includes(j.status))throw Error('此任务不需要重试');const request=await readJSON(req);const newProviderId=request.providerId||j.providerId,newModel=assertModel(request.model||j.model);const selected=effectiveProvider(provider(newProviderId),j.capability||'image');emptyProvider(selected);if(j.maskMedia&&(selected.mode!=='openai'||(selected.imageMode||'images')!=='images'))throw Error('本次选中的模型接口不支持蒙版，已阻止任务提交');if(j.transparentBg&&(selected.mode!=='openai'||(selected.imageMode||'images')!=='images'))throw Error('本次选中的模型接口不支持透明背景，已阻止任务提交');const again={...j,upstreamId:(newProviderId===j.providerId&&newModel===j.model)?j.upstreamId:null,progress:0,providerId:newProviderId,providerName:selected.name,model:newModel,id:crypto.randomUUID(),createdAt:time(),updatedAt:time(),startedAt:null,resultId:null,error:'',status:'queued',attempts:0,retryOf:j.id};jobs.unshift(again);saveJobs();schedule();return respond(res,201,{job:publicJob(again)});
    }
    if(req.method==='GET'&&route==='/api/history'){const q=trim(url.searchParams.get('q'),150).toLowerCase(),favorites=url.searchParams.get('favorite')==='1';let listed=history.filter(h=>(!favorites||h.favorite)&&(!url.searchParams.get('projectId')||h.projectId===url.searchParams.get('projectId')));if(q)listed=listed.filter(h=>[h.prompt,h.model,h.providerName].some(s=>(s||'').toLowerCase().includes(q)));return respond(res,200,{history:listed.slice(0,1500).map(publicHistory),total:listed.length})}
    const fm=route.match(/^\/api\/history\/([a-f0-9-]{36})\/favorite$/);if(fm&&req.method==='POST'){const h=history.find(x=>x.id===fm[1]);if(!h)return fail(res,404,'图片不存在');h.favorite=!!(await readJSON(req)).favorite;saveHistory();return respond(res,200,{image:publicHistory(h)})}
    const dl=route.match(/^\/api\/download\/([a-f0-9-]{36})$/);if(dl&&req.method==='GET'){const h=history.find(x=>x.id===dl[1]);if(!h)return fail(res,404,'图片不存在');const img=fetchMedia(h.file);res.writeHead(200,{'Content-Type':img.mime,'Content-Disposition':`attachment; filename="hamoki-${h.id}.${extension(img.mime)}"`,'Cache-Control':'no-store'});return res.end(img.bytes)}
    if(route==='/api/export'&&req.method==='GET'){const ids=(url.searchParams.get('ids')||'').split(',').filter(Boolean).slice(0,40);const selected=ids.length?history.filter(x=>ids.includes(x.id)):history.slice(0,40);if(!selected.length)return fail(res,400,'没有可导出的图片');const files=selected.map((h,i)=>({name:'hamoki-'+String(i+1).padStart(3,'0')+'-'+h.id.slice(0,8)+'.'+h.file.split('.').pop(),bytes:fs.readFileSync(mediaPath(h.file))}));if(files.reduce((n,f)=>n+f.bytes.length,0)>180*1024*1024)throw Error('批量图片总大小超过 180MB，请选少量图片分批下载');const zip=pack(files);res.writeHead(200,{'Content-Type':'application/zip','Content-Length':zip.length,'Content-Disposition':'attachment; filename="hamoki-images.zip"','Cache-Control':'no-store'});return res.end(zip)}
    const previews=route.match(/^\/api\/previews\/([a-f0-9-]{36}\.(?:png|jpg|webp))$/);
    if(previews&&req.method==='GET'){const name=previews[1],w=previewPath(name,'webp'),j=previewPath(name,'jpg');const file=fs.existsSync(w)?w:fs.existsSync(j)?j:null;if(!file)return fail(res,404,'缩略图还没有生成');return sendMedia(req,res,file,file.endsWith('.webp')?'image/webp':'image/jpeg')}
    const previewCreate=route.match(/^\/api\/media\/([a-f0-9-]{36}\.(?:png|jpg|webp))\/preview$/);
    if(previewCreate&&req.method==='POST'){const b=await readJSON(req),data=imageFromDataURL(b.preview);return respond(res,201,{saved:storePreview(previewCreate[1],data)})}
    const media=route.match(/^\/api\/media\/([a-f0-9-]{36}\.(?:png|jpg|webp))$/);if(media&&req.method==='GET'){const name=media[1],filename=mediaPath(name);if(!fs.existsSync(filename))return fail(res,404,'图片不存在');const mime=({'png':'image/png','jpg':'image/jpeg','webp':'image/webp'})[name.split('.').pop()];return sendMedia(req,res,filename,mime)}
    return fail(res,404,'接口不存在');
  }catch(e){
    const msg=String(e?.message||'服务错误').slice(0,450);
    // Most 404s are normal navigation/missing thumbnails; record actionable failures only.
    if(!(e.status===404||route.startsWith('/api/previews/')))diag({source:e.upstreamStatus?'upstream':'backend',action:'api_request',method:req.method,path:route,status:e.upstreamStatus||e.status||400,message:msg});
    if(!res.headersSent){const code=[400,401,403,404,413,415].includes(e.status)?e.status:400;return fail(res,code,msg)}console.error('[Hamoki]',route,msg);
  }
}

return {handler,storageUsage};
};


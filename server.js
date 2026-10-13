/** Hamoki Studio V0.6.1 browser-first low-resource AI workspace. */
'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {checkedURL,imageFromDataURL,guessMime,extension,reverse,generate,listModels}=require('./lib/upstream');
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
const MAX_QUEUED=96;let retryTimer=null;
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
if(DEMO_MODE && !state.providers.length){
 state.providers=[{id:crypto.randomUUID(),name:'GPT Image · 测试模型',url:'https://example.invalid/v1',mode:'openai',imageMode:'images',imageModel:'gpt-image-1.5',visionModel:'gpt-4o-mini',apiKey:''},{id:crypto.randomUUID(),name:'Nano Banana · 测试模型',url:'https://example.invalid/v1beta',mode:'gemini',imageMode:'gemini',imageModel:'gemini-2.5-flash-image',visionModel:'gemini-2.5-flash',apiKey:''}];state.activeId=state.providers[0].id;encrypt(state);
}
let persisted=readData(jobsFile,{jobs:[],paused:false});
let jobs=Array.isArray(persisted.jobs)?persisted.jobs:[],paused=!!persisted.paused;
if(jobs.some(j=>['running','queued'].includes(j.status))){paused=true;for(const j of jobs)if(j.status==='running')j.status='interrupted'}
const sessions=new Map(),attempts=new Map(),controllers=new Map(),providerBusy=new Set();let running=0;
const time=()=>new Date().toISOString(),trim=(v,n=200)=>String(v||'').trim().slice(0,n);
// Web-first project store. All canvas coordinates are expressed in world pixels.
let projectDB=readData(projectsFile,{projects:[]});
let projects=Array.isArray(projectDB.projects)?projectDB.projects:[];
const num=(value,fallback=0,min=-200000,max=200000)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
const clampText=(value,max=10000)=>typeof value==='string'?value.slice(0,max):'';
function makeProject(title){return {id:crypto.randomUUID(),title:clampText(title||'未命名项目',70),createdAt:time(),updatedAt:time(),revision:0,archived:false,viewport:{x:220,y:130,scale:1},nodes:[],messages:[]}}
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
function projectView(p){return {...p,nodes:p.nodes.map(nodeView)}}
function touchProject(p){p.revision=(p.revision||0)+1;p.updatedAt=time();saveProjects()}
function appendGeneratedNode(h,j){const p=project(j.projectId||defaultProject()?.id);if(!p)return;
 const parent=p.nodes.find(n=>n.historyId===h.parentId)||p.nodes.find(n=>n.id===j.sourceNodeId);
 const relatives=p.nodes.filter(n=>n.parentNodeId===(parent?.id||'!'));
 const i=num(j.batchIndex,0,0,15);
 const x=parent?parent.x+parent.w+140:num(j.canvasX,150)+ (i%4)*330;
 const y=parent?parent.y+(relatives.length*320):num(j.canvasY,170)+Math.floor(i/4)*355;
 p.nodes.push({id:crypto.randomUUID(),kind:'generated',historyId:h.id,parentNodeId:parent?.id||null,x,y,w:288,h:288,createdAt:time()});
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
 const safeProject={title:p.title,viewport:p.viewport,nodes:p.nodes,messages:p.messages};
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
 if(data.project.viewport){const v=data.project.viewport;proj.viewport={x:num(v.x,220,-500000,500000),y:num(v.y,130,-500000,500000),scale:num(v.scale,1,.18,2.8)}}
 // After all structure checks pass, persist media and remap every entity identifier.
 const mediaIds=new Map();for(const [old,img] of buffers)mediaIds.set(old,storeMedia(img));
 const importedHistory=data.history.map(h=>({id:oldHistId.get(h.id),file:mediaIds.get(h.file),projectId:proj.id,prompt:clampText(h.prompt,10000),editInstruction:clampText(h.editInstruction,4000),model:trim(h.model,150),providerName:trim(h.providerName,100),ratio:trim(h.ratio,20),resolution:trim(h.resolution,10),quality:trim(h.quality,10),transparentBg:!!h.transparentBg,createdAt:typeof h.createdAt==='string'?h.createdAt:time(),parentId:oldHistId.get(h.parentId)||null,favorite:!!h.favorite,imported:true}));
 proj.nodes=data.project.nodes.map(n=>{
  const next={id:oldNodeId.get(n.id),kind:n.kind,...posNode(n),createdAt:typeof n.createdAt==='string'?n.createdAt:time(),parentNodeId:oldNodeId.get(n.parentNodeId)||null};
  if(n.groupId){if(!oldGroupId.has(n.groupId))oldGroupId.set(n.groupId,crypto.randomUUID());next.groupId=oldGroupId.get(n.groupId)}
  if(n.kind==='note')next.text=clampText(n.text,1600);
  if(n.kind==='reference'){next.assetFile=mediaIds.get(n.assetFile);next.title=clampText(n.title,100)}
  if(n.kind==='generated')next.historyId=oldHistId.get(n.historyId);
  return next;
 });
 proj.messages=data.project.messages.map(m=>({id:crypto.randomUUID(),role:['user','result','assistant'].includes(m.role)?m.role:'user',content:clampText(m.content,4000),createdAt:typeof m.createdAt==='string'?m.createdAt:time(),imageId:oldHistId.get(m.imageId)||null,sourceId:oldHistId.get(m.sourceId)||null,referenceRoles:Array.isArray(m.referenceRoles)?m.referenceRoles.slice(0,8).filter(x=>oldNodeId.has(x.nodeId)).map(x=>({nodeId:oldNodeId.get(x.nodeId),role:REFERENCE_ROLES[x.role]?x.role:'general'})):[]}));
 projects.unshift(proj);history.unshift(...importedHistory);saveProjects();saveHistory();return projectView(proj);
}


function saveJobs(){atomic(jobsFile,JSON.stringify({jobs:jobs.slice(0,1000),paused}))}
function saveHistory(){atomic(historyFile,JSON.stringify(history.slice(0,2500)))}
saveJobs();
const respond=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj))};
const fail=(res,code,msg)=>respond(res,code,{error:msg});
function readJSON(req){return new Promise((resolve,reject)=>{const parts=[];let total=0,tooBig=false;req.on('data',b=>{total+=b.length;if(total>BODY_LIMIT){tooBig=true;return}parts.push(b)});req.on('end',()=>{if(tooBig)return reject(Object.assign(Error('请求超过 55MB 限制'),{status:413}));try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')||'{}'))}catch{reject(Object.assign(Error('JSON 请求格式不正确'),{status:400}))}});req.on('error',reject)})}
function cookie(req){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('hs_session='))?.slice(11)||''}
function auth(req){const token=cookie(req),expire=sessions.get(token);return !!(token&&expire&&expire>Date.now())}
function provider(id){return state.providers.find(p=>p.id===id)}
function safe(p){return {id:p.id,name:p.name,url:p.url,mode:p.mode,imageMode:p.imageMode||'images',imageModel:p.imageModel,visionModel:p.visionModel,responseModel:p.responseModel||'',hasKey:!!p.apiKey,checks:p.checks||{},verifiedCapabilities:p.verifiedCapabilities||{}}}
function capabilities(p){const images=p.mode==='openai'&&p.imageMode==='images';return {protocol:p.imageMode||'images',support:{textToImage:'available-by-protocol',referenceImage:'available-by-protocol',mask:images?'model-dependent':'unsupported',transparentBackground:images?'model-dependent':'unsupported',imageReverse:'depends-on-vision-model',aspectRatio:'model-dependent',resolution:'model-dependent'},verified:p.verifiedCapabilities||{},checks:p.checks||{},note:'协议能力仅是推测；实际支持情况以显式付费测试及成功生图任务为准。'}}
function recordCapability(p,feature,success,model,detail={}){if(DEMO_MODE)return;p.verifiedCapabilities ||= {};p.verifiedCapabilities[feature]={success:!!success,model,checkedAt:time(),...detail};encrypt(state)}
function assertModel(v){const t=trim(v,150);if(!t||!/^[-\w.:/]+$/.test(t))throw Error('模型 ID 不合法');return t}
function mediaPath(id){if(!/^[a-f0-9-]{36}\.(?:png|jpg|webp)$/.test(id))throw Error('媒体文件名不合法');return path.join(MEDIA_DIR,id)}
function previewPath(id,format='webp'){mediaPath(id);return path.join(PREVIEW_DIR,id+'.'+format)}
function folderUsage(folder){let bytes=0,files=0;for(const entry of fs.readdirSync(folder,{withFileTypes:true})){if(!entry.isFile())continue;const stat=fs.statSync(path.join(folder,entry.name));bytes+=stat.size;files++}return {bytes,files}}
let usageCache=null,usageChecked=0;
function storageUsage(force=false){if(!force&&usageCache&&Date.now()-usageChecked<30000)return usageCache;const original=folderUsage(MEDIA_DIR),previews=folderUsage(PREVIEW_DIR);usageCache={originalBytes:original.bytes,previewBytes:previews.bytes,totalBytes:original.bytes+previews.bytes,originalCount:original.files,previewCount:previews.files,quotaBytes:MEDIA_QUOTA_BYTES};usageChecked=Date.now();return usageCache}
function checkSpace(size){if(storageUsage().totalBytes+size>MEDIA_QUOTA_BYTES)throw Object.assign(Error('Hamoki 图片存储达到设置的空间预算，请先备份作品或调整 MEDIA_QUOTA_GB；不会自动删除原图'),{status:413})}
function storeMedia(img){checkSpace(img.bytes.length);const name=crypto.randomUUID()+'.'+extension(img.mime);fs.writeFileSync(mediaPath(name),img.bytes,{flag:'wx',mode:0o600});usageCache=null;return name}
function storePreview(name,pic){mediaPath(name);if(!fs.existsSync(mediaPath(name)))throw Object.assign(Error('原图不存在'),{status:404});if(!['image/webp','image/jpeg'].includes(pic.mime)||pic.bytes.length>512*1024)throw Object.assign(Error('缩略图必须为不超过512KB的 WebP 或 JPEG'),{status:413});const format=pic.mime==='image/webp'?'webp':'jpg';if(fs.existsSync(previewPath(name,'webp'))||fs.existsSync(previewPath(name,'jpg')))return false;checkSpace(pic.bytes.length);try{fs.writeFileSync(previewPath(name,format),pic.bytes,{flag:'wx',mode:0o600});usageCache=null;return true}catch(e){if(e.code==='EEXIST')return false;throw e}}
function fetchMedia(name){const bytes=fs.readFileSync(mediaPath(name));return {mime:guessMime(bytes),bytes}}
function sendMedia(req,res,filename,mime,cache='private, max-age=604800'){const stat=fs.statSync(filename);const tag='"'+stat.size.toString(16)+'-'+Math.round(stat.mtimeMs).toString(16)+'"';if(req.headers['if-none-match']===tag){res.writeHead(304,{'ETag':tag,'Cache-Control':cache});return res.end()}res.writeHead(200,{'Content-Type':mime,'Content-Length':stat.size,'Cache-Control':cache,'ETag':tag,'X-Content-Type-Options':'nosniff'});const stream=fs.createReadStream(filename);stream.on('error',e=>{console.error('[Hamoki media stream]',e.code||'stream');res.destroy(e)});return stream.pipe(res)}
function publicHistory(h){return {...h,url:BASE+'/api/media/'+h.file,previewUrl:BASE+'/api/previews/'+h.file};}
function publicJob(j){const {referenceMedia,maskMedia,maskSourceMedia,roleHints,...exposed}=j;return {...exposed,referenceRoles:roleHints||[]};}
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
function jobStatusOk(j,status){if(j.status==='cancelled')return false;j.status=status;j.updatedAt=time();saveJobs();if(status==='failed'){const p=project(j.projectId||defaultProject()?.id);if(p){p.messages.push({id:crypto.randomUUID(),role:'error',content:'生成失败（'+j.model+'）：'+(j.error||'未知错误'),createdAt:time(),groupId:j.groupId});p.messages=p.messages.slice(-400);touchProject(p)}}return true}
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
async function execute(job){const abort=new AbortController();controllers.set(job.id,abort);const t0=Date.now();try{
  const p=provider(job.providerId);emptyProvider(p);
  const media=[];if(job.sourceId){const original=history.find(x=>x.id===job.sourceId);if(!original)throw Error('源图片已不存在');media.push(fetchMedia(original.file))}
  for(const f of job.referenceMedia||[])media.push(fetchMedia(f));
  const mask=job.maskMedia?fetchMedia(job.maskMedia):null;if(mask&&job.maskSourceMedia){const override=fetchMedia(job.maskSourceMedia);if(override.mime!=='image/png'||JSON.stringify(pngDimensions(override.bytes))!==JSON.stringify(pngDimensions(mask.bytes)))throw Error('局部重绘：PNG 源图与蒙版尺寸不一致');if(!media.length)throw Error('局部重绘缺少源图');media[0]=override}
  if(mask&&!(p.mode==='openai'&&(p.imageMode||'images')==='images'))throw Error('当前接口不支持蒙版局部重绘，请使用 OpenAI 图片接口');
  const output=DEMO_MODE ? {mime:'image/webp',bytes:fs.readFileSync(path.join(ROOT,'assets/hamoki-avatar-128.webp'))} : await generate(p,job,media,mask,abort.signal);
  recordCapability(p,mask?'mask':job.transparentBg?'transparentBackground':media.length?'referenceImage':'textToImage',true,job.model,{ratio:job.ratio,resolution:job.resolution,durationMs:Date.now()-t0});
  if(job.status==='cancelled')return;
  const file=storeMedia(output),id=crypto.randomUUID();const entry={id,file,createdAt:time(),projectId:job.projectId||defaultProject()?.id,providerId:job.providerId,providerName:job.providerName,model:job.model,prompt:job.prompt,ratio:job.ratio,resolution:job.resolution,parentId:job.sourceId||null,groupId:job.groupId||null,referenceMedia:job.referenceMedia||[],masked:!!mask,transparentBg:!!job.transparentBg,editInstruction:job.editInstruction||'',roleHints:job.roleHints||[],jobId:job.id,favorite:false,durationMs:Date.now()-t0};
  history.unshift(entry);saveHistory();appendGeneratedNode(entry,job);job.resultId=id;jobStatusOk(job,'done');
}catch(e){if(job.status==='cancelled')return;job.error=String(e?.message||'请求失败').slice(0,380);job.durationMs=Date.now()-t0;
  if(e.upstreamStatus===429&&job.attempts<3){
    const delay=Math.min(30000,e.retryAfterMs||Math.round(1600*2**(job.attempts-1)+Math.random()*600));
    job.status='queued';job.nextRunAt=Date.now()+delay;job.error+='（上游429限流，'+Math.ceil(delay/1000)+' 秒后重试，最多3次）';job.updatedAt=time();saveJobs();schedule();
  }else jobStatusOk(job,'failed');
}finally{controllers.delete(job.id)}}
function makeJob(b,store,providerId,model,groupId){const p=provider(providerId);if(!p)throw Error('服务商不存在');emptyProvider(p);return {id:crypto.randomUUID(),groupId,providerId,providerName:p.name,model:assertModel(model||p.imageModel),prompt:b.prompt,editInstruction:b.editInstruction||'',roleHints:store.roleHints||[],transparentBg:!!b.transparentBg,ratio:b.ratio,resolution:b.resolution,quality:b.quality,sourceId:b.sourceId||null,referenceMedia:store.input,maskMedia:store.mask,maskSourceMedia:store.maskSource,projectId:b.projectId,sourceNodeId:b.sourceNodeId||null,canvasX:b.canvasX,canvasY:b.canvasY,batchIndex:b.batchIndex||0,createdAt:time(),updatedAt:time(),status:'queued',attempts:0,resultId:null,error:'',retryOf:b.retryOf||null}}
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
 const count=Number(b.count||1);
 if(!Number.isInteger(count)||count<1||count>32)throw Error('单次最多 32 张，建议先试1张');
 const targets=Array.isArray(b.targets)&&b.targets.length?b.targets:[{providerId:b.providerId||state.activeId,model:b.model}];
 if(targets.length>4||targets.length*count>48)throw Error('每批最多4个模型、48个任务');
 if(jobs.filter(j=>['queued','running'].includes(j.status)).length+targets.length*count>MAX_QUEUED)throw Error('待处理任务最多 '+MAX_QUEUED+' 个，请稍后再提交');
 const ratio=trim(b.ratio||'1:1',10),resolution=trim(b.resolution||'1K',5),quality=trim(b.quality||'auto',8);
 if(!['1:1','3:2','2:3','16:9','9:16','4:3','3:4'].includes(ratio))throw Error('比例不支持');
 if(!['1K','2K','4K'].includes(resolution))throw Error('分辨率不支持');
 if(!['auto','low','medium','high'].includes(quality))throw Error('画质参数不支持');
 const candidate=b.sourceId||images.find(n=>n.historyId)?.historyId;
 const source=candidate?history.find(h=>h.id===candidate&&h.projectId===targetProject.id):null;
 if(candidate&&!source)throw Error('找不到当前项目中的源图片');
 if(b.mask&&!source)throw Error('局部蒙版必须先选择一张已生成图片');
 if(b.mask&&targets.some(t=>{const p=provider(t.providerId);return !p||p.mode!=='openai'||(p.imageMode||'images')!=='images'}))throw Error('局部蒙版需要支持 OpenAI Images Edits 的接口');
 const transparentBg=!!b.transparentBg;
 if(transparentBg&&targets.some(t=>{const p=provider(t.providerId);return !p||p.mode!=='openai'||(p.imageMode||'images')!=='images'}))throw Error('透明背景当前仅允许 OpenAI Images 模式（模型仍需支持透明输出）');
 const editMode=!!source&&b.editMode!=='new';
 const prompt=editMode?('根据第一张参考原图精确编辑。除本轮明确要求改变的内容外，保持主体身份、脸部、服装结构、姿势、画面构图和风格一致。\n历史创作描述：'+source.prompt.slice(0,6500)+'\n本轮修改要求：'+instruction):instruction;
 return {prompt,editInstruction:instruction,refs,referenceNodes:images,count,targets,ratio,resolution,quality,transparentBg,sourceId:source?.id||null,sourceNodeId,projectId:targetProject.id,canvasX:num(b.canvasX,180),canvasY:num(b.canvasY,170),mask:b.mask||null,maskSourceImage:b.maskSourceImage||null};
}
function submit(b){
 const valid=validateCreation(b);
 for(const t of valid.targets){const p=provider(t.providerId);emptyProvider(p);assertModel(t.model||p.imageModel)}
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
function staticFile(res,pathname){if(pathname==='/')pathname='/index.html';if(!/^\/(?:index\.html|assets\/[a-zA-Z0-9-]+\.(?:css|js|png|webp|ico))$/.test(pathname))return fail(res,404,'资源不存在');fs.readFile(path.join(ROOT,pathname),(e,buf)=>{if(e)return fail(res,404,'资源不存在');const ext=path.extname(pathname);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'})[ext],'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",'Cache-Control':'no-cache'});res.end(buf)})}
async function handler(req,res){if(ALLOWED_HOST&&String(req.headers.host||'').split(':')[0].toLowerCase()!==ALLOWED_HOST)return fail(res,421,'请求域名不符合独立安全域名配置');const url=new URL(req.url,'http://localhost');
  if(BASE && url.pathname===BASE){res.writeHead(308,{Location:BASE+'/'});return res.end()}
  if(BASE && !url.pathname.startsWith(BASE+'/'))return fail(res,404,'项目路径不存在');
  const route=BASE?url.pathname.slice(BASE.length):url.pathname;
  if(!route.startsWith('/api/'))return staticFile(res,route);
  try{
    if(req.method==='GET'&&route==='/api/status')return respond(res,200,{backend:true,authenticated:auth(req),version:'0.6.1',demoMode:DEMO_MODE,basePath:BASE});
    if(req.method==='POST'&&route==='/api/login'){
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
    if(route==='/api/logout'&&req.method==='POST'){sessions.delete(cookie(req));res.setHeader('Set-Cookie',`hs_session=; HttpOnly; SameSite=Strict; Path=${BASE||''}/; Max-Age=0`);return respond(res,200,{ok:true})}
    if(req.method==='GET'&&route==='/api/storage')return respond(res,200,{...storageUsage(),mode:'local',concurrency:CONCURRENCY,notice:'原图保留在服务端；预览由浏览器生成后缓存，项目备份与原图下载不受影响。'});
    // Project, board, and conversation state are stored on the server, not localStorage.
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
    if(route==='/api/providers'&&req.method==='GET')return respond(res,200,{providers:state.providers.map(safe),activeId:state.activeId});
    if(route==='/api/providers'&&req.method==='POST'){
      const b=await readJSON(req);if(state.providers.length>=30)throw Error('最多 30 个服务商');const name=trim(b.name,60),mode=b.mode,base=trim(b.url,600);if(!name||!base)throw Error('请填写服务商名称与地址');if(!['openai','gemini'].includes(mode))throw Error('不支持的接口类型');if((await checkedURL(base)).u.search)throw Error('基础地址不要包含查询参数');
      const p={id:crypto.randomUUID(),name,mode,url:base,imageMode:mode==='gemini'?'gemini':['images','chat','responses'].includes(b.imageMode)?b.imageMode:'images',imageModel:assertModel(b.imageModel||'gpt-image-2'),visionModel:assertModel(b.visionModel||(mode==='gemini'?'gemini-2.5-flash':'gpt-4o-mini')),responseModel:trim(b.responseModel,150),apiKey:trim(b.apiKey,1200)};
      state.providers.push(p);if(!state.activeId)state.activeId=p.id;encrypt(state);return respond(res,201,{provider:safe(p),activeId:state.activeId});
    }
    const pm=route.match(/^\/api\/providers\/([a-f0-9-]{36})(?:\/(activate|check|capabilities|probe))?$/);
    if(pm){const p=provider(pm[1]);if(!p)return fail(res,404,'服务商不存在');
      if(req.method==='POST'&&pm[2]==='activate'){state.activeId=p.id;encrypt(state);return respond(res,200,{activeId:p.id})}
      if(req.method==='GET'&&pm[2]==='capabilities')return respond(res,200,capabilities(p));
      if(req.method==='POST'&&pm[2]==='probe'){
        if(DEMO_MODE)return fail(res,403,'演示站禁止真实 API 测试');
        const b=await readJSON(req);if(b.confirmCost!==true)throw Error('必须确认能力测试会扣费');
        emptyProvider(p);const model=assertModel(b.model||(b.kind==='reverse'?p.visionModel:p.imageModel));
        if(!['reverse','generate','edit'].includes(b.kind))throw Error('未知的实测类型');
        const start=Date.now();try{let previewUrl=null,summary='';
          const sampleBytes=fs.readFileSync(path.join(ROOT,'assets/hamoki-avatar-128.webp'));const sample={mime:'image/webp',bytes:sampleBytes,base64:sampleBytes.toString('base64')};
          if(b.kind==='reverse')summary=(await reverse(p,sample,model,'detailed')).slice(0,500);
          else {const input=b.kind==='edit'?[sample]:[]; const output=await generate(p,{model,prompt:b.kind==='edit'?'把参考图片变成极简线条插画，保持主体':'画一颗绿色的小星星，白色背景',ratio:'1:1',resolution:'1K',quality:'low'},input,null);const file=storeMedia(output);previewUrl=BASE+'/api/media/'+file;summary='上游已返回有效图片（请检查预览）'}
          const field=b.kind==='reverse'?'imageReverse':b.kind==='edit'?'referenceImage':'textToImage';recordCapability(p,field,true,model,{durationMs:Date.now()-start});return respond(res,200,{success:true,kind:b.kind,model,latencyMs:Date.now()-start,previewUrl,summary});
        }catch(e){const field=b.kind==='reverse'?'imageReverse':b.kind==='edit'?'referenceImage':'textToImage';recordCapability(p,field,false,model,{error:String(e.message).slice(0,250),durationMs:Date.now()-start});return respond(res,200,{success:false,kind:b.kind,model,latencyMs:Date.now()-start,error:String(e.message).slice(0,320)})}
      }
      if(req.method==='GET'&&pm[2]==='check'){emptyProvider(p);const begin=Date.now();try{const models=await listModels(p);return respond(res,200,{reachable:true,latencyMs:Date.now()-begin,models,notice:'GET /models 连接成功不代表支持生图/反推；必须实际调用才可验证能力。'})}catch(e){return respond(res,200,{reachable:false,latencyMs:Date.now()-begin,error:String(e.message).slice(0,350),notice:'部分中转站不开放 /models，失败不代表生图不可用。'})}}
      if(req.method==='DELETE'&&!pm[2]){if(jobs.some(j=>['running','queued'].includes(j.status)&&j.providerId===p.id))throw Error('此站仍有运行或排队任务，请先完成或取消');state.providers=state.providers.filter(x=>x.id!==p.id);if(state.activeId===p.id)state.activeId=state.providers[0]?.id||null;encrypt(state);return respond(res,200,{activeId:state.activeId})}
      if(req.method==='PUT'&&!pm[2]){const b=await readJSON(req),name=trim(b.name,60),base=trim(b.url,600);if(!name||!base)throw Error('请填写服务商名称与地址');if(!['openai','gemini'].includes(b.mode))throw Error('接口类型不支持');if(jobs.some(j=>['queued','running'].includes(j.status)&&j.providerId===p.id))throw Error('当前中转站有未完成任务，请先等待或取消，之后再修改地址与密钥');if((await checkedURL(base)).u.search)throw Error('基础地址不要包含查询参数');Object.assign(p,{name,url:base,mode:b.mode,imageMode:b.mode==='gemini'?'gemini':['images','chat','responses'].includes(b.imageMode)?b.imageMode:'images',imageModel:assertModel(b.imageModel),visionModel:assertModel(b.visionModel),responseModel:trim(b.responseModel,150)});if(b.apiKey)p.apiKey=trim(b.apiKey,1200);if(b.clearKey)p.apiKey='';encrypt(state);return respond(res,200,{provider:safe(p)})}
    }
    if(req.method==='GET'&&route==='/api/models'){const p=provider(url.searchParams.get('providerId')||state.activeId);emptyProvider(p);return respond(res,200,{models:await listModels(p)})}
    if(req.method==='POST'&&route==='/api/reverse'){const b=await readJSON(req),p=provider(b.providerId||state.activeId);emptyProvider(p);const pic=imageFromDataURL(b.image),model=assertModel(b.model||p.visionModel);const start=Date.now(),prompt=await reverse(p,pic,model,b.kind);recordCapability(p,'imageReverse',true,model,{durationMs:Date.now()-start});return respond(res,200,{prompt,providerName:p.name,model})}
    if(req.method==='POST'&&route==='/api/jobs'){const b=await readJSON(req);const result=submit(b);return respond(res,201,result)}
    if(req.method==='GET'&&route==='/api/jobs')return respond(res,200,{paused,running,concurrency:CONCURRENCY,jobs:jobs.filter(j=>!url.searchParams.get('projectId')||j.projectId===url.searchParams.get('projectId')).slice(0,300).map(publicJob)});
    if(req.method==='POST'&&route==='/api/queue'){const b=await readJSON(req);if(!['pause','resume'].includes(b.action))throw Error('无效队列操作');paused=b.action==='pause';saveJobs();if(!paused)schedule();return respond(res,200,{paused})}
    const jm=route.match(/^\/api\/jobs\/([a-f0-9-]{36})\/(cancel|retry)$/);
    if(jm&&req.method==='POST'){const j=jobs.find(x=>x.id===jm[1]);if(!j)return fail(res,404,'任务不存在');if(jm[2]==='cancel'){if(!['queued','running','interrupted'].includes(j.status))throw Error('任务当前不可取消');j.status='cancelled';j.updatedAt=time();controllers.get(j.id)?.abort();saveJobs();return respond(res,200,{job:publicJob(j)})}
      if(!['failed','cancelled','interrupted'].includes(j.status))throw Error('此任务不需要重试');emptyProvider(provider(j.providerId));const again={...j,id:crypto.randomUUID(),createdAt:time(),updatedAt:time(),startedAt:null,resultId:null,error:'',status:'queued',attempts:0,retryOf:j.id};jobs.unshift(again);saveJobs();schedule();return respond(res,201,{job:publicJob(again)});
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
  }catch(e){const msg=String(e?.message||'服务错误').slice(0,450);if(!res.headersSent){const code=[400,401,403,404,413,415].includes(e.status)?e.status:400;return fail(res,code,msg)}console.error('[Hamoki]',route,msg)}
}
const server=http.createServer(handler);
server.requestTimeout=210000;
server.listen(PORT,HOST,()=>console.log(`Hamoki Studio ready at http://${HOST}:${PORT} (v0.6.1 lightweight web)`));

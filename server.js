/** Hamoki Studio V0.6.1 browser-first low-resource AI workspace. */
'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {spawn}=require('node:child_process');
const {checkedURL,imageFromDataURL,guessMime,extension,reverse,generate,listModels,imageSize}=require('./lib/upstream');
const {normalizeCustomImageSize}=require('./lib/custom-image-size');
const {pack}=require('./lib/zip');
const {normalizeGroupSettings,layoutNodes}=require('./lib/canvas-group-layout');
const {placeGeneratedImage,placeRelatedImage}=require('./lib/v1-canvas-placement');
const {fitImageBox}=require('./lib/canvas-placement');
const {dimensions}=require('./lib/creative-auto-ratio');
const {infer:qwenLayeredInfer}=require('./lib/qwen-layered');
const ROOT=__dirname,PORT=Number(process.env.PORT||8028),HOST=process.env.HOST||'127.0.0.1';
const PASSWORD=process.env.APP_PASSWORD||'localdev123456';
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
function makeProject(title){return {id:crypto.randomUUID(),title:clampText(title||'未命名项目',70),createdAt:time(),updatedAt:time(),revision:0,archived:false,viewport:{x:220,y:130,scale:1},nodes:[],groups:[],messages:[]}}
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
function predictedPreview(ratio,resolution,customSize=null){
  const [width,height]=(customSize||imageSize(ratio,resolution)).split('x').map(Number);
  const box=fitImageBox(width,height);
  return {width,height,w:box.w,h:box.h};
}
// Canvas frames are planned at submit time so the loading placeholder and the
// finished artwork land on the exact same slot instead of jumping afterwards.
function planCanvasFrame(project,reserved,ratio,resolution,parentId=null,customSize=null){
  const preview=predictedPreview(ratio,resolution,customSize);
  const factor=parentId?Math.min(1,210/Math.max(preview.w,preview.h)):1;
  const w=Math.max(120,Math.round(preview.w*factor)),h=Math.max(120,Math.round(preview.h*factor));
  const position=parentId?placeRelatedImage([...project.nodes,...reserved],{parentId,width:w,height:h,gap:34}):placeGeneratedImage([...project.nodes,...reserved],{width:w,height:h,gap:36});
  return {planned:{x:position.x,y:position.y,w,h},preview:{width:preview.width,height:preview.height}};
}
function nextImageSequence(project){
  const nodes=project.nodes.filter(n=>n.kind==='generated');
  const numbered=nodes.map(n=>Number((String(n.title||'').match(/^图片生成(\d+)$/)||[])[1])).filter(n=>Number.isSafeInteger(n)&&n>0);
  return Math.max(Number(project.generationSeq)||0,nodes.length,0,...numbered);
}
function appendGeneratedNode(h,j){const p=project(j.projectId||defaultProject()?.id);if(!p)return;
 const parent=p.nodes.find(n=>n.id===j.sourceNodeId)||p.nodes.find(n=>n.historyId===h.parentId);
 const actual=dimensions(fetchMedia(h.file).bytes);
 // Node box follows the finished image's real aspect ratio instead of a fixed square.
 const fullBox=fitImageBox(...(actual||[]));
 const planned=j.planned&&Number.isFinite(Number(j.planned.x))&&Number.isFinite(Number(j.planned.y))?j.planned:null;
 const scale=parent?Math.min(1,210/Math.max(fullBox.w,fullBox.h)):1;
 const fallback={w:Math.max(120,Math.round(fullBox.w*scale)),h:Math.max(120,Math.round(fullBox.h*scale))};
 const w=parent&&planned?.w?num(planned.w,fallback.w,90,1200):parent?fallback.w:fullBox.w;
 const height=parent&&planned?.h?num(planned.h,fallback.h,90,1200):parent?fallback.h:fullBox.h;
 const position=planned?{x:Math.round(Number(planned.x)),y:Math.round(Number(planned.y))}:parent?placeRelatedImage(p.nodes,{parentId:parent.id,width:w,height:height,gap:34}):placeGeneratedImage(p.nodes,{width:w,height:height,gap:36});
 p.nodes.push({id:crypto.randomUUID(),kind:'generated',historyId:h.id,title:trim(j.name,40)||'',parentNodeId:parent?.id||null,x:position.x,y:position.y,w,h:height,pixelWidth:actual?.[0]||null,pixelHeight:actual?.[1]||null,createdAt:time()});
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
 const safeProject={title:p.title,viewport:p.viewport,nodes:p.nodes,groups:p.groups||[],messages:p.messages};
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
 if(Array.isArray(data.project.groups))proj.groups=data.project.groups.slice(0,200).map(g=>({
  id:oldGroupId.get(g.id)||crypto.randomUUID(),...normalizeGroupSettings(g),createdAt:time(),
  promptNodeId:oldNodeId.get(g.promptNodeId)||null
 })).filter(g=>proj.nodes.some(n=>n.groupId===g.id));
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
function auth(req){return true;} // 本地开发，不需要密码
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
// Render small previews on demand, without making the browser decode originals.
const previewBuilds=new Map();
const previewSlots={active:0,queue:[]};
async function withPreviewSlot(work){
 if(previewSlots.active>=2)await new Promise(resolve=>previewSlots.queue.push(resolve));
 previewSlots.active++;
 try{return await work()}finally{previewSlots.active--;previewSlots.queue.shift()?.()}
}
function existingPreview(name){
 const webp=previewPath(name,'webp'),jpeg=previewPath(name,'jpg');
 return fs.existsSync(webp)?webp:fs.existsSync(jpeg)?jpeg:null;
}
async function ensurePreview(name){
 const cached=existingPreview(name);
 if(cached)return cached;
 if(previewBuilds.has(name))return previewBuilds.get(name);
 const task=withPreviewSlot(async()=>{
  const ready=existingPreview(name);if(ready)return ready;
  const source=mediaPath(name);if(!fs.existsSync(source))return null;
  const output=previewPath(name,'webp');
  const temp=output+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
  try {
   await new Promise((resolve,reject)=>{
    const python=process.env.STUDIO_PYTHON|| (process.platform==='win32'?'python':'python3');
    const child=spawn(python,[path.join(ROOT,'lib','thumbnail.py'),source,temp],{windowsHide:true,stdio:'ignore'});
    const timer=setTimeout(()=>child.kill(),20000);
    child.once('error',error=>{clearTimeout(timer);reject(error)});
    child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error('preview generation failed'))});
   });
   const size=fs.statSync(temp).size;
   if(!size||size>512*1024)throw Error('preview too large');
   checkSpace(size);
   if(!existingPreview(name)){fs.renameSync(temp,output);usageCache=null;}
   return existingPreview(name);
  }catch(error){
   console.warn('[Hamoki preview]',String(error.message||error).slice(0,150));
   return null;
  }finally{try{fs.unlinkSync(temp)}catch{}}
 });
 previewBuilds.set(name,task);
 try{return await task}finally{previewBuilds.delete(name)}
}
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
  recordCapability(p,mask?'mask':job.transparentBg?'transparentBackground':media.length?'referenceImage':'textToImage',true,job.model,{ratio:job.ratio,resolution:job.resolution,customSize:job.customSize||null,durationMs:Date.now()-t0});
  if(job.status==='cancelled')return;
  const file=storeMedia(output),id=crypto.randomUUID();const entry={id,file,createdAt:time(),projectId:job.projectId||defaultProject()?.id,providerId:job.providerId,providerName:job.providerName,model:job.model,prompt:job.prompt,ratio:job.ratio,resolution:job.resolution,customSize:job.customSize||null,parentId:job.sourceId||null,groupId:job.groupId||null,referenceMedia:job.referenceMedia||[],masked:!!mask,transparentBg:!!job.transparentBg,editInstruction:job.editInstruction||'',roleHints:job.roleHints||[],jobId:job.id,favorite:false,durationMs:Date.now()-t0};
  history.unshift(entry);saveHistory();appendGeneratedNode(entry,job);job.resultId=id;jobStatusOk(job,'done');
}catch(e){if(job.status==='cancelled')return;job.error=String(e?.message||'请求失败').slice(0,380);job.durationMs=Date.now()-t0;job.completionUncertain=!!(e.completionUncertain||e.timeout||[504,524].includes(e.upstreamStatus));
  if(e.upstreamStatus===429&&job.attempts<3){
    const delay=Math.min(30000,e.retryAfterMs||Math.round(1600*2**(job.attempts-1)+Math.random()*600));
    job.status='queued';job.nextRunAt=Date.now()+delay;job.error+='（上游429限流，'+Math.ceil(delay/1000)+' 秒后重试，最多3次）';job.updatedAt=time();saveJobs();schedule();
  }else jobStatusOk(job,'failed');
}finally{controllers.delete(job.id)}}
function makeJob(b,store,providerId,model,groupId){const p=provider(providerId);if(!p)throw Error('服务商不存在');emptyProvider(p);return {id:crypto.randomUUID(),groupId,providerId,providerName:p.name,model:assertModel(model||p.imageModel),name:trim(b.name,40)||'',prompt:b.prompt,editInstruction:b.editInstruction||'',roleHints:store.roleHints||[],transparentBg:!!b.transparentBg,ratio:b.ratio,resolution:b.resolution,customSize:b.customSize||null,quality:b.quality,sourceId:b.sourceId||null,referenceMedia:store.input,maskMedia:store.mask,maskSourceMedia:store.maskSource,projectId:b.projectId,sourceNodeId:b.sourceNodeId||null,canvasX:b.canvasX,canvasY:b.canvasY,planned:b.planned||null,preview:b.preview||null,batchIndex:b.batchIndex||0,createdAt:time(),updatedAt:time(),status:'queued',attempts:0,resultId:null,error:'',retryOf:b.retryOf||null}}
const REFERENCE_ROLES={shape:'角色造型、身份及结构',color:'颜色与配色，不复制其主体',style:'绘画风格、线条和上色技巧，不复制内容',pose:'动作与构图',background:'背景与场景',general:'综合参考'};
function modelReferenceLimit(providerConfig,model){
 return providerConfig?.mode==='openai'&&
   (providerConfig.imageMode||'images')==='images'&&
   /^gpt-image-2(?:[.\-]|$)/i.test(String(model||providerConfig.imageModel||''))?16:8;
}
function plainCanvasNote(note){
 const value=String(note?.text||'').replace(/^HAMOKI_RICH_TEXT_V1:\{\{reverse_source:[a-f0-9-]{36}\}\}/i,'').replace(/^HAMOKI_RICH_TEXT_V1:/,'');
 return value.replace(/<\/(?:p|div|li|h[1-3])>/gi,'\n')
   .replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'')
   .replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
   .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&')
   .replace(/\n{3,}/g,'\n\n').trim().slice(0,1400);
}
function groupMembers(project,group){return project.nodes.filter(n=>n.groupId===group.id)}
function cleanedGroups(project){
 project.groups=Array.isArray(project.groups)?project.groups:[];
 project.groups=project.groups.filter(g=>project.nodes.some(n=>n.groupId===g.id));
}
function validateCreation(b){
 const instruction=trim(b.prompt,16000),refs=Array.isArray(b.references)?b.references:[];
 if(!instruction)throw Error('请输入创作描述');
 const targetProject=assertProject(b.projectId||defaultProject()?.id);
 const sourceNodeId=typeof b.sourceNodeId==='string'&&targetProject.nodes.some(x=>x.id===b.sourceNodeId)?b.sourceNodeId:null;
 const targetChoices=Array.isArray(b.targets)&&b.targets.length?b.targets:[{providerId:b.providerId||state.activeId,model:b.model}];
 const referenceLimit=Math.min(...targetChoices.map(t=>modelReferenceLimit(provider(t.providerId),t.model)));
 if(refs.length>referenceLimit)throw Error('该模型最多使用 '+referenceLimit+' 张本地参考图');
 const referenceNodes=Array.isArray(b.referenceNodes)?b.referenceNodes:[];
 if(referenceNodes.length>referenceLimit||refs.length+referenceNodes.length>referenceLimit)
   throw Error('该模型最多使用 '+referenceLimit+' 张参考图，请减少后再提交；不会自动忽略任何图片');
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
 const customSize=normalizeCustomImageSize(b.customSize);
 if(customSize&&targets.some(t=>{
   const p=provider(t.providerId);
   const model=String(t.model||p?.imageModel||'');
   return !p||p.mode!=='openai'||!/^gpt-image-2(?:$|[.\-])/i.test(model);
 }))throw Error('自定义宽高目前仅适用于 OpenAI 协议的 GPT Image 2 系列模型');
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
 return {prompt,editInstruction:instruction,refs,referenceNodes:images,count,targets,ratio,resolution,customSize,quality,transparentBg,sourceId:source?.id||null,sourceNodeId,projectId:targetProject.id,canvasX:num(b.canvasX,180),canvasY:num(b.canvasY,170),mask:b.mask||null,maskSourceImage:b.maskSourceImage||null};
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
 const groupId=crypto.randomUUID(),created=[],reserved=[];
 const proj=assertProject(valid.projectId);
 // Slots already promised to queued/running jobs of this project must stay
 // occupied, otherwise two quick submits would stack their placeholders.
 const pendingSlots=jobs
  .filter(job=>job.projectId===proj.id&&['queued','running'].includes(job.status)&&job.planned&&!job.resultId)
  .slice().reverse()
  .map(job=>({id:'pending-'+job.id,kind:'generated',x:job.planned.x,y:job.planned.y,w:job.planned.w,h:job.planned.h}));
 // Match the placement appendGeneratedNode() will use so the placeholder and the
 // finished node share one slot (edits land beside their source, new art in a row).
 const parentNode=(valid.sourceNodeId&&proj.nodes.find(n=>n.id===valid.sourceNodeId))
  || (source&&proj.nodes.find(n=>n.historyId===source.id)) || (valid.referenceNodes.length===1&&proj.nodes.find(n=>n.id===valid.referenceNodes[0].nodeId)) || (source?.parentId&&proj.nodes.find(n=>n.historyId===source.parentId)) || null;
 let sequence=nextImageSequence(proj);
 for(const t of valid.targets)for(let i=0;i<valid.count;i++){
  const frame=planCanvasFrame(proj,[...pendingSlots,...reserved],valid.ratio,valid.resolution,parentNode?.id||null,valid.customSize);
  sequence++;
  const job=makeJob({...valid,...frame,sourceNodeId:parentNode?.id||null,name:'图片生成'+sequence,batchIndex:created.length},store,t.providerId,t.model,groupId);
  created.push(job);
  reserved.push({id:'reserved-'+job.id,kind:'generated',x:frame.planned.x,y:frame.planned.y,w:frame.planned.w,h:frame.planned.h});
 }
 proj.generationSeq=sequence;
 jobs.unshift(...created);saveJobs();
 proj.messages.push({id:crypto.randomUUID(),role:'user',content:valid.editInstruction,createdAt:time(),groupId,sourceId:valid.sourceId,referenceRoles:valid.referenceNodes.map(n=>({nodeId:n.nodeId,role:n.role})),providerIds:valid.targets.map(t=>t.providerId)});
 proj.messages=proj.messages.slice(-400);touchProject(proj);schedule();return {jobs:created.map(publicJob),groupId};
}
function staticFile(res,pathname){if(pathname==='/')pathname='/index.html';if(!/^\/(?:index\.html|templates\.html|script\.js|style\.css|settings-v2\.js|settings-v2\.css|studio-v2\.js|studio-v2\.css|studio-v3\.css|studio-v4\.css|gameui-flow\.html|gameui-flow\.js|gameui-layered\.js|gameui-flow-tools\.js|gameui-flow\.css|flow-entry\.js|flow-entry\.css|logo\.png|settings\.html|assets\/[a-zA-Z0-9-]+\.(?:css|js|json|png|webp|ico))$/.test(pathname))return fail(res,404,'资源不存在');fs.readFile(path.join(ROOT,pathname),(e,buf)=>{if(e)return fail(res,404,'资源不存在');const ext=path.extname(pathname);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'})[ext],'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors "+(pathname==='/gameui-flow.html'?"'self'":"'none'"),'Cache-Control':'no-cache'});res.end(buf)})}
async function handler(req,res){if(ALLOWED_HOST&&String(req.headers.host||'').split(':')[0].toLowerCase()!==ALLOWED_HOST)return fail(res,421,'请求域名不符合独立安全域名配置');const url=new URL(req.url,'http://localhost');
  if(BASE && url.pathname===BASE){res.writeHead(308,{Location:BASE+'/'});return res.end()}
  if(BASE && !url.pathname.startsWith(BASE+'/'))return fail(res,404,'项目路径不存在');
  const route=BASE?url.pathname.slice(BASE.length):url.pathname;
  if(route==='/settings.html'&&req.method==='GET'){res.writeHead(302,{'Location':(BASE||'')+'/?settings=1','Cache-Control':'no-store'});return res.end()}
  if(!route.startsWith('/api/'))return staticFile(res,route);
  try{
    if(req.method==='GET'&&route==='/api/status')return respond(res,200,{backend:true,authenticated:auth(req),version:'0.6.1',demoMode:DEMO_MODE,basePath:BASE});
    if(req.method==='POST'&&route==='/api/layered/decompose'){
      const b=await readJSON(req),p=assertProject(b.projectId),parent=p.nodes.find(n=>n.id===b.parentNodeId&&n.kind!=='note');
      if(!parent)throw Error('原始 UI 图片节点不存在');
      const requestedLayers=Math.max(2,Math.min(8,Math.floor(Number(b.layers)||4)));
      if(p.nodes.length+requestedLayers>1800)throw Error('画布剩余容量不足以保存拆层结果');
      const source=imageFromDataURL(b.image);
      if(!['image/png','image/jpeg','image/webp'].includes(source.mime))throw Error('原图格式不支持');
      const layers=await qwenLayeredInfer({bytes:source.bytes,layers:requestedLayers,steps:50,prompt:clampText(b.prompt,500)});
      if(p.nodes.length+layers.length>1800)throw Error('拆层完成，但画布容量不足；原图未改变');
      const nodes=[];
      for(let i=0;i<layers.length;i++){
        const item=layers[i],file=storeMedia({mime:'image/png',bytes:item.bytes});
        const position=placeRelatedImage(p.nodes,{parentId:parent.id,width:num(parent.w,288,90,1200),height:num(parent.h,288,90,1200),gap:52});
        const node={id:crypto.randomUUID(),kind:'reference',assetFile:file,title:'智能拆层 · '+String(i+1).padStart(2,'0'),...position,createdAt:time(),parentNodeId:parent.id,layerIndex:i+1,layerSource:'qwen-image-layered'};
        p.nodes.push(node);nodes.push(nodeView(node));
      }
      touchProject(p);return respond(res,201,{ok:true,count:nodes.length,layers:nodes,provider:'Qwen-Image-Layered'});
    }
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
    const layeredMatch=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/layered-nodes$/);
    if(layeredMatch&&req.method==='POST'){
      const p=assertProject(layeredMatch[1]),b=await readJSON(req);
      if(p.nodes.length>=1800)throw Error('画布素材数量已达到上限');
      const parent=p.nodes.find(n=>n.id===b.parentNodeId&&n.kind!=='note');
      if(!parent)throw Error('原始 UI 图片节点不存在');
      const img=imageFromDataURL(b.image);
      if(img.mime!=='image/png'||img.bytes.length>14*1024*1024)throw Error('拆层素材必须是小于14MB的PNG');
      const file=storeMedia(img),index=Math.max(1,Math.min(8,Math.floor(Number(b.index)||1)));
      const position=placeRelatedImage(p.nodes,{parentId:parent.id,width:num(parent.w,288,90,1200),height:num(parent.h,288,90,1200),gap:52});
      const node={id:crypto.randomUUID(),kind:'reference',assetFile:file,title:'智能拆层 · '+String(index).padStart(2,'0'),...position,createdAt:time(),parentNodeId:parent.id,layerIndex:index,layerSource:'qwen-image-layered'};
      p.nodes.push(node);touchProject(p);return respond(res,201,{node:nodeView(node)});
    }
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
    // Canvas project groups are metadata on existing nodes. No media is moved.
    const canvasGroupRoute=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/groups(?:\/([a-f0-9-]{36}))?(?:\/(download|run|move))?$/);
    if(canvasGroupRoute){
      const p=assertProject(canvasGroupRoute[1]);
      p.groups=Array.isArray(p.groups)?p.groups:[];
      const id=canvasGroupRoute[2],action=canvasGroupRoute[3];
      const group=id?p.groups.find(g=>g.id===id):null;
      if(id&&!group)return fail(res,404,'分组不存在或已解散');
      if(!id&&req.method==='POST'){
        const b=await readJSON(req),ids=b.nodeIds;
        if(!Array.isArray(ids)||ids.length<2||ids.length>150||
            ids.length!==new Set(ids).size)throw Error('请选择2至150个不同画布元素打组');
        if(p.groups.length>=140)throw Error('当前画布最多140个组');
        const members=ids.map(id=>p.nodes.find(n=>n.id===id));
        if(members.some(n=>!n))throw Error('框选的节点已变化，请刷新后重试');
        if(members.some(n=>p.groups.some(g=>g.id===n.groupId)))throw Error('已打组的节点请先解散原组再重新框选');
        const settings=normalizeGroupSettings(b);
        const group={id:crypto.randomUUID(),...settings,createdAt:time()};
        for(const member of members)member.groupId=group.id;
        if(group.promptNodeId&&!members.some(n=>n.id===group.promptNodeId&&n.kind==='note'))
          group.promptNodeId=null;
        const updates=layoutNodes(members,group);
        for(const change of updates)Object.assign(members.find(n=>n.id===change.id),change);
        p.groups.push(group);touchProject(p);
        return respond(res,201,{group,nodes:members.map(nodeView)});
      }
      if(!group)return fail(res,405,'分组方法不支持');
      const members=groupMembers(p,group);
      if(!action&&req.method==='PATCH'){
        const b=await readJSON(req),settings=normalizeGroupSettings(b,group);
        if(settings.promptNodeId&&!members.some(n=>n.id===settings.promptNodeId&&n.kind==='note'))
          throw Error('主提示词必须属于本组的文本节点');
        Object.assign(group,settings);
        const updates=layoutNodes(members,group);
        for(const change of updates)Object.assign(members.find(n=>n.id===change.id),change);
        touchProject(p);return respond(res,200,{group,nodes:members.map(nodeView)});
      }
      if(!action&&req.method==='DELETE'){
        for(const member of members)member.groupId=null;
        p.groups=p.groups.filter(item=>item.id!==group.id);
        touchProject(p);return respond(res,200,{ungrouped:members.length,originalsPreserved:true});
      }
      if(action==='move'&&req.method==='PATCH'){
        const b=await readJSON(req),dx=Number(b.dx),dy=Number(b.dy);
        if(!Number.isInteger(dx)||!Number.isInteger(dy)||Math.abs(dx)>50000||Math.abs(dy)>50000)
          throw Error('移动距离无效');
        if(members.some(m=>Number(m.x)+dx < -200000 || Number(m.x)+dx>200000 ||
          Number(m.y)+dy < -200000 || Number(m.y)+dy>200000))
          throw Error('整组移动超出画布范围');
        for(const member of members){member.x=Math.round(Number(member.x)+dx);member.y=Math.round(Number(member.y)+dy)}
        touchProject(p);return respond(res,200,{groupId:group.id,changed:members.length});
      }
      if(action==='download'&&req.method==='GET'){
        const pictures=members.filter(n=>n.kind!=='note'),files=[];
        if(!pictures.length)throw Error('这个组还没有图片');
        let bytes=0;
        for(const [i,node] of pictures.entries()){
          const original=node.kind==='reference'?node.assetFile:
            history.find(h=>h.id===node.historyId&&h.projectId===p.id)?.file;
          if(!original||!fs.existsSync(mediaPath(original)))throw Error('分组原图不存在，请先检查历史数据');
          const data=fs.readFileSync(mediaPath(original));bytes+=data.length;
          if(bytes>180*1024*1024)throw Object.assign(Error('此组原图合计超过180MB，请分组下载'),{status:413});
          files.push({name:'images/'+String(i+1).padStart(3,'0')+'-'+node.id.slice(0,8)+'.'+original.split('.').pop(),bytes:data});
        }
        const prompts=members.filter(n=>n.kind==='note').map(plainCanvasNote).filter(Boolean);
        if(prompts.length)files.push({name:'prompt.txt',bytes:Buffer.from(prompts.join('\n\n---\n\n'),'utf8')});
        files.push({name:'group-info.json',bytes:Buffer.from(JSON.stringify({
          title:group.title,color:group.color,layout:group.layout,align:group.align,
          exportedAt:time(),imageCount:pictures.length,promptCount:prompts.length,
          imageIds:pictures.map(n=>n.id)},null,2),'utf8')});
        const archive=pack(files);
        res.writeHead(200,{'Content-Type':'application/zip','Content-Length':archive.length,
          'Content-Disposition':'attachment; filename="hamoki-group-'+group.id.slice(0,8)+'.zip"',
          'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        return res.end(archive);
      }
      if(action==='run'&&req.method==='POST'){
        const b=await readJSON(req);
        const pictures=members.filter(n=>n.kind!=='note');
        const notes=members.filter(n=>n.kind==='note'&&plainCanvasNote(n));
        if(!pictures.length||!notes.length)throw Error('整组运行需要同时包含图片和提示词面板');
        const chosen=notes.find(n=>n.id===group.promptNodeId)||
          notes.find(n=>String(n.text||'').includes('{{reverse_source:'))||notes[0];
        const prompt=plainCanvasNote(chosen);
        if(!prompt||prompt==='输入或粘贴反推提示词…')throw Error('请先在组内填写有效反推提示词');
        const providerId=trim(b.providerId,80)||state.activeId,providerConfig=provider(providerId);
        if(!providerConfig)throw Error('请选择有效中转站');
        const model=assertModel(b.model||providerConfig.imageModel);
        const max=modelReferenceLimit(providerConfig,model);
        if(pictures.length>max)throw Object.assign(Error('当前模型最多支持'+max+'张参考图，本组有'+pictures.length+'张。请先移出多余图片；不会自动忽略任何一张。'),{status:400});
        if(members.length>150)throw Error('分组图片数量过多');
        const result=submit({
          projectId:p.id,prompt,sourceNodeId:pictures[0].id,
          referenceNodes:pictures.map(n=>({nodeId:n.id,role:'general'})),
          editMode:'new',targets:[{providerId,model}],
          ratio:trim(b.ratio,10)||'1:1',resolution:trim(b.resolution,5)||'1K',
          count:1,quality:'auto'
        });
        return respond(res,201,{...result,groupRun:true,promptNodeId:chosen.id,imageCount:pictures.length});
      }
      return fail(res,405,'分组方法不支持');
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
        const parent=p.nodes.find(n=>n.id===b.parentNodeId);
         const position=parent&&parent.kind!=='note'&&(b.placement==='related'||(b.x===undefined&&b.y===undefined))?placeRelatedImage(p.nodes,{parentId:parent.id,width:num(b.w,288,90,1200),height:num(b.h,288,90,1200),gap:52}):posNode(b);
         const node={id:crypto.randomUUID(),kind:'reference',assetFile:file,title:clampText(b.name||'参考图片',100),...position,createdAt:time(),parentNodeId:parent?.id||null};
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
    // Atomic multi-node removal. Keep media and generation history intact.
    const removeSelection=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/nodes\/selection$/);
    if(removeSelection&&req.method==='DELETE'){
      const p=assertProject(removeSelection[1]),b=await readJSON(req);
      if(!Array.isArray(b.nodeIds)||!b.nodeIds.length||b.nodeIds.length>1800)
        throw Error('请选择至少一张且不超过1800张画布图片');
      const ids=new Set(b.nodeIds);
      if(ids.size!==b.nodeIds.length||[...ids].some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))
        throw Error('图片选择列表无效');
      const present=new Set(p.nodes.map(n=>n.id));
      if([...ids].some(id=>!present.has(id)))throw Error('选中的画布图片已变化，请刷新后重试');
      p.nodes=p.nodes.filter(n=>!ids.has(n.id));cleanedGroups(p);
      for(const node of p.nodes)if(ids.has(node.parentNodeId))node.parentNodeId=null;
      touchProject(p);
      return respond(res,200,{removed:ids.size,historyPreserved:true,originalsPreserved:true});
    }
    const clearNodesMatch=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/nodes$/);
    if(clearNodesMatch&&req.method==='DELETE'){
      const p=assertProject(clearNodesMatch[1]);const removed=p.nodes.length;p.nodes=[];p.groups=[];touchProject(p);
      return respond(res,200,{removed,historyPreserved:true});
    }
    // Copy a canvas image without recompressing/reuploading the original media.
    // Duplicates are independent reference nodes (not new AI generations).
    const duplicateNodeMatch=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/nodes\/duplicate$/);
    if(duplicateNodeMatch&&req.method==='POST'){
      const p=assertProject(duplicateNodeMatch[1]),b=await readJSON(req);
      if(p.nodes.length>=1800)throw Error('画布素材数量已达到上限');
      const source=p.nodes.find(n=>n.id===b.sourceNodeId&&n.kind!=='note');
      if(!source)return fail(res,404,'原图片节点不存在');
      let assetFile=source.assetFile;
      if(source.kind==='generated'){
        const entry=history.find(h=>h.id===source.historyId&&h.projectId===p.id);
        if(!entry)return fail(res,404,'原图片历史不存在');
        assetFile=entry.file;
      }
      if(!assetFile||!fs.existsSync(mediaPath(assetFile)))return fail(res,404,'原图片文件不存在');
      const position=posNode({x:b.x===undefined?source.x+44:b.x,y:b.y===undefined?source.y+44:b.y,
        w:b.w===undefined?source.w:b.w,h:b.h===undefined?source.h:b.h});
      const node={id:crypto.randomUUID(),kind:'reference',assetFile,
        title:clampText(b.title||((source.title||'画布图片')+' · 副本'),100),
        ...position,createdAt:time(),parentNodeId:null};
      p.nodes.push(node);touchProject(p);return respond(res,201,{node:nodeView(node)});
    }
    const fromHistoryMatch=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/nodes\/from-history$/);
    if(fromHistoryMatch&&req.method==='POST'){
      const p=assertProject(fromHistoryMatch[1]),b=await readJSON(req);
      const h=history.find(item=>item.id===b.historyId&&item.projectId===p.id);
      if(!h)return fail(res,404,'作品不存在或不属于当前项目');
      if(p.nodes.length>=1800)throw Error('画布元素数量达到上限');
      const position=placeGeneratedImage(p.nodes,{width:288,height:288,gap:36});
      const n={id:crypto.randomUUID(),kind:'generated',historyId:h.id,...position,x:b.x===undefined?position.x:num(b.x,position.x),y:b.y===undefined?position.y:num(b.y,position.y),createdAt:time()};
      p.nodes.push(n);touchProject(p);return respond(res,201,{node:nodeView(n)});
    }
    const nodeMatch=route.match(/^\/api\/projects\/([a-f0-9-]{36})\/nodes\/([a-f0-9-]{36})$/);
    if(nodeMatch){const p=assertProject(nodeMatch[1]),n=p.nodes.find(n=>n.id===nodeMatch[2]);if(!n)return fail(res,404,'画布元素不存在');
      if(req.method==='PATCH'){const b=await readJSON(req);for(const k of ['x','y','w','h'])if(b[k]!==undefined)n[k]=num(b[k],n[k],k==='w'||k==='h'?90:-200000,k==='w'||k==='h'?1200:200000);if(n.kind==='note'&&b.text!==undefined)n.text=clampText(b.text,1600);if(b.title!==undefined)n.title=clampText(b.title,100);
        if(b.parentNodeId!==undefined){
          if(b.parentNodeId!==null&&typeof b.parentNodeId!=='string')throw Error('无效的父节点标识');
          const parent=b.parentNodeId===null?null:p.nodes.find(item=>item.id===b.parentNodeId&&item.kind!=='note');
          if(b.parentNodeId!==null&&!parent)throw Error('无法连接不存在的图片节点');
          if(n.kind==='note'&&parent)throw Error('便签不能连接到图片节点');
          const visited=new Set([n.id]);let ancestor=parent;
          while(ancestor){if(visited.has(ancestor.id))throw Error('节点连接不能形成循环');visited.add(ancestor.id);ancestor=p.nodes.find(item=>item.id===ancestor.parentNodeId)}
          n.parentNodeId=parent?.id||null;
        }
        touchProject(p);return respond(res,200,{node:nodeView(n)});}
      if(req.method==='DELETE'){p.nodes=p.nodes.filter(a=>a.id!==n.id);cleanedGroups(p);touchProject(p);return respond(res,200,{removed:true});}
    }
    if(route==='/api/providers/discover-models'&&req.method==='POST'){
      if(DEMO_MODE)return fail(res,403,'演示模式不允许使用真实中转站密钥');
      const b=await readJSON(req),base=trim(b.url,600),mode=b.mode,apiKey=trim(b.apiKey,1200);
      if(!base||!apiKey)throw Error('请先输入有效地址和 API Key');
      if(!['openai','gemini'].includes(mode))throw Error('接口类型不支持');
      if((await checkedURL(base)).u.search)throw Error('基础地址不能包含查询参数');
      const start=Date.now(),models=await listModels({url:base,mode,apiKey});
      return respond(res,200,{models,latencyMs:Date.now()-start,notice:'模型列表仅代表上游 /models 可读取，不代表具备生图能力；本次查询未保存中转站或密钥。'});
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
      if(!['failed','cancelled','interrupted'].includes(j.status))throw Error('此任务不需要重试');
      if(jobs.some(item=>item.retryOf===j.id))throw Error('该任务已经提交过重试，请检查最新任务状态，避免重复扣费');
      const b=await readJSON(req);
      const uncertain=j.completionUncertain||/(?:HTTP\s*(?:524|504)|上游请求超时)/i.test(j.error||'');
      if(uncertain&&b.acknowledgePotentialCharge!==true)throw Error('上游网关超时，原任务可能成功或已计费；请先核对上游任务记录，确认可能重复扣费后再重试');
      emptyProvider(provider(j.providerId));
      const again={...j,id:crypto.randomUUID(),createdAt:time(),updatedAt:time(),startedAt:null,resultId:null,error:'',completionUncertain:false,status:'queued',attempts:0,retryOf:j.id};
      jobs.unshift(again);saveJobs();schedule();return respond(res,201,{job:publicJob(again)});
    }
    if(req.method==='GET'&&route==='/api/history'){const q=trim(url.searchParams.get('q'),150).toLowerCase(),favorites=url.searchParams.get('favorite')==='1';let listed=history.filter(h=>(!favorites||h.favorite)&&(!url.searchParams.get('projectId')||h.projectId===url.searchParams.get('projectId')));if(q)listed=listed.filter(h=>[h.prompt,h.model,h.providerName].some(s=>(s||'').toLowerCase().includes(q)));return respond(res,200,{history:listed.slice(0,1500).map(publicHistory),total:listed.length})}
    const fm=route.match(/^\/api\/history\/([a-f0-9-]{36})\/favorite$/);if(fm&&req.method==='POST'){const h=history.find(x=>x.id===fm[1]);if(!h)return fail(res,404,'图片不存在');h.favorite=!!(await readJSON(req)).favorite;saveHistory();return respond(res,200,{image:publicHistory(h)})}
    const dl=route.match(/^\/api\/download\/([a-f0-9-]{36})$/);if(dl&&req.method==='GET'){const h=history.find(x=>x.id===dl[1]);if(!h)return fail(res,404,'图片不存在');const img=fetchMedia(h.file);res.writeHead(200,{'Content-Type':img.mime,'Content-Disposition':`attachment; filename="hamoki-${h.id}.${extension(img.mime)}"`,'Cache-Control':'no-store'});return res.end(img.bytes)}
    if(route==='/api/export'&&req.method==='GET'){const ids=(url.searchParams.get('ids')||'').split(',').filter(Boolean).slice(0,40);const selected=ids.length?history.filter(x=>ids.includes(x.id)):history.slice(0,40);if(!selected.length)return fail(res,400,'没有可导出的图片');const files=selected.map((h,i)=>({name:'hamoki-'+String(i+1).padStart(3,'0')+'-'+h.id.slice(0,8)+'.'+h.file.split('.').pop(),bytes:fs.readFileSync(mediaPath(h.file))}));if(files.reduce((n,f)=>n+f.bytes.length,0)>180*1024*1024)throw Error('批量图片总大小超过 180MB，请选少量图片分批下载');const zip=pack(files);res.writeHead(200,{'Content-Type':'application/zip','Content-Length':zip.length,'Content-Disposition':'attachment; filename="hamoki-images.zip"','Cache-Control':'no-store'});return res.end(zip)}
    const previews=route.match(/^\/api\/previews\/([a-f0-9-]{36}\.(?:png|jpg|webp))$/);
    if(previews&&req.method==='GET'){const file=await ensurePreview(previews[1]);if(!file)return fail(res,404,'缩略图生成失败或原图不存在');return sendMedia(req,res,file,file.endsWith('.webp')?'image/webp':'image/jpeg')}
    const previewCreate=route.match(/^\/api\/media\/([a-f0-9-]{36}\.(?:png|jpg|webp))\/preview$/);
    if(previewCreate&&req.method==='POST'){const b=await readJSON(req),data=imageFromDataURL(b.preview);return respond(res,201,{saved:storePreview(previewCreate[1],data)})}
    const media=route.match(/^\/api\/media\/([a-f0-9-]{36}\.(?:png|jpg|webp))$/);if(media&&req.method==='GET'){const name=media[1],filename=mediaPath(name);if(!fs.existsSync(filename))return fail(res,404,'图片不存在');const mime=({'png':'image/png','jpg':'image/jpeg','webp':'image/webp'})[name.split('.').pop()];return sendMedia(req,res,filename,mime)}
    return fail(res,404,'接口不存在');
  }catch(e){const msg=String(e?.message||'服务错误').slice(0,450);if(!res.headersSent){const code=[400,401,403,404,413,415].includes(e.status)?e.status:400;return fail(res,code,msg)}console.error('[Hamoki]',route,msg)}
}
const server=http.createServer(handler);
server.requestTimeout=210000;
server.listen(PORT,HOST,()=>console.log(`Hamoki Studio ready at http://${HOST}:${PORT} (v0.6.1 lightweight web)`));

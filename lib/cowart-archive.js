'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const zip=require('./zip');
const active=new Set();
const MAX_ASSET=12*1024*1024;
const MAX_ARCHIVE=1024**3+16*1024*1024;
const bad=(message,status=422)=>Object.assign(Error(message),{status});
const empty=()=>({schema:{hamokiCanvas:2},store:{'page:main':{id:'page:main',typeName:'page',name:'画布 1',index:'a1',meta:{}}}});
const mimeFor=ext=>({png:'image/png',jpg:'image/jpeg',webp:'image/webp'}[ext]);

async function readRecord(file){
 let bytes;
 try{bytes=await fs.promises.readFile(file,'utf8');}
 catch(error){if(error.code==='ENOENT')return null;throw bad('画布文件暂不可读取，未生成不完整备份',503);}
 try{
  const record=JSON.parse(bytes);
  if(!record||typeof record!=='object'||!record.snapshot?.schema||!record.snapshot?.store)throw Error('invalid record');
  return record;
 }catch{throw bad('画布文件损坏，未生成不完整备份',409);}
}

async function describeFile(name,file,bytes,mimeType){
 const sha=crypto.createHash('sha256');
 let size=0,crc=0;
 const open=()=>bytes?Readable.from([bytes]):fs.createReadStream(file,{highWaterMark:64*1024});
 try{
  if(file){const stat=await fs.promises.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_ASSET)throw bad('原始素材无法安全读取，未生成不完整备份');}
  for await(const chunk of open()){size+=chunk.length;if(size>MAX_ASSET)throw bad('单个素材超过当前备份格式限制');sha.update(chunk);crc=zip.crc32(chunk,crc);}
 }catch(error){if(error.status)throw error;throw bad('部分原图暂不可读取，未生成不完整备份',409);}
 if(!size)throw bad('备份包含空素材，未生成不完整备份');
 return {name,size,crc32:crc,sha256:sha.digest('hex'),mimeType,open};
}

// Only read the selected account's immutable media files. Never fetch URLs or
// include account settings, keys, other projects, or files named by the client.
async function prepare(snapshot,mediaDirectory,{projectId='',revision=0}={}){
 const copied=JSON.parse(JSON.stringify(snapshot||empty()));
 if(!copied.schema||typeof copied.schema!=='object'||!copied.store||typeof copied.store!=='object'||Array.isArray(copied.store))throw bad('画布结构无法导出');
 const entries=new Map(),records=Object.values(copied.store);
 for(const shape of records)if(shape.typeName==='shape'&&shape.type==='image'){
  const asset=copied.store[shape.props?.assetId];
  if(asset?.typeName!=='asset'||!asset.props?.src)throw bad('画布中有原图引用缺失，未生成不完整备份',409);
 }
 for(const record of records){
  if(record.typeName!=='asset')continue;
  const src=record.props?.src;
  if(!src){if(record.type==='image')throw bad('画布中有原图缺失，未生成不完整备份',409);continue;}
  let name,entry;
  const local=/^\/api\/media\/([a-f0-9-]{36}\.(png|jpg|webp))$/.exec(src);
  const inline=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(src);
  if(local){
   name='assets/'+local[1];
   if(!entries.has(name))entry=await describeFile(name,path.join(mediaDirectory,local[1]),null,mimeFor(local[2]));
  }else if(inline){
   const bytes=Buffer.from(inline[2],'base64'),ext=inline[1]==='jpeg'?'jpg':inline[1];
   name='assets/'+crypto.createHash('sha256').update(bytes).digest('hex')+'.'+ext;
   if(!entries.has(name))entry=await describeFile(name,null,bytes,mimeFor(ext));
  }else throw bad('素材地址无法安全打包，请先完成图片保存');
  if(entry)entries.set(name,entry);
  if(entries.size>4096)throw bad('素材数量超过当前备份格式限制');
  record.props={...record.props,src:name};
 }
 const manifest={format:'hamoki-canvas-archive',version:1,exportedAt:new Date().toISOString(),sourceProjectId:projectId,sourceRevision:revision,snapshot:copied,files:[...entries.values()].map(e=>({path:e.name,size:e.size,sha256:e.sha256,mimeType:e.mimeType}))};
 const bytes=Buffer.from(JSON.stringify(manifest),'utf8');
 if(bytes.length>12*1024*1024)throw bad('画布结构超过当前备份格式限制');
 const first={name:'canvas.json',size:bytes.length,crc32:zip.crc32(bytes),open:()=>Readable.from([bytes])};
 const files=[first,...entries.values()],length=zip.byteLength(files);
 if(length>MAX_ARCHIVE)throw bad('备份超过当前归档容量');
 return {files,length,manifest};
}

async function serve(req,res,{accountId,projectId,revision,snapshot,mediaDirectory}){
 if(req.method!=='GET')throw bad('不支持的操作',405);
 if(active.has(accountId))throw bad('已有完整备份正在下载，请稍后重试',429);
 active.add(accountId);
 try{
  const archive=await prepare(snapshot,mediaDirectory,{projectId,revision});
  if(res.destroyed)return;
  res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="hamoki-canvas-'+projectId+'.zip"','Content-Length':archive.length,'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'});
  try{await pipeline(Readable.from(zip.streamFiles(archive.files)),res);}
  catch(error){if(!res.destroyed)res.destroy(error);}
 }finally{active.delete(accountId);}
}
module.exports={prepare,serve,readRecord};

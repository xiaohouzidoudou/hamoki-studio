'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {validImage,extension,MAX_IMAGE}=require('./upstream');
const bad=(message,status)=>Object.assign(Error(message),{status});

async function readAsset(req){
 const mime=String(req.headers['content-type']||'').split(';')[0].trim();
 if(!['image/png','image/jpeg','image/webp'].includes(mime))throw bad('仅支持 PNG、JPG、WebP 图片',415);
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>MAX_IMAGE)throw bad('单张图片需小于 12MB',413);chunks.push(chunk)}
 const bytes=Buffer.concat(chunks);
 if(!validImage(bytes,mime))throw bad('图片格式与内容不匹配',400);
 return {bytes,mime};
}

// Called synchronously after reading the body: no await between checking quota,
// writing the media and committing its index in this single-process gateway.
function storeAsset(dir,{bytes,mime},checkQuota){
 const indexFile=path.join(dir,'cowart-assets.json');
 let index={},oldSize=0;
 if(fs.existsSync(indexFile)){
  try{
   oldSize=fs.statSync(indexFile).size;
   if(oldSize>1024*1024)throw Error('Index too large');
   index=JSON.parse(fs.readFileSync(indexFile,'utf8'));
   if(!index||Array.isArray(index)||typeof index!=='object'||Object.keys(index).length>4096)throw Error('Invalid index');
   for(const [hash,name] of Object.entries(index))if(!/^[a-f0-9]{64}$/.test(hash)||typeof name!=='string'||!/^[a-f0-9-]{36}\.(?:png|jpg|webp)$/.test(name))throw Error('Invalid entry');
  }catch{throw bad('画布图片索引无法读取，请检查数据后重试',503)}
 }
 const hash=crypto.createHash('sha256').update(bytes).digest('hex');
 const mediaDir=path.join(dir,'media');
 const previous=index[hash];
 if(previous&&fs.existsSync(path.join(mediaDir,previous))){
  const stored=fs.readFileSync(path.join(mediaDir,previous));
  if(stored.equals(bytes))return {url:'/api/media/'+previous,reused:true};
  throw bad('已存图片内容不一致，请检查数据后重试',503);
 }
 if(!previous&&Object.keys(index).length>=4096)throw bad('画布图片数量已达上限，请先整理素材',413);
 const name=crypto.randomUUID()+'.'+extension(mime);
 index[hash]=name;
 const payload=JSON.stringify(index);
 checkQuota(bytes.length+Buffer.byteLength(payload)-oldSize);
 fs.mkdirSync(mediaDir,{recursive:true,mode:0o700});
 const file=path.join(mediaDir,name),temp=indexFile+'.'+crypto.randomUUID()+'.tmp';
 let created=false;
 try{
  fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});created=true;
  fs.writeFileSync(temp,payload,{flag:'wx',mode:0o600});
  fs.renameSync(temp,indexFile);
 }catch(error){
  if(created)try{fs.unlinkSync(file)}catch{}
  try{fs.unlinkSync(temp)}catch{}
  throw error;
 }
 return {url:'/api/media/'+name,reused:false};
}
module.exports={readAsset,storeAsset};

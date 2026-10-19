'use strict';
const fs=require('node:fs');
const path=require('node:path');

// Read the owning account's persisted snapshots on each quota cleanup. They are
// written by the gateway, so a workspace's in-memory project state is not enough.
function protectedCanvasMedia(dataDir){
 const folder=path.join(dataDir,'cowart-canvas'),files=new Set();
 let entries;
 try{entries=fs.readdirSync(folder,{withFileTypes:true})}catch(error){if(error.code==='ENOENT')return files;throw unavailable()}
 for(const entry of entries){
  if(!/^[a-f0-9-]{36}\.json$/.test(entry.name))continue;
  try{
   const file=path.join(folder,entry.name);
   if(!entry.isFile()||fs.statSync(file).size>13*1024*1024)throw Error('Invalid snapshot');
   const saved=JSON.parse(fs.readFileSync(file,'utf8'));
   const store=saved?.snapshot?.store;
   if(!store||typeof store!=='object'||Array.isArray(store))throw Error('Invalid snapshot');
   for(const record of Object.values(store)){
    if(record?.typeName!=='asset'||record.type!=='image')continue;
    const match=typeof record.props?.src==='string'&&record.props.src.match(/^\/api\/media\/([a-f0-9-]{36}\.(?:png|jpg|webp))$/);
    if(match)files.add(match[1]);
   }
  }catch{throw unavailable()}
 }
 return files;
}
function unavailable(){return Object.assign(Error('无法确认已保存画布的图片引用，已停止自动清理；请检查画布数据后重试。'),{status:503})}
module.exports={protectedCanvasMedia};

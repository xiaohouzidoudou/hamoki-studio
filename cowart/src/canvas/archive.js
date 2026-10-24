import { crc32 } from './download.js'
import { sanitizeCanvasSnapshot } from '../canvasSnapshot.js'

const MAX_ARCHIVE = 1024 ** 3 + 16 * 1024 ** 2
const MAX_ENTRY = 12 * 1024 ** 2
const assetPath = /^assets\/(?:[a-f0-9-]{36}|[a-f0-9]{64})\.(png|jpg|webp)$/
const mimeFor = ext => ({png:'image/png',jpg:'image/jpeg',webp:'image/webp'}[ext])
const invalid = message => Error(message || '备份文件不完整或格式不正确')
const stopped = signal => {if(signal?.aborted)throw new DOMException('导入已取消','AbortError')}
async function bytesAt(file,start,size){
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(size)||start<0||size<0||start+size>file.size)throw invalid()
 return new Uint8Array(await file.slice(start,start+size).arrayBuffer())
}
async function sha256(bytes){
 if(!globalThis.crypto?.subtle)throw Error('浏览器无法校验备份，请使用安全连接')
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')
}

// Read the central directory and individual File slices. Large backups are not
// loaded into a single array, and no paths from an archive reach the filesystem.
export async function openArchive(file,{signal,onProgress=()=>{}}={}){
 if(!file||file.size<22||file.size>MAX_ARCHIVE)throw invalid('备份为空或超过当前容量')
 stopped(signal)
 const tailStart=Math.max(0,file.size-65557),tail=await bytesAt(file,tailStart,file.size-tailStart),tv=new DataView(tail.buffer)
 let end=-1
 for(let i=tail.length-22;i>=0;i--)if(tv.getUint32(i,true)===0x06054b50&&i+22+tv.getUint16(i+20,true)===tail.length){end=i;break}
 if(end<0||tv.getUint16(end+4,true)||tv.getUint16(end+6,true))throw invalid()
 const count=tv.getUint16(end+10,true),centralSize=tv.getUint32(end+12,true),centralOffset=tv.getUint32(end+16,true)
 if(count!==tv.getUint16(end+8,true)||!count||count>8192||centralSize>2*1024**2||centralOffset+centralSize!==tailStart+end)throw invalid()
 const central=await bytesAt(file,centralOffset,centralSize),view=new DataView(central.buffer),entries=new Map(),decoder=new TextDecoder('utf-8',{fatal:true})
 let cursor=0
 for(let i=0;i<count;i++){
  stopped(signal)
  if(cursor+46>central.length||view.getUint32(cursor,true)!==0x02014b50)throw invalid()
  const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),crc=view.getUint32(cursor+16,true),packed=view.getUint32(cursor+20,true),size=view.getUint32(cursor+24,true),nameLength=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),disk=view.getUint16(cursor+34,true),offset=view.getUint32(cursor+42,true)
  if(flags!==0x800||method!==0||packed!==size||size>MAX_ENTRY||extra||comment||disk||cursor+46+nameLength>central.length)throw invalid('此文件不是受支持的完整画布备份')
  let name
  try{name=decoder.decode(central.subarray(cursor+46,cursor+46+nameLength))}catch{throw invalid()}
  if((name!=='canvas.json'&&!assetPath.test(name))||entries.has(name))throw invalid('备份包含无效或重复的文件路径')
  const local=await bytesAt(file,offset,30),lv=new DataView(local.buffer),localNameLength=lv.getUint16(26,true),localExtra=lv.getUint16(28,true)
  if(lv.getUint32(0,true)!==0x04034b50||lv.getUint16(6,true)!==flags||lv.getUint16(8,true)!==method||lv.getUint32(14,true)!==crc||lv.getUint32(18,true)!==size||lv.getUint32(22,true)!==size||localExtra||localNameLength!==nameLength)throw invalid()
  const localName=await bytesAt(file,offset+30,localNameLength)
  if(decoder.decode(localName)!==name)throw invalid()
  const dataOffset=offset+30+localNameLength
  if(dataOffset+size>centralOffset)throw invalid()
  entries.set(name,{name,offset,dataOffset,size,crc})
  cursor+=46+nameLength
 }
 if(cursor!==central.length)throw invalid()
 let previous=0
 for(const entry of [...entries.values()].sort((a,b)=>a.offset-b.offset)){if(entry.offset!==previous)throw invalid();previous=entry.dataOffset+entry.size}
 if(previous!==centralOffset||!entries.has('canvas.json'))throw invalid()
 async function read(name,expectedSHA){
  stopped(signal)
  const entry=entries.get(name)
  if(!entry)throw invalid('备份中缺少素材')
  const bytes=await bytesAt(file,entry.dataOffset,entry.size)
  if(crc32(bytes)!==entry.crc)throw invalid('备份校验失败，原画布未改动')
  if(expectedSHA&&await sha256(bytes)!==expectedSHA)throw invalid('素材校验失败，原画布未改动')
  return bytes
 }
 let manifest
 try{manifest=JSON.parse(decoder.decode(await read('canvas.json')))}catch(error){throw invalid(error.message)}
 if(manifest?.format!=='hamoki-canvas-archive'||manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length>4096)throw invalid('不是受支持的完整画布备份')
 const safe=sanitizeCanvasSnapshot(manifest.snapshot).snapshot
 if(!safe||Object.keys(safe.store).length>50000||!Object.values(safe.store).some(r=>r.typeName==='page'))throw invalid('备份中没有有效画布页面')
 // Prevent a damaged parent cycle from reaching the renderer after upload.
 const visited=new Set()
 for(const record of Object.values(safe.store)){
  const chain=new Set();let current=record
  while(current&&!visited.has(current.id)){
   if(chain.has(current.id))throw invalid('备份中的页面层级循环，原画布未改动')
   chain.add(current.id);current=safe.store[current.parentId]
  }
  for(const id of chain)visited.add(id)
 }
 const descriptors=new Map()
 for(const item of manifest.files){
  const match=typeof item.path==='string'&&assetPath.exec(item.path),entry=entries.get(item.path)
  if(!match||descriptors.has(item.path)||!entry||item.size!==entry.size||!item.size||item.mimeType!==mimeFor(match[1])||!/^[a-f0-9]{64}$/.test(item.sha256))throw invalid('素材清单与备份文件不一致')
  descriptors.set(item.path,item)
 }
 if(entries.size!==descriptors.size+1)throw invalid('备份包含清单以外的文件')
 const referenced=new Set()
 for(const record of Object.values(safe.store)){
  if(record.typeName==='asset'&&record.props?.src){
   if(!descriptors.has(record.props.src))throw invalid('备份仍包含未打包的素材引用')
   referenced.add(record.props.src)
  }
  if(record.typeName==='shape'&&record.type==='image'){
   const asset=safe.store[record.props?.assetId]
   if(asset?.typeName!=='asset'||!descriptors.has(asset.props?.src))throw invalid('备份中有图片缺失')
  }
 }
 if(referenced.size!==descriptors.size)throw invalid('素材清单包含画布以外的文件')
 let index=0
 // Verify every source before issuing any upload; a corrupt backup is read-only.
 for(const item of descriptors.values()){onProgress('校验素材 '+(++index)+' / '+descriptors.size);await read(item.path,item.sha256)}
 stopped(signal)
 return {snapshot:safe,manifest,descriptors,read}
}

export async function restoreArchive(archive,upload,{signal,onProgress=()=>{}}={}){
 const urls=new Map();let index=0
 for(const item of archive.descriptors.values()){
  stopped(signal);onProgress('导入素材 '+(++index)+' / '+archive.descriptors.size)
  const bytes=await archive.read(item.path,item.sha256),url=await upload(new Blob([bytes],{type:item.mimeType}),item)
  if(!/^\/api\/media\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(url))throw Error('素材上传结果无效，原画布未改动')
  urls.set(item.path,url)
 }
 stopped(signal)
 const snapshot=structuredClone(archive.snapshot)
 for(const record of Object.values(snapshot.store)){
  if(record.typeName==='asset'&&record.props?.src){
   const item=archive.descriptors.get(record.props.src)
   record.props={...record.props,src:urls.get(record.props.src),mimeType:item.mimeType,fileSize:item.size}
  }
  // A restored bitmap remains the same bytes, but its old project's job/history
  // identity must never be submitted as the current project's active source.
  if(record.typeName==='shape'&&record.meta?.studioHistoryId){
   record.meta={...record.meta,hamokiArchiveOrigin:record.meta.hamokiArchiveOrigin||{historyId:record.meta.studioHistoryId,projectId:record.meta.studioProjectId||archive.manifest.sourceProjectId||null}}
   delete record.meta.studioHistoryId
   delete record.meta.studioProjectId
  }
 }
 return snapshot
}

'use strict';
// Small ZIP writer for offline image export. Uses STORE to avoid transcoding PNG/JPEG/WebP.
let table;function crc32(buf,previous=0){if(!table){table=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0})}let c=(previous^0xffffffff)>>>0;for(const byte of buf)c=table[(c^byte)&255]^(c>>>8);return (c^0xffffffff)>>>0}
function pack(files){const locals=[],central=[];let offset=0;for(const f of files){const name=Buffer.from(f.name.replace(/[^\w.()-]/g,'_'),'utf8');const bytes=f.bytes;const checksum=crc32(bytes);const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt32LE(checksum,14);h.writeUInt32LE(bytes.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(name.length,26);locals.push(h,name,bytes);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt32LE(checksum,16);c.writeUInt32LE(bytes.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);central.push(c,name);offset+=h.length+name.length+bytes.length;}const center=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(center.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,center,end])}

// Streaming STORE archives keep the existing in-memory pack() behavior intact.
function descriptions(files){
 if(files.length>65535)throw Error('Too many ZIP entries');
 const names=new Set();let offset=0,centralSize=0;
 const entries=files.map(file=>{
  const text=String(file.name),name=Buffer.from(text,'utf8');
  if(!text||text.includes('\\')||/^[A-Za-z]:/.test(text)||text.split('/').some(p=>!p||p==='.'||p==='..')||/[\x00-\x1f\x7f]/.test(text)||name.length>65535||names.has(text))throw Error('Invalid ZIP entry name');
  if(!Number.isInteger(file.size)||file.size<0||file.size>0xffffffff||!Number.isInteger(file.crc32)||file.crc32<0||file.crc32>0xffffffff||typeof file.open!=='function')throw Error('Invalid ZIP entry metadata');
  names.add(text);const entry={...file,name,offset};offset+=30+name.length+file.size;centralSize+=46+name.length;
  if(offset+centralSize+22>0xffffffff)throw Error('ZIP64 is not supported');return entry;
 });
 return {entries,offset,centralSize,length:offset+centralSize+22};
}
function byteLength(files){return descriptions(files).length;}
async function* streamFiles(files){
 const info=descriptions(files);
 for(const entry of info.entries){
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(33,12);h.writeUInt32LE(entry.crc32,14);h.writeUInt32LE(entry.size,18);h.writeUInt32LE(entry.size,22);h.writeUInt16LE(entry.name.length,26);
  yield h;yield entry.name;
  let size=0,crc=0;
  for await(const chunk of entry.open()){size+=chunk.length;if(size>entry.size)throw Error('ZIP source changed');crc=crc32(chunk,crc);yield chunk;}
  if(size!==entry.size||crc!==entry.crc32)throw Error('ZIP source changed');
 }
 for(const entry of info.entries){
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(33,14);c.writeUInt32LE(entry.crc32,16);c.writeUInt32LE(entry.size,20);c.writeUInt32LE(entry.size,24);c.writeUInt16LE(entry.name.length,28);c.writeUInt32LE(entry.offset,42);yield c;yield entry.name;
 }
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(info.entries.length,8);end.writeUInt16LE(info.entries.length,10);end.writeUInt32LE(info.centralSize,12);end.writeUInt32LE(info.offset,16);yield end;
}
module.exports={pack,crc32,streamFiles,byteLength};

'use strict';
// Private Word-to-design-input extraction. The source DOCX is not published.
const mammoth=require('mammoth');
const JSZip=require('jszip');
const crypto=require('node:crypto');
const MAX_DOCX=12*1024*1024;
const MAX_IMAGE=8*1024*1024;
const VALID_MIME=new Set(['image/png','image/jpeg','image/webp']);
const decode=s=>String(s||'').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,k)=>{
 if(k[0]==='#'){const code=k[1].toLowerCase()==='x'?parseInt(k.slice(2),16):parseInt(k.slice(1),10);return Number.isInteger(code)&&code>0&&code<0x110000?String.fromCodePoint(code):''}
 return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[k.toLowerCase()]||''
});
function textFromHTML(html){
 const out=[],tokens=String(html).match(/<[^>]*>|[^<]+/g)||[];
 let buffer='',heading=0;
 function flush(){const t=buffer.replace(/[ \t]+/g,' ').replace(/\n[ \t]*\n/g,'\n').trim();if(t)out.push({kind:'text',text:t.slice(0,1800),...(heading?{level:heading}:{})});buffer=''}
 for(const part of tokens){
  if(/^<h([1-6])\b/i.test(part)){flush();heading=Number(part[2]);continue}
  if(/^<img\b/i.test(part)){flush();const m=part.match(/\bsrc=["']hamoki-embedded-(\d+)["']/i);if(m)out.push({kind:'image',index:Number(m[1])});continue}
  if(/^<\/(?:p|h[1-6]|li|tr|table)>/i.test(part)){flush();if(/^<\/h[1-6]>/i.test(part))heading=0;continue}
  if(/^<(?:br|td|th)\b|^<\/(?:td|th)>/i.test(part)){buffer+=' ';continue}
  if(!part.startsWith('<'))buffer+=decode(part);
 }
 flush();
 return out.slice(0,1200);
}
async function parseDocx(bytes,storeImage){
 if(!Buffer.isBuffer(bytes)||bytes.length<100||bytes.length>MAX_DOCX)throw Error('Word 文件限制为 12MB，请压缩图片后重试');
 if(bytes.readUInt32LE(0)!==0x04034b50)throw Error('不是有效的 .docx 文件（需要 Word 2007 及更新格式）');
 // Preflight decompressed archive sizes before rendering content to prevent ZIP bombs.
 let zip;
 try{zip=await JSZip.loadAsync(bytes,{checkCRC32:false})}catch{throw Error('Word 压缩包内容损坏或无法读取')}
 const files=Object.values(zip.files);
 if(files.length>600)throw Error('Word 内部文件数量异常，超过安全限制');
 let expanded=0;
 for(const item of files){
  if(item.dir)continue;
  const size=Number(item._data?.uncompressedSize);
  if(!Number.isSafeInteger(size)||size<0||size>32*1024*1024)throw Error('Word 内部文件过大，请压缩文档');
  expanded+=size;if(expanded>80*1024*1024)throw Error('Word 解压后的数据超过 80MB 安全限制');
 }
 const images=[];const saved=[];
 let converted;
 try{converted=await mammoth.convertToHtml({buffer:bytes},{convertImage:mammoth.images.imgElement(async img=>{
  if(!VALID_MIME.has(img.contentType)||images.length>=20)return {src:''};
  const b64=await img.read('base64');
  if(b64.length>MAX_IMAGE*1.4)return {src:''};
  const data=Buffer.from(b64,'base64');
  if(!data.length||data.length>MAX_IMAGE)return {src:''};
  const file=storeImage({mime:img.contentType,bytes:data});
  const index=images.length;images.push({index,file,mime:img.contentType,size:data.length});
  saved.push(file);
  return {src:'hamoki-embedded-'+index};
 })});
 }catch(e){if(e instanceof TypeError||/Cannot read properties of undefined/.test(String(e.message)))throw Error('Word 内部结构不完整。请在 Word 或 WPS 中重新另存为 .docx 后上传');throw e}
 const blocks=textFromHTML(converted.value);
 const text=blocks.filter(x=>x.kind==='text').map(x=>x.text).join('\n').slice(0,55000);
 if(!text.trim()&&!images.length)throw Error('未找到可读取的文字或原型图片，请确认不是纯扫描文件');
 return {text,blocks,images,hash:crypto.createHash('sha256').update(bytes).digest('hex'),warnings:(converted.messages||[]).filter(x=>x.type==='warning').slice(0,8).map(x=>String(x.message).slice(0,160))};
}
module.exports={parseDocx,textFromHTML,MAX_DOCX};

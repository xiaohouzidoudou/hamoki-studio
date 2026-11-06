/* Hamoki Studio shared image clipboard bridge. Never puts API keys or private node data on the OS clipboard. */
'use strict';
(() => {
  let lastCopy = null;
  const ageLimitMs = 5 * 60 * 1000;
  const isEditable = target => !!target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
  async function pngBlob(url) {
    const response = await fetch(url,{credentials:'same-origin'});
    if (!response.ok) throw Error('读取原图失败 (HTTP '+response.status+')');
    const file = await response.blob();
    if (file.type === 'image/png') return file;
    const bitmap = await createImageBitmap(file);
    try {
      const canvas=document.createElement('canvas');
      canvas.width=bitmap.width;canvas.height=bitmap.height;
      if (!canvas.width||!canvas.height||canvas.width*canvas.height>60_000_000) throw Error('图片尺寸过大，无法写入图片剪贴板');
      const context=canvas.getContext('2d');
      if (!context) throw Error('当前浏览器无法处理图片');
      context.drawImage(bitmap,0,0);
      const result=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('PNG 转换失败')),'image/png'));
      return result;
    } finally {bitmap.close();}
  }
  async function digest(file) {
    const bytes=await file.arrayBuffer();
    const hash=await crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function pixelDigest(file) {
    const bitmap=await createImageBitmap(file);
    try {
      if (bitmap.width*bitmap.height>60_000_000) return null;
      const canvas=document.createElement('canvas');
      canvas.width=bitmap.width;canvas.height=bitmap.height;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx)return null;
      ctx.drawImage(bitmap,0,0);
      const pixels=ctx.getImageData(0,0,bitmap.width,bitmap.height).data;
      const hash=await crypto.subtle.digest('SHA-256',pixels);
      return bitmap.width+'x'+bitmap.height+':'+Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,'0')).join('');
    }finally{bitmap.close();}
  }
  function sameProject(record,projectId) {
    return record && record.projectId===projectId && Date.now()-record.time<ageLimitMs;
  }
  async function copy(url,metadata) {
    if (!url) throw Error('当前图片没有可复制的原图');
    const record={...metadata,time:Date.now(),internalOnly:false,sha256:null};
    lastCopy=record;
    const pending=pngBlob(url);
    record.pngBlob=pending;
    const proof=pending.then(digest).then(sha=>{record.sha256=sha;return sha});
    record.proof=proof.catch(()=>null);
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem==='undefined')
        throw Error('当前浏览器不允许写入系统图片剪贴板');
      // Construct the ClipboardItem synchronously during the Ctrl+C gesture.
      await navigator.clipboard.write([new ClipboardItem({'image/png':pending})]);
      void record.proof;
      return {system:true};
    } catch(error) {
      record.internalOnly=true;
      void pending.catch(()=>{});
      return {system:false,error:String(error?.message||error)};
    }
  }
  async function match(file,projectId) {
    const record=lastCopy;
    if (!sameProject(record,projectId)||!file||file.type!=='image/png') return null;
    const reference=await record.proof;
    if (!reference) return null;
    try {
      if(await digest(file)===reference)return record;
      // Chromium/Windows sometimes re-encodes PNG data when round-tripping
      // through the native clipboard. Check the actual pixels as a fallback.
      const [sourcePixels,pastedPixels]=await Promise.all([
        pixelDigest(await record.pngBlob),pixelDigest(file)
      ]);
      return sourcePixels&&sourcePixels===pastedPixels?record:null;
    }
    catch {return null;}
  }
  function fallback(projectId,items) {
    const record=lastCopy;
    return sameProject(record,projectId)&&record.internalOnly&&(!items||!items.length)?record:null;
  }
  // If another copy happens in the same document, our last image is no longer the clipboard source.
  document.addEventListener('copy',event=>{
    if (isEditable(event.target)||(!event.target?.closest?.('.canvas-node,.flow-node')&&document.getSelection()?.toString())) lastCopy=null;
  });
  window.HamokiImageClipboard={copy,match,fallback,isEditable};
})();

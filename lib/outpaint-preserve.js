/* Restore the unchanged source rectangle after an AI masked outpaint.
   Some image providers subtly redraw unmasked pixels; this final, local step
   guarantees the original remains pixel-identical within the planned inset. */
'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');

function checkRect(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('扩图坐标缺失');
  const fields=['width','height','x','y','w','h'];
  const nums={};
  for(const name of fields){
    if(!Number.isInteger(value[name]))throw Error('扩图坐标不合法：'+name);
    nums[name]=value[name];
  }
  const {width,height,x,y,w,h}=nums;
  if(width<1||height<1||width>4096||height>4096||
     width*height>3840*2160||x<0||y<0||w<1||h<1||
     x+w>width||y+h>height||(x===0&&y===0&&w===width&&h===height))
    throw Error('扩图原图位置超出目标画布');
  return nums;
}
async function preserveOutpaint(generated,source,metadata){
  const box=checkRect(metadata);
  if(!generated?.bytes||!source?.bytes)throw Error('扩图原图或输出文件缺失');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-outpaint-'));
  const file=name=>path.join(tmp,name);
  const inp=file('generated.img'),orig=file('masked-original.png'),out=file('preserved.png');
  try{
    fs.writeFileSync(inp,generated.bytes,{mode:0o600});
    fs.writeFileSync(orig,source.bytes,{mode:0o600});
    const interpreter=process.env.STUDIO_PYTHON||(process.platform==='win32'?'python':'python3');
    await new Promise((resolve,reject)=>{
      const child=spawn(interpreter,[path.join(__dirname,'outpaint-preserve.py'),inp,orig,out,JSON.stringify(box)],{
        windowsHide:true,stdio:['ignore','ignore','pipe']
      });
      let errors='',settled=false;
      const fail=error=>{if(!settled){settled=true;clearTimeout(timer);reject(error)}};
      const timer=setTimeout(()=>{child.kill();fail(Error('扩图原图无损合成超时'))},60000);
      child.stderr.on('data',chunk=>{errors=(errors+String(chunk)).slice(-600)});
      child.once('error',fail);
      child.once('close',code=>{
        if(settled)return;
        settled=true;clearTimeout(timer);
        code===0?resolve():reject(Error('扩图合成失败：'+(errors.trim()||code).slice(0,160)));
      });
    });
    const bytes=fs.readFileSync(out);
    if(!bytes.length)throw Error('扩图合成返回空图片');
    return {mime:'image/png',bytes};
  }finally{
    fs.rmSync(tmp,{recursive:true,force:true});
  }
}
module.exports={checkRect,preserveOutpaint};

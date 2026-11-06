'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const {checkRect,preserveOutpaint}=require('../lib/outpaint-preserve');
const studio=fs.readFileSync(require.resolve('../studio-v2.js'),'utf8');
const backend=fs.readFileSync(require.resolve('../server.js'),'utf8');

test('outpaint request sends mask plus padded original through existing jobs',()=>{
 assert.match(studio,/mask:config\.mask,maskSourceImage:config\.maskSourceImage/);
 assert.match(studio,/outpaintRect:config\.outpaintRect/);
 assert.match(backend,/outpaintRect:b\.outpaintRect\|\|null/);
 assert.match(backend,/preserveOutpaint\(/);
});
test('reject invalid rectangles before paid work is queued',()=>{
 assert.throws(()=>checkRect({width:1024,height:1024,x:0,y:0,w:1024,h:1024}),/原图位置/);
 assert.throws(()=>checkRect({width:1024,height:1024,x:500,y:0,w:600,h:500}),/原图位置/);
 assert.deepEqual(checkRect({width:1024,height:1024,x:0,y:0,w:600,h:1024}),
  {width:1024,height:1024,x:0,y:0,w:600,h:1024});
});
test('masked outpaint preserves original region pixel-for-pixel',async t=>{
 const py=process.env.STUDIO_PYTHON||'python3';
 const probe=spawnSync(py,['-c','from PIL import Image'],{encoding:'utf8'});
 if(probe.status!==0){t.skip('Pillow is unavailable outside production image');return;}
 const generated=spawnSync(py,['-c',"from PIL import Image; import sys; Image.new('RGBA',(64,48),(21,41,200,255)).save(sys.stdout.buffer,'PNG')"],{encoding:null,maxBuffer:1024*1024});
 const source=spawnSync(py,['-c',"from PIL import Image; import sys; im=Image.new('RGBA',(64,48),(0,0,0,0)); im.paste((224,42,12,255),(0,0,32,48)); im.save(sys.stdout.buffer,'PNG')"],{encoding:null,maxBuffer:1024*1024});
 assert.equal(generated.status,0);assert.equal(source.status,0);
 const result=await preserveOutpaint({mime:'image/png',bytes:generated.stdout},
   {mime:'image/png',bytes:source.stdout},{width:64,height:48,x:0,y:0,w:32,h:48});
 const verification=spawnSync(py,['-c',"from PIL import Image; import io,sys; im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGBA'); assert im.size==(64,48); assert im.getpixel((10,20))==(224,42,12,255); assert im.getpixel((50,20))==(21,41,200,255)"],{input:result.bytes,encoding:null});
 assert.equal(verification.status,0,String(verification.stderr));
});

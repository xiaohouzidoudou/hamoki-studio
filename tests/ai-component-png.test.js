'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync,spawnSync}=require('node:child_process');
const path=require('node:path');
const normalizer=path.join(__dirname,'../lib/component-png.py');
function picture(kind){
 const source=[
 'import sys,io',
 'from PIL import Image,ImageDraw',
 'kind=sys.argv[1]',
 'im=Image.new("RGBA" if kind=="alpha" else "RGB",(96,64),(243,243,243,0) if kind=="alpha" else (242,242,242))',
 'draw=ImageDraw.Draw(im)',
 'draw.rectangle((27,12,69,53),fill=(194,23,23,255) if kind=="alpha" else (194,23,23))',
 'if kind=="busy": im.putpixel((0,0),(1,2,3)); im.putpixel((95,63),(255,127,60))',
 'out=io.BytesIO();im.save(out,format="PNG");sys.stdout.buffer.write(out.getvalue())'
 ].join('\n');
 return execFileSync('python3',['-c',source,kind]);
}
test('normalizer makes isolated flat-background icon into transparent PNG',()=>{
 const r=spawnSync('python3',[normalizer],{input:picture('flat')});
 assert.equal(r.status,0,String(r.stderr));
 assert.match(String(r.stderr),/TRANSPARENT=1/);
 assert.deepEqual([...r.stdout.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 const source='import sys,io;from PIL import Image;im=Image.open(io.BytesIO(sys.stdin.buffer.read()));print(im.getpixel((0,0))[3],im.getpixel((48,33))[3])';
 const alpha=execFileSync('python3',['-c',source],{input:r.stdout}).toString().trim();
 assert.equal(alpha,'0 255');
});
test('already transparent image preserves alpha',()=>{
 const r=spawnSync('python3',[normalizer],{input:picture('alpha')});
 assert.equal(r.status,0,String(r.stderr));
 assert.match(String(r.stderr),/TRANSPARENT=1/);
});
test('busy opaque background not mislabeled transparent',()=>{
 const r=spawnSync('python3',[normalizer],{input:picture('busy')});
 assert.equal(r.status,0,String(r.stderr));
 assert.match(String(r.stderr),/TRANSPARENT=0/);
});
test('UI and backend expose one-image analysis, approved batch, retry and results',()=>{
 const fs=require('node:fs');
 const root=path.join(__dirname,'..');
 const backend=fs.readFileSync(path.join(root,'workspace.js'),'utf8');
 const client=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 for(const key of ['componentAnalyze','componentGenerate','componentGenerateAll','componentAutoContinue','confirmCost','componentTransparent','componentItemId'])assert.ok(backend.includes(key),key);
 assert.match(client,/generateAllSmartComponents/);
 assert.match(client,/downloadSmartComponents/);
 assert.match(html,/id="smartComponentGenerateAll"/);
});



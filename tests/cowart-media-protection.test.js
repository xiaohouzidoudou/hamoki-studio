'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {protectedCanvasMedia}=require('../lib/cowart-media-protection');

test('读取全部已保存画布引用，不接受外部 URL 或路径穿越',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cowart-media-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 assert.equal(protectedCanvasMedia(dir).size,0);
 const folder=path.join(dir,'cowart-canvas');fs.mkdirSync(folder);
 const a=crypto.randomUUID()+'.png',b=crypto.randomUUID()+'.webp';
 const write=sources=>fs.writeFileSync(path.join(folder,crypto.randomUUID()+'.json'),JSON.stringify({snapshot:{store:Object.fromEntries(sources.map((src,i)=>['asset:'+i,{typeName:'asset',type:'image',props:{src}}]))}}));
 write(['/api/media/'+a,'https://external.invalid/api/media/'+b,'/api/media/../'+b]);
 write(['/api/media/'+b,'/api/media/'+a,'data:image/png;base64,AAAA']);
 assert.deepEqual([...protectedCanvasMedia(dir)].sort(),[a,b].sort());
 // A damaged snapshot must stop cleanup rather than silently losing protection.
 const bad=path.join(folder,crypto.randomUUID()+'.json');fs.writeFileSync(bad,'{broken');
 assert.throws(()=>protectedCanvasMedia(dir),error=>error.status===503);
 fs.writeFileSync(bad,JSON.stringify({snapshot:{store:null}}));
 assert.throws(()=>protectedCanvasMedia(dir),error=>error.status===503);
});

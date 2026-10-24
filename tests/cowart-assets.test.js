'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {storeAsset}=require('../lib/cowart-assets');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==','base64');

async function start(t,overrides={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cowart-upload-'));
 const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;await new Promise(r=>server.close(r));
 let child;
 async function launch(){
  child=spawn(process.execPath,[path.join(__dirname,'../gateway.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',APP_ALLOWED_HOST:'ps.test',APP_ENCRYPTION_KEY:'cowart-upload-test-only-12345678901234567890',INVITE_CODE:'local',COOKIE_SECURE:'0',NODE_ENV:'test',COWART_PREVIEW:'1',...overrides},stdio:['ignore','pipe','pipe']});
  let logs='';for(const s of [child.stdout,child.stderr])s.on('data',b=>logs+=b);
  for(let i=0;i<150;i++){
   if(logs.includes('account gateway ready'))return;
   if(child.exitCode!==null)throw Error(logs);
   await new Promise(r=>setTimeout(r,30));
  }
  throw Error('Gateway did not start: '+logs);
 }
 async function stop(){if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done}}
 await launch();
 t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true})});
 function client(){let cookie='';return async(api,method='GET',body,headers={})=>{
  const bytes=body===undefined?null:Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
  return new Promise((resolve,reject)=>{
   const req=http.request({hostname:'127.0.0.1',port,path:api,method,headers:{Host:'ps.test',...(cookie?{Cookie:cookie}:{}),...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{}),...headers}},res=>{
    const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{
     if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];
     const raw=Buffer.concat(chunks);resolve({status:res.statusCode,body:(res.headers['content-type']||'').includes('json')?JSON.parse(raw):raw});
    });
   });req.on('error',reject);req.end(bytes);
  });
 }}
 return {dir,client,restart:async()=>{await stop();await launch()}};
}

test('Cowart 图片上传鉴权、项目隔离、去重、重启及输入边界',async t=>{
 const app=await start(t),a=app.client(),b=app.client(),guest=app.client();
 const api='/api/cowart/assets?projectId=';
 assert.equal((await guest(api+'123','POST',png,{'Content-Type':'image/png'})).status,401);
 for(const [request,username] of [[a,'uploada'],[b,'uploadb']])assert.equal((await request('/api/register','POST',{username,password:'password123',inviteCode:'local'})).status,201);
 const pa=(await a('/api/projects')).body.defaultId,pb=(await b('/api/projects')).body.defaultId;
 const upload=(request,id,bytes=png,extra={})=>request(api+id,'POST',bytes,{'Content-Type':'image/png',...extra});
 assert.equal((await upload(a,pb)).status,404);
 assert.equal((await upload(a,pa,png,{Origin:'https://evil.invalid'})).status,403);
 assert.equal((await upload(a,pa,png,{'Content-Type':'text/plain'})).status,415);
 assert.equal((await upload(a,pa,Buffer.from('not image'))).status,400);
 const first=await upload(a,pa);assert.equal(first.status,201,JSON.stringify(first.body));
 assert.match(first.body.url,/^\/api\/media\/[a-f0-9-]{36}\.png$/);
 const duplicate=await upload(a,pa);assert.equal(duplicate.status,200);assert.equal(duplicate.body.url,first.body.url);
 assert.deepEqual((await a(first.body.url)).body,png);
 assert.equal((await b(first.body.url)).status,404);
 const other=await upload(b,pb);assert.equal(other.status,201);assert.notEqual(other.body.url,first.body.url);
 assert.equal((await upload(a,pa,Buffer.concat([png,Buffer.alloc(12*1024*1024)]))).status,413);
 await app.restart();
 assert.equal((await upload(a,pa)).body.url,first.body.url,'服务重启后复用同一原图');
 assert.equal((await a('/api/storage')).body.originalCount,1);
});

for(const limits of [{USER_QUOTA_GB:'.002',TOTAL_QUOTA_GB:'.01'},{USER_QUOTA_GB:'.01',TOTAL_QUOTA_GB:'.002'}])test('Cowart 上传超额直接拒绝，不清理已有图片：'+JSON.stringify(limits),async t=>{
 const app=await start(t,limits),a=app.client();
 await a('/api/register','POST',{username:'quotauser',password:'password123',inviteCode:'local'});
 const project=(await a('/api/projects')).body.defaultId,api='/api/cowart/assets?projectId='+project;
 const first=await a(api,'POST',png,{'Content-Type':'image/png'});assert.equal(first.status,201);
 const large=Buffer.concat([png,Buffer.alloc(2_200_000)]);
 const denied=await a(api,'POST',large,{'Content-Type':'image/png'});assert.equal(denied.status,413);
 assert.deepEqual((await a(first.body.url)).body,png);
 assert.equal((await a('/api/storage')).body.originalCount,1);
});

test('Cowart 索引写入失败清理本次新文件，旧文件不受影响',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cowart-index-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const first=storeAsset(dir,{bytes:png,mime:'image/png'},()=>{});
 const before=fs.readdirSync(path.join(dir,'media'));
 const originalRename=fs.renameSync;
 try{
  fs.renameSync=()=>{throw Error('模拟索引落盘失败')};
  assert.throws(()=>storeAsset(dir,{bytes:Buffer.concat([png,Buffer.from('different')]),mime:'image/png'},()=>{}),/落盘失败/);
 }finally{fs.renameSync=originalRename}
 assert.deepEqual(fs.readdirSync(path.join(dir,'media')),before);
 assert.equal(storeAsset(dir,{bytes:png,mime:'image/png'},()=>{}).url,first.url);
 assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.tmp')).length,0);
 fs.unlinkSync(path.join(dir,'media',first.url.split('/').pop()));
 const repaired=storeAsset(dir,{bytes:png,mime:'image/png'},()=>{});
 assert.notEqual(repaired.url,first.url,'缺失文件不得返回失效的去重 URL');
 fs.writeFileSync(path.join(dir,'cowart-assets.json'),'{broken');
 assert.throws(()=>storeAsset(dir,{bytes:png,mime:'image/png'},()=>{}),error=>error.status===503);
});

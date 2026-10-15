'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),net=require('node:net');
const pause=n=>new Promise(r=>setTimeout(r,n));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
test('Docker health check honors the deployed base path',()=>{
 const dockerfile=fs.readFileSync(path.join(__dirname,'../Dockerfile'),'utf8');
 assert.ok(dockerfile.includes("(process.env.APP_BASE_PATH||'')+'/healthz'"));
});
test('account gateway supports authenticated /studio/ preview without leaking APIs at root',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-prefix-'));
 const p=await port();
 const child=spawn(process.execPath,[path.join(__dirname,'..','gateway.js')],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(p),DATA_DIR:dir,HOST:'127.0.0.1',APP_ALLOWED_HOST:'dev.test',APP_BASE_PATH:'/studio',INVITE_CODE:'prefix-invite',COOKIE_SECURE:'1',APP_ENCRYPTION_KEY:'local-test-gateway-prefix-only-key-2026',NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 t.after(async()=>{child.kill();await pause(250);fs.rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:100})});
 for(let i=0;i<80&&!log.includes('account gateway ready');i++)await pause(65);
 assert.match(log,/account gateway ready/);
 let cookie='';
 async function query(pth,method='GET',body){
  const payload=body?Buffer.from(JSON.stringify(body)):null;
  return new Promise((resolve,reject)=>{
   const q=http.request({hostname:'127.0.0.1',port:p,path:pth,method,headers:{Host:'dev.test',...(cookie?{Cookie:cookie}:{}),...(payload?{'Content-Type':'application/json','Content-Length':payload.length,Origin:'https://dev.test'}:{})}},res=>{
    const parts=[];res.on('data',b=>parts.push(b));res.on('end',()=>{const raw=Buffer.concat(parts).toString('utf8');if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];resolve({status:res.statusCode,headers:res.headers,body:raw.startsWith('{')?JSON.parse(raw):raw})});
   });q.on('error',reject);q.end(payload);
  });
 }
 assert.equal((await query('/api/status')).status,404);
 assert.equal((await query('/studio')).status,308);
 const status=await query('/studio/api/status');
 assert.equal(status.status,200);assert.equal(status.body.basePath,'/studio');assert.equal(status.body.authenticated,false);
 const root=await query('/studio/');
 assert.equal(root.status,200);assert.match(root.body,/Hamoki Studio/);
 assert.equal((await query('/studio/assets/app.js')).status,200);
 const reg=await query('/studio/api/register','POST',{username:'prefixdemo',password:'testpass99',inviteCode:'prefix-invite'});
 assert.equal(reg.status,201,JSON.stringify(reg.body));
 assert.match(reg.headers['set-cookie'][0],/Path=\/studio\//);
 const after=await query('/studio/api/status');
 assert.equal(after.body.authenticated,true);
 assert.equal((await query('/studio/api/projects')).status,200);
 assert.equal((await query('/api/projects')).status,404);
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync,readFileSync,existsSync}=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const net=require('node:net');
const wait=t=>new Promise(r=>setTimeout(r,t));
async function getPort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port}
async function start(port,dir,overrides={}){
 const child=spawn(process.execPath,[path.join(__dirname,'..','gateway.js')],{cwd:path.join(__dirname,'..'),env:{...process.env,DATA_DIR:dir,APP_ALLOWED_HOST:'ps.test',APP_ENCRYPTION_KEY:'hamoki-test-master-key-long-and-not-real-secret',INVITE_CODE:'hamoki',HOST:'127.0.0.1',PORT:String(port),COOKIE_SECURE:'1',NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1',USER_QUOTA_GB:'.005',TOTAL_QUOTA_GB:'.003',...overrides},stdio:['ignore','pipe','pipe']});
 let buf='';child.stdout.on('data',c=>buf+=c);child.stderr.on('data',c=>buf+=c);
 for(let i=0;i<130;i++){if(buf.includes('account gateway ready'))return child;if(child.exitCode!==null)throw Error('Exited: '+buf);await wait(35)}child.kill();throw Error('Gateway did not start: '+buf);
}
function makeClient(port){
 let cookie='';return {get cookie(){return cookie},set cookie(value){cookie=value},async request(url,method='GET',payload,origin){
  const input=payload===undefined?undefined:Buffer.from(JSON.stringify(payload));
  return await new Promise((resolve,reject)=>{
   const req=http.request({host:'127.0.0.1',port,path:url,method,headers:{Host:'ps.test',...(cookie?{Cookie:cookie}:{}),...(input?{'Content-Type':'application/json','Content-Length':input.length}:{}),...(origin?{Origin:origin}:{})}},res=>{
    const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{
     const raw=Buffer.concat(chunks);const ct=res.headers['content-type']||'';
     let body;try{body=ct.includes('json')?JSON.parse(raw.toString()):raw}catch{body=raw}
     if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];
     resolve({status:res.statusCode,body,headers:res.headers});
    });
   });req.on('error',reject);req.end(input);
  });
 }};
}
const invite={inviteCode:'hamoki'};
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==','base64');
const fakeImg=size=>'data:image/png;base64,'+Buffer.concat([PNG,Buffer.alloc(size-PNG.length)]).toString('base64');

test('V0.6.3 logs capture server API errors and redact secrets per account',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'hamoki-v063-logs-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const port=await getPort();const child=await start(port,dir);t.after(()=>child.kill());
 const a=makeClient(port),b=makeClient(port),guest=makeClient(port);
 assert.equal((await guest.request('/api/logs')).status,401);
 assert.equal((await a.request('/api/register','POST',{...invite,username:'alice',password:'Apassword12'})).status,201);
 assert.equal((await b.request('/api/register','POST',{...invite,username:'bob',password:'Bpassword12'})).status,201);
 assert.deepEqual((await a.request('/api/logs')).body.logs,[]);
 assert.equal((await a.request('/api/models')).status,400); // no provider -> recorded in server diagnostics
 const serverLogs=(await a.request('/api/logs')).body.logs;
 assert.equal(serverLogs.length,1,JSON.stringify(serverLogs));
 assert.equal(serverLogs[0].source,'backend');assert.equal(serverLogs[0].path,'/api/models');
 assert.equal((await b.request('/api/logs')).body.logs.length,0);
 const secret='sk-TESTTOKEN1234567890';
 const posted=await a.request('/api/logs','POST',{source:'browser',action:'request_failed',method:'GET',path:'/api/models?token=very_secret',status:401,message:`Authorization: Bearer ${secret} https://example.com/v1?api_key=${secret} data:image/png;base64,`+'A'.repeat(128)});
 assert.equal(posted.status,201);
 const logs=(await a.request('/api/logs')).body.logs;
 assert.equal(logs.length,2);assert.equal(logs[0].source,'browser');
 assert.equal(logs[0].path,'/api/models');
 const serialized=JSON.stringify(logs);
 assert.doesNotMatch(serialized,/sk-TESTTOKEN|very_secret|Bearer sk-|base64,AAAAAAA/);
 assert.match(serialized,/redacted/);
 assert.equal((await b.request('/api/logs')).body.logs.length,0);
 assert.equal((await a.request('/api/logs','POST',{message:'evil'},'https://evil.example')).status,403);
 assert.equal((await a.request('/api/logs','DELETE')).status,200);
 assert.equal((await a.request('/api/logs')).body.logs.length,0);
 assert.equal((await b.request('/api/logs')).body.logs.length,0);
});

test('V0.6.3 5GB global/1GB account quota cleanup deletes only uploading user oldest assets',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'hamoki-v063-quota-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const port=await getPort();const child=await start(port,dir);t.after(()=>child.kill());
 const a=makeClient(port),b=makeClient(port);
 for(const [client,user] of [[a,'alpha'],[b,'beta']])assert.equal((await client.request('/api/register','POST',{...invite,username:user,password:'password123'})).status,201);
 const aProject=(await a.request('/api/projects')).body.projects[0].id;
 const bProject=(await b.request('/api/projects')).body.projects[0].id;
 const p1=await a.request(`/api/projects/${aProject}/assets`,'POST',{image:fakeImg(1_500_000),name:'alpha-priority.png'});
 assert.equal(p1.status,201,JSON.stringify(p1.body).slice(0,300));
 const p2=await b.request(`/api/projects/${bProject}/assets`,'POST',{image:fakeImg(1_500_000),name:'beta-old.png'});
 assert.equal(p2.status,201,JSON.stringify(p2.body).slice(0,300));
 const oldFile=p2.body.node.url;
 assert.equal((await b.request(oldFile)).status,200);
 const p3=await b.request(`/api/projects/${bProject}/assets`,'POST',{image:fakeImg(600_000),name:'beta-new.png'});
 assert.equal(p3.status,201,JSON.stringify(p3.body).slice(0,300));
 assert.equal((await a.request(p1.body.node.url)).status,200,'other users original must survive global cleanup');
 assert.equal((await b.request(p3.body.node.url)).status,200);
 assert.equal((await b.request(oldFile)).status,404,'oldest own asset must be cleaned');
 assert.equal((await b.request(`/api/projects/${bProject}`)).body.project.nodes.length,1,'deleted media must be removed from canvas');
 assert.ok((await b.request('/api/logs')).body.logs.some(x=>x.action==='auto_cleanup'));
 assert.equal((await a.request('/api/logs')).body.logs.length,0);
 const total=(await a.request('/api/status')).body.user.quota.currentTotalBytes;
 assert.ok(total<(0.003*1024**3),`global bytes ${total} exceeded testing cap`);
});

test('V0.6.3 logs upstream failures even when probes return HTTP 200 and jobs fail asynchronously',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'hamoki-v063-upstream-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const port=await getPort();const child=await start(port,dir);t.after(()=>child.kill());
 const a=makeClient(port);
 assert.equal((await a.request('/api/register','POST',{...invite,username:'diagnose',password:'password123'})).status,201);
 const mock=http.createServer(async(req,res)=>{
  for await(const _ of req){}
  res.writeHead(400,{'Content-Type':'application/json'});
  res.end(JSON.stringify({error:{message:'upstream model unavailable'}}));
 });
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));t.after(()=>mock.close());
 const endpoint=`http://127.0.0.1:${mock.address().port}/v1`;
 const provider=await a.request('/api/providers','POST',{name:'Mock upstream',url:endpoint,mode:'openai',imageMode:'images',imageModel:'gpt-image-1',visionModel:'gpt-4o-mini',apiKey:'sk-LOGTEST1234567890'});
 assert.equal(provider.status,201,JSON.stringify(provider.body));
 const pid=provider.body.provider.id;
 const checked=await a.request('/api/providers/draft/check','POST',{savedId:pid,url:endpoint,mode:'openai',baseOnly:true,capability:'image'});
 assert.equal(checked.status,200);assert.equal(checked.body.reachable,false);
 const probed=await a.request(`/api/providers/${pid}/probe`,'POST',{kind:'generate',confirmCost:true});
 assert.equal(probed.status,200);assert.equal(probed.body.success,false);
 const projectId=(await a.request('/api/projects')).body.projects[0].id;
 const submitted=await a.request('/api/jobs','POST',{projectId,providerId:pid,prompt:'A harmless fixture',ratio:'1:1',resolution:'1K',count:1});
 assert.equal(submitted.status,201);
 let failed=false;
 for(let i=0;i<120;i++){
  const response=await a.request(`/api/jobs?projectId=${projectId}`);
  if(response.body.jobs.some(j=>j.id===submitted.body.jobs[0].id&&j.status==='failed')){failed=true;break}
  await wait(35);
 }
 assert.ok(failed,'queued job should fail after mocked provider error');
 const logs=(await a.request('/api/logs')).body.logs;
 assert.ok(logs.some(x=>x.action==='check_models'));
 assert.ok(logs.some(x=>x.action==='probe_generate'));
 assert.ok(logs.some(x=>x.action==='image_generation'));
 const serialized=JSON.stringify(logs);
 assert.doesNotMatch(serialized,/sk-LOGTEST/);
 assert.match(serialized,/upstream model unavailable/);
});

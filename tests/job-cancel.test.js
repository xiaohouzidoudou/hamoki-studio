'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const http=require('node:http'),{spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==';
async function until(read){for(let i=0;i<160;i++){const value=await read();if(value)return value;await sleep(40)}throw Error('等待任务超时')}

test('真实适配器验证排队/运行取消、HTTP 拒绝、断线未知、无自动重发及重启',async t=>{
 const calls=new Map();let release;
 const upstream=http.createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;
  const payload=JSON.parse(body||'{}'),model=payload.model;
  calls.set(model,(calls.get(model)||0)+1);
  if(model==='slow'){await new Promise(r=>{release=r})}
  if(model==='drop'){req.socket.destroy();return}
  res.setHeader('Content-Type','application/json');
  if(model==='reject'||model==='limited'){
   res.statusCode=model==='reject'?400:429;res.setHeader('Retry-After','1');
   return res.end(JSON.stringify({error:{message:'模拟拒绝'}}));
  }
  res.end(JSON.stringify({data:[{b64_json:PNG}]}));
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 t.after(()=>{release?.();upstream.closeAllConnections();upstream.close()});
 const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cowart-cancel-'));let child;
 async function start(){
  child=spawn(process.execPath,[path.join(__dirname,'../gateway.js')],{env:{...process.env,APP_ENCRYPTION_KEY:'cancel-local-test-encryption-key-123456789012345',INVITE_CODE:'local',APP_ALLOWED_HOST:'127.0.0.1',COOKIE_SECURE:'0',PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>logs+=b);
  await until(()=>{if(child.exitCode!==null)throw Error(logs);return logs.includes('account gateway ready')});
 }
 async function stop(){if(child?.exitCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped}}
 t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true})});await start();
 let cookie='';
 async function api(route,method='GET',data){
  const response=await fetch('http://127.0.0.1:'+port+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});
  return {status:response.status,body:await response.json(),headers:response.headers};
 }
 async function login(){const response=await api('/api/login','POST',{username:'canceluser',password:'cancel-local-test-password'});assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0]}
 const registration=await api('/api/register','POST',{username:'canceluser',password:'cancel-local-test-password',inviteCode:'local'});assert.equal(registration.status,201);cookie=registration.headers.get('set-cookie').split(';')[0];
 const projectId=(await api('/api/projects')).body.defaultId;
 const providerId=(await api('/api/providers','POST',{name:'local',url:'http://127.0.0.1:'+upstream.address().port+'/v1',mode:'openai',imageMode:'images',imageModel:'good',apiKey:'local-test-only'})).body.provider.id;
 const submit=async model=>{const response=await api('/api/jobs','POST',{projectId,providerId,model,prompt:'测试',count:1,ratio:'1:1',resolution:'1K',autoRetry:false});assert.equal(response.status,201,JSON.stringify(response.body));return response.body.jobs[0]};
 const get=async id=>(await api('/api/jobs?projectId='+projectId)).body.jobs.find(j=>j.id===id);
 await api('/api/queue','POST',{action:'pause'});
 const queued=await submit('queued');
 const cancelled=await api('/api/jobs/'+queued.id+'/cancel','POST',{});
 assert.equal(cancelled.status,200);assert.equal(cancelled.body.job.requestOutcome,'not_sent');
 assert.equal((await api('/api/jobs/'+queued.id+'/cancel','POST',{})).status,200);
 await api('/api/queue','POST',{action:'resume'});await sleep(120);assert.equal(calls.has('queued'),false);
 const slow=await submit('slow');await until(()=>calls.get('slow')===1);
 const runningCancel=await api('/api/jobs/'+slow.id+'/cancel','POST',{});
 assert.equal(runningCancel.body.job.requestOutcome,'unknown');release();release=null;
 await sleep(150);assert.equal((await get(slow.id)).status,'cancelled');
 assert.equal((await api('/api/history?projectId='+projectId)).body.history.length,0);
 for(const model of ['reject','limited','drop']){
  const job=await submit(model);
  const failed=await until(async()=>{const j=await get(job.id);return j.status==='failed'?j:null});
  assert.equal(failed.requestOutcome,model==='drop'?'unknown':'http_rejected');
  assert.equal(failed.upstreamHttpStatus,model==='drop'?null:model==='limited'?429:400);
  assert.equal((await api('/api/jobs/'+job.id+'/retry','POST',{})).status,409,'不能静默再次付费');
 }
 await sleep(2200);assert.equal(calls.get('limited'),1,'Cowart 429 不自动重发');
 await api('/api/queue','POST',{action:'pause'});
 const asset=(await api('/api/projects/'+projectId+'/assets','POST',{image:'data:image/png;base64,'+PNG,name:'missing.png'})).body.node;
 const local=(await api('/api/jobs','POST',{projectId,providerId,model:'local-failure',prompt:'测试',count:1,ratio:'1:1',resolution:'1K',referenceNodes:[{nodeId:asset.id,role:'general'}],autoRetry:false})).body.jobs[0];
 const account=(await api('/api/status')).body.user.id;
 fs.unlinkSync(path.join(dir,'users',account,'media',asset.url.split('/').pop()));
 await api('/api/queue','POST',{action:'resume'});
 const localFailure=await until(async()=>{const j=await get(local.id);return j.status==='failed'?j:null});
 assert.equal(localFailure.requestOutcome,'not_sent');assert.equal(calls.has('local-failure'),false);
 const done=await submit('good');
 assert.equal((await until(async()=>{const j=await get(done.id);return j.status==='done'?j:null})).requestOutcome,'result_received');
 assert.equal((await api('/api/jobs/'+done.id+'/cancel','POST',{})).status,409);
 await stop();await start();await login();
 assert.equal((await get(slow.id)).requestOutcome,'unknown');
 assert.equal((await get(queued.id)).requestOutcome,'not_sent');
 const rejected=(await api('/api/jobs?projectId='+projectId)).body.jobs.find(j=>j.model==='reject');
 assert.equal(rejected.requestOutcome,'http_rejected');
 await api('/api/queue','POST',{action:'pause'});
 const retry=await api('/api/jobs/'+rejected.id+'/retry','POST',{acknowledgePotentialCharge:true});
 assert.equal(retry.status,201);assert.equal(retry.body.job.upstreamHttpStatus,null);
 assert.equal(retry.body.job.requestOutcome,'not_sent','新尝试不能沿用旧 HTTP 拒绝证据');
});

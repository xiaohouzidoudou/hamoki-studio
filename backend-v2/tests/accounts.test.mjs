import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){
 return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
}
test('multi-account isolation, admin bootstrap, reset, Sub2 integration', {timeout:45000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-v2-test-'));
 const mockPort=await port();
 const mock=httpMock(mockPort);
 await new Promise(r=>mock.listen(mockPort,'127.0.0.1',r));
 const studioPort=await port();
 const child=spawn(process.execPath,[path.join(root,'src/index.ts')],{
  cwd:root,
  env:{...process.env,STUDIO_DATA_DIR:dir,STUDIO_PORT:String(studioPort),SUB2_BASE_URL:'http://127.0.0.1:'+mockPort,STUDIO_MAX_USERS:'12'},
  stdio:['ignore','pipe','pipe','ipc'],windowsHide:true
 });
 let log='';
 child.stdout.on('data',chunk=>{log+=chunk.toString()});
 let errors='';
 child.stderr.on('data',chunk=>{errors+=chunk.toString()});
 const base='http://127.0.0.1:'+studioPort;
 async function api(route,opts={}){
   const r=await fetch(base+route,{method:opts.method||'GET',headers:{'Content-Type':'application/json','X-Studio-Request':'1',...(opts.cookie?{Cookie:opts.cookie}:{})},body:opts.method&&opts.method!=='GET'?JSON.stringify(opts.body??{}):undefined,redirect:'manual',signal:AbortSignal.timeout(6000)});
   const text=await r.text();
   let data;try{data=JSON.parse(text)}catch{data=text}
   return{code:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
 }
 try{
  for(let i=0;i<80&&!log.includes('backend-v2 available');i++)await wait(100);
  assert.match(log,/backend-v2 available/,errors);
  const code=log.match(/激活码.*?: ([0-9a-f]{32})/)?.[1];assert.ok(code,'activation code must appear only in private console');
   const initial=await api('/api/auth/status');
   assert.equal(initial.code,200);assert.equal(initial.data.needsActivation,true);
   const prereg=await api('/api/auth/register',{method:'POST',body:{username:'beforeadmin',password:'long-password-123'}});
   assert.equal(prereg.code,503,'public signup must not be possible before admin is secured');
   const anonHome=await fetch(base+'/',{redirect:'manual'});assert.equal(anonHome.status,302);assert.equal(anonHome.headers.get('location'),'/login');
   const csrf=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Origin':'https://evil.invalid','Content-Type':'application/json','X-Studio-Request':'1'},body:'{}'});
   assert.equal(csrf.status,403,'cross-origin login attempts must be rejected');
   assert.match(initial.data.needsActivation?'yes':'no',/yes/);
  const admin=await api('/api/auth/activate',{method:'POST',body:{code,password:'AdminStrong_123456'}});assert.equal(admin.code,200,JSON.stringify(admin.data));
  const a=await api('/api/auth/register',{method:'POST',body:{username:'useraaa',password:'SomePassword_111'}}),b=await api('/api/auth/register',{method:'POST',body:{username:'userbbb',password:'SomePassword_222'}});
  assert.equal(a.code,200,JSON.stringify(a.data));assert.equal(b.code,200,JSON.stringify(b.data));
  assert.equal(a.data.quota.quotaBytes,1024**3);
  const unauth=await api('/api/projects');assert.equal(unauth.code,401);
  const u1=await api('/api/projects',{cookie:a.cookie});const u2=await api('/api/projects',{cookie:b.cookie});
  assert.equal(u1.code,200,JSON.stringify(u1.data));assert.equal(u2.code,200,JSON.stringify(u2.data));
  assert.notEqual(u1.data.defaultId,u2.data.defaultId,'each account must get own canvas');
  const createProject=await api('/api/projects',{cookie:a.cookie,method:'POST',body:{title:'private-canvas-of-A'}});
  assert.equal(createProject.code,201,JSON.stringify(createProject.data));
  const bCannotSeeA=await api('/api/projects/'+u1.data.defaultId,{cookie:b.cookie});
  assert.equal(bCannotSeeA.code,404,'other account project must not be reachable');
  const aNewProjects=await api('/api/projects',{cookie:a.cookie}),bSameProjects=await api('/api/projects',{cookie:b.cookie});
  assert.equal(aNewProjects.data.projects.length,2);
  assert.equal(bSameProjects.data.projects.length,1);
  const restricted=await api('/api/admin/users',{cookie:a.cookie});assert.equal(restricted.code,403);
  const users=await api('/api/admin/users',{cookie:admin.cookie});assert.equal(users.data.users.length,3);
  const accountA=users.data.users.find(x=>x.username==='useraaa');
  const reset=await api('/api/admin/users/'+accountA.id+'/reset',{method:'POST',cookie:admin.cookie,body:{adminPassword:'AdminStrong_123456'}});
  assert.equal(reset.code,200,JSON.stringify(reset.data));assert.ok(reset.data.temporaryPassword.length>=20);
  const expired=await api('/api/projects',{cookie:a.cookie});assert.equal(expired.code,401);
  const login=await api('/api/auth/login',{method:'POST',body:{username:'useraaa',password:reset.data.temporaryPassword}});assert.equal(login.code,200);
  const cannotUseCanvas=await api('/api/projects',{cookie:login.cookie});assert.equal(cannotUseCanvas.code,403);
  const me=await api('/api/account/me',{cookie:login.cookie});assert.equal(me.code,200);
  const pw=await api('/api/account/password',{method:'POST',cookie:login.cookie,body:{oldPassword:reset.data.temporaryPassword,newPassword:'MyNewPassword_998'}});assert.equal(pw.code,200);
  const sub2Login=await api('/api/auth/sub2-login',{method:'POST',body:{email:'sub@example.com',password:'MockSecret_123'}});
  assert.equal(sub2Login.code,200,JSON.stringify(sub2Login.data));
  assert.equal(sub2Login.data.sub2Sync?.configured,true,JSON.stringify(sub2Login.data));
  const connectedProviders=await api('/api/providers',{cookie:sub2Login.cookie});
  assert.equal(connectedProviders.code,200);
  assert.ok(connectedProviders.data.providers.some(p=>p.name==='Sub2 · 账号专属'));
  const sb=await api('/api/account/sub2/balance',{cookie:sub2Login.cookie});
  assert.equal(sb.code,200);assert.equal(sb.data.balance,14.25);
  const provision=await api('/api/account/sub2/provision',{cookie:sub2Login.cookie,method:'POST'});
  assert.equal(provision.code,200,JSON.stringify(provision.data));
  const models=await api('/api/account/sub2/models',{cookie:sub2Login.cookie});
  assert.equal(models.code,200);assert.deepEqual(models.data.models,['gpt-image-1']);
  const requestBody={requestId:'client_task_unique_1',model:'gpt-image-1',prompt:'tiny cat in a meadow',size:'1024x1024'};
  const firstJob=await api('/api/account/sub2/jobs',{method:'POST',cookie:sub2Login.cookie,body:requestBody});
  assert.equal(firstJob.code,200,JSON.stringify(firstJob.data));
  assert.equal(firstJob.data.job.status,'processing');
  const duplicate=await api('/api/account/sub2/jobs',{method:'POST',cookie:sub2Login.cookie,body:requestBody});
  assert.equal(duplicate.code,200);assert.equal(duplicate.data.reused,true);
  assert.equal(asyncSubmitted,1,'duplicate requests must never dispatch a second paid generation');
  const polled=await api('/api/account/sub2/jobs/'+firstJob.data.job.id,{cookie:sub2Login.cookie});
  assert.equal(polled.data.job.status,'done');assert.ok(polled.data.result);
  const cross=await api('/api/account/sub2/jobs/'+firstJob.data.job.id,{cookie:b.cookie});
  assert.equal(cross.code,404);
  const changed=await api('/api/account/sub2/jobs',{method:'POST',cookie:sub2Login.cookie,body:{...requestBody,prompt:'different prompt'}});
  assert.equal(changed.code,409);
  const unknown=await api('/api/account/sub2/jobs',{method:'POST',cookie:sub2Login.cookie,body:{...requestBody,requestId:'client_task_network_fail',prompt:'timeout-uncertain'}});
  assert.equal(unknown.code,200);assert.equal(unknown.data.job.status,'uncertain');
  const knownCount=asyncSubmitted;
  const unknownAgain=await api('/api/account/sub2/jobs',{method:'POST',cookie:sub2Login.cookie,body:{...requestBody,requestId:'client_task_network_fail',prompt:'timeout-uncertain'}});
  assert.equal(unknownAgain.data.reused,true);assert.equal(asyncSubmitted,knownCount);
  const original=await api('/api/account/me',{cookie:b.cookie});assert.equal(original.code,200);
 }finally{
  if(child.exitCode===null){
    await Promise.race([new Promise(resolve=>{child.once('exit',resolve);try{child.send('shutdown')}catch{child.kill()}}),wait(3000)]);
    if(child.exitCode===null)child.kill();
  }
  await new Promise(r=>mock.close(r));
  await wait(200);
  try{fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200})}catch(e){console.error('test cleanup pending:',e.code)}
 }
});
function httpMock(){
 const http=requireHTTP();
 return http.createServer(async(req,res)=>{
  const body=await new Promise(r=>{let s='';req.on('data',c=>s+=c);req.on('end',()=>r(s))});
  let value,status=200;
  if(req.url==='/api/v1/auth/login'){
   const p=JSON.parse(body); if(p.email!=='sub@example.com'||p.password!=='MockSecret_123'){status=401;value={message:'login failed'}}
   else value={data:{access_token:'mock-access',expires_in:1800}};
  }else if(req.url==='/api/v1/user/profile')value={data:{id:55,username:'mockuser',balance:14.25,frozen_balance:1.5}};
  else if(req.url==='/api/v1/keys'&&req.method==='POST')value={data:{key:'sk-mock-secret'}};
  else if(req.url==='/v1/models')value={data:[{id:'gpt-image-1'},{id:'gpt-6'}]};
  else if(req.url==='/v1/images/generations/async'&&req.method==='POST'){
    asyncSubmitted++;
    if(JSON.parse(body).prompt==='timeout-uncertain'){req.socket.destroy();return}
    value={task_id:'imgtask_dummy12345',status:'processing'};
  }
  else if(req.url==='/v1/images/tasks/imgtask_dummy12345')value={task_id:'imgtask_dummy12345',status:'completed',result:{data:[{url:'https://example.invalid/image.webp'}]}};
  else {status=404;value={error:'not found'}}
  res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));
 });
}
import http from 'node:http';
let asyncSubmitted=0;
function requireHTTP(){return http}

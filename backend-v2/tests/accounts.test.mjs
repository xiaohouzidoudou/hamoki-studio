import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Accounts} from '../src/accounts.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const users={'owner@example.com':{id:1,role:'admin'},'a@example.com':{id:2,role:'user'},'b@example.com':{id:3,role:'user'}};
let paidCalls=0;
const paidIds=[];
async function port(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p))})})}
function mockSub2(){
 return http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  let result={},status=200;
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
  const id=Number(token.replace(/^mock-/,''));
  if(req.url==='/api/v1/settings/public'){
   result={data:{turnstile_enabled:true,turnstile_site_key:'mock-site-key-1234'}};
  }else if(req.url==='/api/v1/auth/login'){
   let params={};try{params=JSON.parse(raw)}catch{};
   const found=users[params.email];
   if(params.turnstile_token!=='mock-turnstile-solution'){status=403;result={message:'turnstile verification failed'}}
   else if(!found||params.password!=='RealSub2Password'){status=401;result={message:'Sub2 邮箱或密码不正确'}}
   else result={data:{access_token:'mock-'+found.id,expires_in:1800}};
  }else if(req.url==='/api/v1/user/profile'){
   if(![1,2,3].includes(id)){status=401;result={message:'bad token'}}
   else result={data:{id,username:'account'+id,balance:14.25,frozen_balance:0,role:id===1?'admin':'user'}};
  }else if(req.url==='/api/v1/keys'&&req.method==='POST'){
   result={data:{key:'sk-mock-key-'+id}};
  }else if(req.url==='/v1/models'){result={data:[{id:'gpt-image-1'},{id:'gpt-6'}]};}
  else if(req.url==='/v1/images/generations/async'&&req.method==='POST'){
   paidCalls++;paidIds.push(req.headers['idempotency-key']);
   if(raw.includes('upstream-uncertain')){req.socket.destroy();return}
   result={task_id:'mock-task-123456',status:'processing'};
  }else if(req.url==='/v1/images/tasks/mock-task-123456'){
   result={task_id:'mock-task-123456',status:'completed',result:{data:[{url:'https://example.invalid/hidden.webp'}]}};
  }else{status=404;result={error:'not found'};}
  res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(result));
 });
}
test('only verified Sub2 accounts can login; admin pinned, data isolated, dedupe durable', {timeout:60000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-sub2-only-'));
 const portMock=await port(), server=mockSub2(); await new Promise(resolve=>server.listen(portMock,'127.0.0.1',resolve));
 const portStudio=await port();
 const child=spawn(process.execPath,[path.join(root,'src/index.ts')],{
  cwd:root,env:{...process.env,STUDIO_DATA_DIR:dir,STUDIO_PORT:String(portStudio),STUDIO_ADMIN_SUB2_ID:'1',SUB2_BASE_URL:'http://127.0.0.1:'+portMock,STUDIO_SECURE_COOKIES:'0'},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true
 });
 let stdout='',stderr='';
 child.stdout.on('data',c=>{stdout+=c.toString()});
 child.stderr.on('data',c=>{stderr+=c.toString()});
 const base='http://127.0.0.1:'+portStudio;
 async function api(route,{method='GET',cookie,body,origin}={}){
  let r;try{r=await fetch(base+route,{method,headers:{'Content-Type':'application/json','X-Studio-Request':'1',...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},body:method==='GET'?undefined:JSON.stringify(body||{}),redirect:'manual',signal:AbortSignal.timeout(7500)})}catch(e){throw Error(method+' '+route+': '+e.message)}
  const raw=await r.text();let json;try{json=JSON.parse(raw)}catch{json=raw}
  return {code:r.status,data:json,cookie:r.headers.get('set-cookie')?.split(';')[0],headers:r.headers};
 }
 const login=async(email,password='RealSub2Password')=>api('/api/auth/sub2-login',{method:'POST',body:{email,password,turnstile_token:'mock-turnstile-solution'}});
 try{
  for(let n=0;n<90&&!stdout.includes('backend-v2 available');n++)await sleep(100);
  assert.match(stdout,/backend-v2 available/,stderr);
  assert.doesNotMatch(stdout,/激活码/);
  const anon=await api('/api/auth/status');assert.equal(anon.code,200);
  assert.equal(anon.data.loginProvider,'sub2');assert.equal(anon.data.user,null);
  assert.equal(anon.data.needsActivation,undefined);
  const captcha=await api('/api/auth/captcha');assert.equal(captcha.code,200);
  assert.equal(captcha.data.enabled,true);assert.equal(captcha.data.siteKey,'mock-site-key-1234');
  const form=await api('/login');assert.equal(form.code,200);
  assert.match(form.data,/使用 Sub2 账号登录/);assert.doesNotMatch(form.data,/首次激活码|data-mode="register"/);
  for(const route of ['/api/auth/register','/api/auth/login','/api/auth/activate']){
    const res=await api(route,{method:'POST',body:{username:'hamoki',password:'anything',code:'fake'}});
    assert.notEqual(res.code,200,'old auth endpoint must not grant access: '+route);
    assert.equal(res.cookie,undefined);
  }
  assert.equal((await api('/')).code,302);
  assert.equal((await api('/api/projects')).code,401);
  assert.equal((await api('/api/account/me')).code,401);
  assert.equal((await api('/api/auth/sub2-login',{method:'POST',body:{email:'owner@example.com',password:'RealSub2Password'}})).code,403);
  assert.equal((await login('owner@example.com','wrong')).code,401);
  const csrf=await api('/api/auth/sub2-login',{method:'POST',origin:'https://evil.example',body:{email:'owner@example.com',password:'RealSub2Password'}});
  assert.equal(csrf.code,403);
  const b=await login('b@example.com'),a=await login('a@example.com'),owner=await login('owner@example.com');
  assert.equal(a.code,200,JSON.stringify(a.data));
  assert.equal(b.code,200,JSON.stringify(b.data));
  assert.equal(owner.code,200,JSON.stringify(owner.data));
  assert.equal(a.data.user.role,'user');
  assert.equal(b.data.user.role,'user');
  assert.equal(owner.data.user.role,'admin');
  const provider=await api('/api/providers',{cookie:a.cookie});assert.equal(provider.code,200,JSON.stringify(provider.data));
  assert.ok(provider.data.providers.some(p=>p.name==='Sub2 · 账号专属'));
  const pA=await api('/api/projects',{cookie:a.cookie}),pB=await api('/api/projects',{cookie:b.cookie});
  assert.equal(pA.code,200,JSON.stringify(pA.data));
  assert.equal(pB.code,200,JSON.stringify(pB.data));
  assert.notEqual(pA.data.defaultId,pB.data.defaultId);
  const project=await api('/api/projects',{method:'POST',cookie:a.cookie,body:{title:'privateA'}});
  assert.equal(project.code,201);
  assert.equal((await api('/api/projects/'+pA.data.defaultId,{cookie:b.cookie})).code,404);
  assert.equal((await api('/api/admin/users',{cookie:a.cookie})).code,403);
  const balance=await api('/api/account/sub2/balance',{cookie:a.cookie});
  assert.equal(balance.code,200);assert.equal(balance.data.balance,14.25);
  const admins=await api('/api/admin/users',{cookie:owner.cookie});assert.equal(admins.code,200);
  assert.equal(admins.data.users.length,3);
  const aId=admins.data.users.find(u=>u.sub2_id==='2')?.id;
  assert.ok(aId);
  const taskBody={requestId:'safe-generated-id-001',model:'gpt-image-1',prompt:'red apple on table',size:'1024x1024'};
  const paid=await api('/api/account/sub2/jobs',{method:'POST',cookie:a.cookie,body:taskBody});
  assert.equal(paid.code,200,JSON.stringify(paid.data));
  assert.equal(paid.data.job.status,'processing');
  assert.equal(paidIds[0],taskBody.requestId);
  const repeat=await api('/api/account/sub2/jobs',{method:'POST',cookie:a.cookie,body:taskBody});
  assert.equal(repeat.data.reused,true);assert.equal(paidCalls,1);
  const polling=await api('/api/account/sub2/jobs/'+paid.data.job.id,{cookie:a.cookie});
  assert.equal(polling.data.job.status,'done');
  assert.equal((await api('/api/account/sub2/jobs/'+paid.data.job.id,{cookie:b.cookie})).code,404);
  const changed=await api('/api/account/sub2/jobs',{method:'POST',cookie:a.cookie,body:{...taskBody,prompt:'different'}});
  assert.equal(changed.code,409);
  const uncertainBody={...taskBody,requestId:'safe-generated-id-002',prompt:'upstream-uncertain'};
  const uncertain=await api('/api/account/sub2/jobs',{method:'POST',cookie:a.cookie,body:uncertainBody});
  assert.equal(uncertain.code,200);assert.equal(uncertain.data.job.status,'uncertain');
  const count=paidCalls;
  const uncertainRepeat=await api('/api/account/sub2/jobs',{method:'POST',cookie:a.cookie,body:uncertainBody});
  assert.equal(uncertainRepeat.data.reused,true);assert.equal(paidCalls,count);
  const disable=await api('/api/admin/users/'+aId+'/disable',{method:'POST',cookie:owner.cookie,body:{disabled:true}});
  assert.equal(disable.code,200);
  assert.equal((await api('/api/projects',{cookie:a.cookie})).code,401);
  assert.equal((await login('a@example.com')).code,403);
  const restore=await api('/api/admin/users/'+aId+'/disable',{method:'POST',cookie:owner.cookie,body:{disabled:false}});
  assert.equal(restore.code,200);
  const rebound=await login('a@example.com');assert.equal(rebound.code,200);
  const adminId=admins.data.users.find(u=>u.sub2_id==='1')?.id;
  assert.equal((await api('/api/admin/users/'+adminId+'/disable',{method:'POST',cookie:owner.cookie,body:{disabled:true}})).code,403);
  assert.equal((await api('/api/account/password',{cookie:owner.cookie,method:'POST',body:{oldPassword:'x',newPassword:'y'}})).code,404);
  assert.equal((await api('/api/admin/users/'+aId+'/reset',{cookie:owner.cookie,method:'POST'})).code,404);
 }finally{
   if(child.exitCode===null){
    await Promise.race([new Promise(resolve=>{child.once('exit',resolve);try{child.send('shutdown')}catch{child.kill()}}),sleep(3000)]);
    if(child.exitCode===null)child.kill();
   }
   await new Promise(resolve=>server.close(resolve));
   await sleep(200);
   try{fs.rmSync(dir,{recursive:true,force:true,maxRetries:12,retryDelay:180})}catch(e){console.error('cleanup:',e.code)}
 }
});
test('legacy local accounts and their sessions never authorize',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-legacy-session-'));
 const accounts=new Accounts(dir);
 try{
  accounts.db.prepare('INSERT INTO users(id,username,role,status,created) VALUES(?,?,?,?,?)').run('legacy','hamoki','admin','active',new Date().toISOString());
  assert.throws(()=>accounts.createSession('legacy'),/只允许 Sub2/);
  accounts.db.prepare('INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)').run(crypto.createHash('sha256').update('a'.repeat(64)).digest('hex'),'legacy',Date.now()+10000);
  assert.equal(accounts.session('a'.repeat(64)),null);
 }finally{accounts.db.close();fs.rmSync(dir,{recursive:true,force:true})}
});

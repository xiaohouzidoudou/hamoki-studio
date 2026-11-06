import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { Accounts } from './accounts.ts';
import { Sub2Client } from './sub2.ts';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'../..');
const DATA=path.resolve(process.env.STUDIO_DATA_DIR||path.join(HERE,'../data'));
const PORT=Number(process.env.STUDIO_PORT||8048);
const HOST=process.env.STUDIO_HOST||'127.0.0.1';
const LEGACY=path.join(ROOT,'server.js');
const accounts=new Accounts(DATA);
const sub2=new Sub2Client(process.env.SUB2_BASE_URL||'');
const app=Fastify({logger:false,bodyLimit:60*1024*1024,trustProxy:false});
// Preserve large image JSON uploads byte-for-byte when proxying to the existing canvas worker.
app.removeAllContentTypeParsers();
app.addContentTypeParser('*',{parseAs:'buffer',bodyLimit:60*1024*1024},(req,body,done)=>{
  if(/^\/api\/(?:auth|account|admin)\//.test(req.url)){
    if(body.length>256*1024)return done(Object.assign(Error('管理请求过大'),{statusCode:413}));
    try{return done(null,body.length?JSON.parse(body.toString('utf8')):{})}catch{return done(Object.assign(Error('JSON 格式错误'),{statusCode:400}))}
  }
  done(null,body);
});
const workers=new Map();
const recentHits=new Map();
let isClosing=false;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function reject(message,statusCode=400){throw Object.assign(Error(message),{statusCode})}
function sourceIP(req){return String(req.headers['x-real-ip']||req.ip||'unknown').slice(0,48)}
function cookie(req){
  const part=(req.headers.cookie||'').split(';').find(p=>p.trim().startsWith('hs_v2='));
  return part?part.trim().slice(6):null;
}
function sessionCookie(t,req){
  const https=process.env.STUDIO_SECURE_COOKIES==='1';
  return 'hs_v2='+t+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000'+(https?'; Secure':'');
}
function throttle(key,max,period){
  const now=Date.now();const hits=(recentHits.get(key)||[]).filter(x=>now-x<period);hits.push(now);recentHits.set(key,hits);
  if(hits.length>max)reject('操作太频繁，请稍后再试',429);
}
function requireLogin(req){
  const u=accounts.session(cookie(req));
  if(!u)reject('请先登录',401);
  return u;
}
function checkAdmin(req){const u=requireLogin(req);if(u.role!=='admin')reject('需要管理员权限',403);return u}
function originGuard(req){
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)){
    const origin=req.headers.origin;
    if(origin){let u;try{u=new URL(origin)}catch{reject('跨站请求被拒绝',403)};if(u.host!==req.headers.host||!['http:','https:'].includes(u.protocol))reject('跨站请求被拒绝',403)}
    if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))reject('跨站请求被拒绝',403);
    if(req.headers['x-studio-request']!=='1')reject('缺少安全请求标记',403);
  }
}
app.addHook('onRequest',async(req,reply)=>{
  const route=new URL(req.url,'http://localhost').pathname;
  if(route.startsWith('/api/')&&!/^\/api\/(auth|account|admin)\//.test(route)){
    const user=accounts.session(cookie(req));
    if(!user)return reply.code(401).send({error:'请先登录'});
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      const origin=req.headers.origin;
      if(origin){let o;try{o=new URL(origin)}catch{return reply.code(403).send({error:'跨站请求被拒绝'})};if(o.host!==req.headers.host)return reply.code(403).send({error:'跨站请求被拒绝'})}
      if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return reply.code(403).send({error:'跨站请求被拒绝'});
    }
  }
});
app.addHook('preHandler',async(req)=>{if(req.url.startsWith('/api/auth/')||req.url.startsWith('/api/account/')||req.url.startsWith('/api/admin/'))originGuard(req)});
app.addHook('onSend',async(req,reply,payload)=>{
  if(req.url.startsWith('/api/')||req.url==='/login'||req.url==='/account'){
    reply.header('Cache-Control','private, no-store, max-age=0');
    reply.header('X-Content-Type-Options','nosniff');
  }
  return payload;
});
app.setErrorHandler((err,req,reply)=>reply.code(err.statusCode>=400&&err.statusCode<600?err.statusCode:500).send({error:err.statusCode?err.message:'服务暂时异常'}));
function loginReply(reply,user,req){
  const token=accounts.createSession(user.id);
  reply.header('Set-Cookie',sessionCookie(token,req));
  return {user,quota:accounts.quota(user.id)};
}
app.get('/api/auth/status',async(req)=>({user:accounts.session(cookie(req)),loginProvider:'sub2',sub2Enabled:sub2.enabled}));
app.post('/api/auth/sub2-login',async(req,reply)=>{
  if(!sub2.enabled)reject('Sub2 登录暂不可用',503);
  throttle('sub2-login:'+sourceIP(req),6,15*60000);
  const {profile,tokens}=await sub2.login(req.body?.email,req.body?.password);
  const u=accounts.sub2Identity(profile.id,profile.username||profile.email||'',tokens);
  if(u.status==='disabled')reject('此 Studio 账号已被禁用',403);
  const result=loginReply(reply,u,req);
  try{result.sub2Sync=await ensureSub2Ready(u)}catch(e){result.sub2Warning='登录成功，但生图模型尚未自动接入：'+String(e.message).slice(0,130)}
  return result;
});
app.post('/api/auth/logout',async(req,reply)=>{
  accounts.logout(cookie(req));reply.header('Set-Cookie','hs_v2=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return {ok:true};
});
app.get('/api/account/me',async(req)=>{
  const u=requireLogin(req);
  return {user:u,quota:accounts.quota(u.id),sub2Connected:!!u.sub2_id,sub2Enabled:sub2.enabled};
});
async function sub2Session(u){
  const tokens=accounts.sub2Tokens(u.id);
  if(!tokens?.access_token)reject('Sub2 授权已失效，请重新连接',401);
  if(tokens.expires_at&&tokens.expires_at<Date.now()+60000){
    const renewed=await sub2.refresh(tokens.refresh_token);
    accounts.updateSub2Tokens(u.id,renewed);
    return renewed.access_token;
  }
  return tokens.access_token;
}
app.get('/api/account/sub2/balance',async(req)=>{
  const u=requireLogin(req),token=await sub2Session(u);
  const p=await sub2.profile(token);
  return {balance:p.balance??null,frozenBalance:p.frozen_balance??null,currency:'USD',source:'Sub2API',lastUpdated:new Date().toISOString()};
});
app.get('/api/account/sub2/models',async(req)=>{
  const u=requireLogin(req);const key=accounts.sub2Key(u.id);
  if(!key)return {models:[],needsProvision:true};
  const models=await sub2.models(key);
  return {models:models.filter(n=>/(?:image|imagen|dall|flux|grok)/i.test(n)),allCount:models.length};
});
async function provision(u){
  let key=accounts.sub2Key(u.id);
  if(key)return key;
  const token=await sub2Session(u);
  key=await sub2.createKey(token,u.id);
  accounts.setSub2Key(u.id,key);
  return key;
}
app.post('/api/account/sub2/provision',async(req)=>{
  const u=requireLogin(req);
  throttle('sub2-provision:'+u.id,2,3600000);
  const sync=await ensureSub2Ready(u);
  return {ok:true,keyStored:sync.keyStored,modelCount:sync.imageModels,configured:sync.configured};
});
// Durable async task ledger: record a unique submission before contacting paid API.
app.get('/api/account/sub2/jobs',async(req)=>{
 const u=requireLogin(req);
 return {jobs:accounts.imageTasks(u.id)};
});
app.post('/api/account/sub2/jobs',async(req)=>{
 const u=requireLogin(req);
 const {requestId,model,prompt,size}=req.body||{};
 if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{8,96}$/.test(requestId))reject('需要唯一请求编号',400);
 if(typeof model!=='string'||model.length>150||typeof prompt!=='string'||!prompt.trim()||prompt.length>12000||typeof size!=='string'||!/^[0-9]{3,4}x[0-9]{3,4}$/.test(size))reject('生图参数不合法',400);
 const key=accounts.sub2Key(u.id);
 if(!key)reject('请先连接Sub2生图 API',409);
 const available=await sub2.models(key);
 if(!available.includes(model)||!/(?:image|imagen|dall|flux|grok)/i.test(model))reject('此 Sub2 账号未开放该生图模型',403);
  throttle('sub2-paid:'+u.id,6,60000);
 const body={model,prompt:prompt.trim(),size};
 const digest=crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
 const started=accounts.createImageTask(u.id,requestId,digest);
 if(!started.created)return {job:started.task,reused:true,notice:'这是同一任务，未再次请求付费 API'};
 try{
  const response=await sub2.submitImage(key,body,requestId);
  const remoteId=String(response.task_id||response.id||'');
  if(!/^[a-zA-Z0-9_-]{8,128}$/.test(remoteId))throw Error('Sub2 未返回可靠任务编号，已暂停重试以避免扣费');
  return {job:accounts.updateImageTask(u.id,started.task.id,'processing',remoteId),reused:false};
 }catch(e){
  // A 4xx API rejection is definitive; network/upstream errors are uncertain.
  const definitive=e.statusCode===400||e.statusCode===401||e.statusCode===403||e.statusCode===404||e.statusCode===422;
  const status=definitive?'failed':'uncertain';
  return {job:accounts.updateImageTask(u.id,started.task.id,status,null,String(e.message).slice(0,260)),reused:false,notice:status==='uncertain'?'上游可能已接受或扣费，系统不会自动重新提交':'上游拒绝了任务'};
 }
});
app.get('/api/account/sub2/jobs/:id',async(req)=>{
 const u=requireLogin(req),job=accounts.getImageTask(u.id,req.params.id);
 if(!job)reject('任务不存在',404);
 if(!job.remote_id||job.status==='uncertain')return {job,notice:'任务编号未知，不自动付费重试'};
 const key=accounts.sub2Key(u.id);
 if(!key)reject('Sub2 专用 Key 不可用',409);
 try{
  const remote=await sub2.task(key,job.remote_id);
  const status=remote.status==='completed'?'done':remote.status==='failed'?'failed':'processing';
  const updated=accounts.updateImageTask(u.id,job.id,status,job.remote_id,status==='failed'?String(remote.error?.message||'失败').slice(0,260):null);
  return {job:updated,result:status==='done'?remote.result:null};
 }catch(e){return {job,notice:'暂时无法查询上游结果，请稍后查询；不会重复生图'};}
});
app.get('/api/account/sub2/task/:id',async(req)=>{
  const u=requireLogin(req),key=accounts.sub2Key(u.id);
  if(!key)reject('需要先连接 Sub2 专用 Key',409);
  return sub2.task(key,req.params.id);
});
app.get('/api/admin/users',async(req)=>{
  checkAdmin(req);
  return {users:accounts.listUsers().map(u=>({...u,quota:accounts.quota(u.id)}))};
});
app.post('/api/admin/users/:id/disable',async(req)=>{
  const admin=checkAdmin(req);
  accounts.disable(req.params.id,admin.id,req.body?.disabled===true);
  return {ok:true};
});
async function internalWorkerRequest(w,route,method='GET',payload){
  const r=await fetch('http://127.0.0.1:'+w.port+route,{
    method,
    headers:payload?{'Content-Type':'application/json'}:undefined,
    body:payload?JSON.stringify(payload):undefined,
    signal:AbortSignal.timeout(12000)
  });
  let body;try{body=await r.json()}catch{reject('用户工作空间响应异常',502)}
  if(!r.ok)reject(body.error||'用户工作空间更新失败',502);
  return body;
}
const sub2Name='Sub2 · 账号专属';
async function ensureSub2Ready(u){
  const key=await provision(u);
  const models=await sub2.models(key);
  const images=models.filter(m=>/(?:image|imagen|dall|flux|grok)/i.test(m));
  if(!images.length)return {keyStored:true,imageModels:0,configured:false,notice:'当前 Sub2 API Key 未发现可用的生图模型'};
  try{
    const w=await worker(u.id);
    const existing=(await internalWorkerRequest(w,'/api/providers')).providers.find(p=>p.name===sub2Name);
    const body={name:sub2Name,url:sub2.base+'/v1',mode:'openai',imageMode:'images',imageModel:images[0],visionModel:'gpt-4o-mini',apiKey:key};
    await internalWorkerRequest(w,existing?'/api/providers/'+existing.id:'/api/providers',existing?'PUT':'POST',body);
    return {keyStored:true,imageModels:images.length,configured:true};
  }catch(e){
    return {keyStored:true,imageModels:images.length,configured:false,warning:'Sub2 模型已发现，但尚未写入画布：'+String(e.message).slice(0,110)};
  }
}
function portFree(){
  return new Promise((resolve,reject)=>{
    const sock=net.createServer();
    sock.once('error',reject);
    sock.listen(0,'127.0.0.1',()=>{const port=sock.address().port;sock.close(()=>resolve(port))});
  });
}
async function worker(id){
  const existing=workers.get(id);
  if(existing&&existing.child.exitCode===null)return existing.ready;
  const user=accounts.getById(id);
  if(!user)reject('用户不存在',404);
  const port=await portFree();
  const privateData=path.join(DATA,'users',id);
  fs.mkdirSync(privateData,{recursive:true});
  const derive=label=>crypto.createHmac('sha256',accounts.master).update(id+':'+label).digest('hex');
  const trustedSub2=(()=>{try{const url=new URL(sub2.base);return url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port?url.origin+'/v1':''}catch{return ''}})();
  const env={...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:privateData,APP_PASSWORD:derive('password'),APP_ENCRYPTION_KEY:derive('key'),MEDIA_QUOTA_GB:'1',MAX_CONCURRENT:'1',APP_ALLOWED_HOST:'',APP_BASE_PATH:'',DEMO_MODE:'0',STUDIO_TRUSTED_SUB2_URL:trustedSub2};
  const child=spawn(process.execPath,[LEGACY],{cwd:ROOT,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const record={child,port,ready:null};
  workers.set(id,record);
  child.stdout.on('data',()=>{});
  child.stderr.on('data',buf=>console.error('[Studio private worker]',id,String(buf).slice(0,250)));
  child.on('exit',()=>{if(workers.get(id)===record)workers.delete(id)});
  record.ready=(async()=>{
    for(let i=0;i<60;i++){
      if(child.exitCode!==null)reject('用户工作空间启动失败',503);
      try{const r=await fetch('http://127.0.0.1:'+port+'/api/status',{signal:AbortSignal.timeout(500)});if(r.ok)return record}catch{}
      await delay(100);
    }
    reject('用户工作空间启动超时',503);
  })();
  return record.ready;
}
async function proxy(req,reply){
  // Unknown account/auth/admin endpoints must never be proxied to a canvas worker.
  if(/^\/api\/(?:auth|account|admin)\//.test(new URL(req.url,'http://localhost').pathname))return reply.code(404).send({error:'接口不存在'});
  const u=accounts.session(cookie(req));
  if(!u){
    if(!req.url.startsWith('/api/'))return reply.redirect('/login');
    return reply.code(401).send({error:'请先登录'});
  }
  const active=await worker(u.id);
  const isIndex=req.method==='GET'&&['/','/index.html'].includes(new URL(req.url,'http://localhost').pathname);
  if(isIndex){
    const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
    const extra='<script src="/account-bridge.js" defer></script>';
    reply.type('text/html; charset=utf-8').header('Cache-Control','no-store');
    return html.replace('</body>',extra+'</body>');
  }
  // Node's built-in reverse proxy streams to the account's own loopback-only worker.
  reply.hijack();
  const opts={hostname:'127.0.0.1',port:active.port,path:req.raw.url,method:req.method,headers:{...req.raw.headers,host:'127.0.0.1:'+active.port,'x-studio-account':u.id}};
  delete opts.headers.cookie;
  const upstream=http.request(opts,res=>{
    reply.raw.writeHead(res.statusCode||502,{...res.headers,'cache-control':res.headers['cache-control']||'private, no-store'});
    res.pipe(reply.raw);
  });
  upstream.on('error',()=>{if(!reply.raw.headersSent)reply.raw.writeHead(502,{'content-type':'application/json'});reply.raw.end(JSON.stringify({error:'工作空间暂时不可达'}))});
  if(req.body!==undefined)upstream.end(req.body);else upstream.end();
}
app.get('/login',async(req,reply)=>{reply.type('text/html; charset=utf-8').header('Cache-Control','no-store');return fs.readFileSync(path.join(HERE,'../web/login.html'),'utf8')});
app.get('/account',async(req,reply)=>{if(!accounts.session(cookie(req)))return reply.redirect('/login');reply.type('text/html; charset=utf-8');return fs.readFileSync(path.join(HERE,'../web/account.html'),'utf8')});
app.get('/account-bridge.js',async(req,reply)=>{reply.type('application/javascript; charset=utf-8');return fs.readFileSync(path.join(HERE,'../web/bridge.js'),'utf8')});
app.all('/*',proxy);
app.addHook('onClose',async()=>{
  isClosing=true;
  for(const w of workers.values())try{w.child.kill()}catch{}
  accounts.db.close();
});
process.on('message',message=>{if(message==='shutdown')app.close().then(()=>process.exit(0)).catch(()=>process.exit(1))});
try{
 await app.listen({host:HOST,port:PORT});
 console.log('[Hamoki Studio] backend-v2 available at http://'+HOST+':'+PORT+' (secure account gateway)');
}catch(e){console.error(e);process.exitCode=1}

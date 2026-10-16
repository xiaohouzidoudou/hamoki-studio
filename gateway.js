/** Hamoki Studio v0.6.3 — invite-only account gateway with isolated per-user workspaces. */
'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const createWorkspace=require('./workspace');
const {openDiagnostics}=require('./lib/diagnostics');

const {randomBytes,createHmac,timingSafeEqual,scryptSync}=crypto;
const ROOT=__dirname;
const DATA_DIR=path.resolve(process.env.DATA_DIR||path.join(ROOT,'data'));
const USERS_DIR=path.join(DATA_DIR,'users');
const ACCOUNTS_FILE=path.join(DATA_DIR,'accounts.json');
const SESSIONS_FILE=path.join(DATA_DIR,'sessions.json');
const MASTER=process.env.APP_ENCRYPTION_KEY||'';
const HOST=process.env.HOST||'127.0.0.1';
const PORT=Number(process.env.PORT||8028);
const ALLOWED_HOST=(process.env.APP_ALLOWED_HOST||'').toLowerCase();
const BASE=(process.env.APP_BASE_PATH||'').replace(/\/$/,'');
if(BASE&&!/^\/[a-zA-Z0-9_-]+$/.test(BASE))throw Error('APP_BASE_PATH must be a single path segment');
const COOKIE_SECURE=process.env.COOKIE_SECURE==='1';
const COOKIE_PATH=BASE?BASE+'/':'/';
const INVITE_CODE=(process.env.INVITE_CODE||'').trim();
const USER_QUOTA_GB=Math.max(process.env.NODE_ENV==='test'?0.00001:0.1,Math.min(20,Number(process.env.USER_QUOTA_GB||1)||1));
const TOTAL_QUOTA_GB=Math.max(process.env.NODE_ENV==='test'?0.00001:1,Math.min(200,Number(process.env.TOTAL_QUOTA_GB||5)||5));
const MAX_CONCURRENT=Math.max(1,Math.min(2,Math.floor(Number(process.env.MAX_CONCURRENT||1)||1)));
const SESSION_AGE=30*24*60*60;
const MAX_LOGIN_PER_15MIN=20;
const MAX_REGISTER_PER_DAY=20;
if(MASTER.length<32)throw Error('APP_ENCRYPTION_KEY must be at least 32 characters');
if(!INVITE_CODE)throw Error('INVITE_CODE must be set explicitly');
if(!ALLOWED_HOST)throw Error('APP_ALLOWED_HOST is required');
fs.mkdirSync(DATA_DIR,{recursive:true,mode:0o700});
fs.mkdirSync(USERS_DIR,{recursive:true,mode:0o700});

const digest=value=>createHmac('sha256',MASTER).update(value).digest('hex');
function atomic(file,text){const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,text,{mode:0o600});fs.renameSync(tmp,file)}
function readJSON(file,fallback){if(!fs.existsSync(file))return fallback;return JSON.parse(fs.readFileSync(file,'utf8'))}
function nowISO(){return new Date().toISOString()}
function getIp(req){const candidate=String(req.headers['x-real-ip']||'');if(/^[0-9a-fA-F:.]{3,64}$/.test(candidate))return candidate;return req.socket.remoteAddress||'unknown'}
function cookieMap(req){const out={};for(const part of String(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim())}return out}
function sendJSON(res,code,data,extra={}){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin',...extra});res.end(JSON.stringify(data))}
function fail(res,code,message,extra){sendJSON(res,code,{error:message},extra)}
function serveStatic(req,res,pathname){
  const file=pathname==='/'?'/index.html':pathname;
  if(!/^\/(?:index\.html|assets\/[\w-]+\.(?:css|js|png|webp|ico))$/.test(file))return fail(res,404,'资源不存在');
  const full=path.join(ROOT,file);
  fs.readFile(full,(err,content)=>{
    if(err)return fail(res,404,'资源不存在');
    const ext=path.extname(file);
    res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'})[ext],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"});
    res.end(req.method==='HEAD'?undefined:content);
  });
}

const COWART_MAX_BYTES=12*1024*1024;
const COWART_PROJECT_ID=/^[a-f0-9-]{36}$/;
function cowartProjectFile(account,id){
  if(!COWART_PROJECT_ID.test(id))throw Object.assign(Error('项目 ID 不合法'),{status:400});
  const file=path.join(userDir(account.id),'projects.json');
  const projects=readJSON(file,{projects:[]}).projects||[];
  if(!projects.some(p=>p.id===id&&!p.archived))throw Object.assign(Error('项目不存在或不属于当前账号'),{status:404});
  const dir=path.join(userDir(account.id),'cowart-canvas');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  return path.join(dir,id+'.json');
}
function cowartCanvasResponse(req,res,pathname){
  const rel=pathname==='/cowart'||pathname==='/cowart/'?'index.html':pathname.slice('/cowart/'.length);
  if(req.method!=='GET'&&req.method!=='HEAD')return fail(res,405,'不支持的预览请求');
  if(!/^(?:index\.html|cowart-logo\.svg|assets\/[A-Za-z0-9_.-]+\.(?:js|css|svg|png|jpg|jpeg|webp|woff|woff2|ttf|json))$/.test(rel))return fail(res,404,'预览资源不存在');
  const file=path.join(ROOT,'cowart-dist',rel);
  fs.readFile(file,(err,data)=>{
    if(err)return fail(res,404,'画布预览未构建');
    const ext=path.extname(file);
    res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg'})[ext]||'application/octet-stream',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin',
      'Content-Security-Policy':"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      'Cross-Origin-Resource-Policy':'same-origin'});
    res.end(req.method==='HEAD'?undefined:data);
  });
}
async function cowartReadJSON(req){
  if(req.headers['content-type']?.split(';')[0]!=='application/json')throw Object.assign(Error('需要 JSON 数据'),{status:415});
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>COWART_MAX_BYTES)throw Object.assign(Error('画布快照超过 12MB 限制，请先压缩或导出素材'),{status:413});chunks.push(chunk)}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Object.assign(Error('画布快照格式错误'),{status:400})}
}
function cowartSnapshotSafe(snapshot){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||!snapshot.store||typeof snapshot.store!=='object'||Array.isArray(snapshot.store)||!snapshot.schema||typeof snapshot.schema!=='object')return false;
  const entries=Object.values(snapshot.store);
  if(entries.length>4000)return false;
  for(const entry of entries){
    if(!entry||typeof entry!=='object'||typeof entry.id!=='string'||typeof entry.typeName!=='string')return false;
    if(entry.typeName==='asset'){
      const src=entry.props?.src;
      if(typeof src==='string' && src && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src)&& !/^\/api\/media\/[a-f0-9-]{36}\.(?:png|jpg|webp)$/.test(src))return false;
    }
  }
  return true;
}
async function handleCowartData(req,res,url,account){
  const id=url.searchParams.get('projectId')||'';
  const file=cowartProjectFile(account,id);
  if(req.method==='GET'){
    const record=readJSON(file,null);
    return sendJSON(res,200,record?{snapshot:record.snapshot,revision:record.revision,updatedAt:record.updatedAt}:{snapshot:null,revision:0,updatedAt:null});
  }
  if(req.method!=='PUT')return fail(res,405,'不支持的操作');
  const body=await cowartReadJSON(req);
  if(!cowartSnapshotSafe(body.snapshot))return fail(res,400,'不合法的画布快照（只允许站内图片）');
  const previous=readJSON(file,null);
  const currentRevision=previous?.revision||0;
  if(body.revision!==currentRevision)return fail(res,409,'画布在其他窗口已修改；当前内容尚未覆盖，请先备份并刷新');
  const next={revision:currentRevision+1,updatedAt:nowISO(),snapshot:body.snapshot};
  const payload=JSON.stringify(next);
  const oldBytes=fs.existsSync(file)?fs.statSync(file).size:0;
  const incoming=Buffer.byteLength(payload)-oldBytes;
  const limit=Math.floor(USER_QUOTA_GB*1024**3);
  if(totalDirBytes(userDir(account.id))+incoming>limit || totalDirBytes(USERS_DIR)+incoming>TOTAL_QUOTA_BYTES)
    return fail(res,507,'账号图片空间不足，画布未保存，请先清理素材');
  atomic(file,payload);
  return sendJSON(res,200,{revision:next.revision,updatedAt:next.updatedAt});
}

function readBody(req){return new Promise((resolve,reject)=>{const chunks=[];let total=0;req.on('data',chunk=>{total+=chunk.length;if(total>200*1024){reject(Object.assign(Error('请求体过大'),{status:413}));req.destroy();return}chunks.push(chunk)});req.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));req.on('error',reject)})}
async function readJSONBody(req){const raw=await readBody(req);try{return raw?JSON.parse(raw):{}}catch{throw Object.assign(Error('请求 JSON 格式不正确'),{status:400})}}
function sameOrigin(req){if(req.method==='GET'||req.method==='HEAD')return true;const origin=req.headers.origin;if(origin){let u;try{u=new URL(origin)}catch{return false}if(u.host!==req.headers.host || (u.protocol!=='https:' && !(process.env.NODE_ENV==='test' && u.protocol==='http:' && ['127.0.0.1','localhost'].includes(u.hostname) && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))))return false}const site=req.headers['sec-fetch-site'];if(site&&site!=='same-origin'&&site!=='none')return false;return true}
function normalizeName(input){return String(input||'').trim()}
function normalizedKey(name){return normalizeName(name).toLowerCase()}
function validUsername(name){return /^[A-Za-z0-9][A-Za-z0-9._-]{1,29}$/.test(name)}
function validPassword(pw){return typeof pw==='string'&&pw.length>=6&&pw.length<=72}
function userDir(id){return path.join(USERS_DIR,id)}
function totalDirBytes(dir){
  let sum=0;
  try{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())sum+=totalDirBytes(full);else if(entry.isFile())sum+=fs.statSync(full).size}}catch{}
  return sum;
}
const db=readJSON(ACCOUNTS_FILE,{version:1,accounts:[]});
if(!Array.isArray(db.accounts))db.accounts=[];
const accounts=db.accounts;
function saveAccounts(){atomic(ACCOUNTS_FILE,JSON.stringify({version:1,accounts},null,2))}
function findAccountByKey(key){return accounts.find(a=>a.usernameKey===key)||null}
function hashPassword(password,saltHex){const salt=Buffer.from(saltHex,'hex');return scryptSync(password,salt,64).toString('hex')}
function verifyPassword(account,password){try{const a=Buffer.from(account.passwordHash,'hex'),b=Buffer.from(hashPassword(password,account.passwordSalt),'hex');return a.length===b.length&&timingSafeEqual(a,b)}catch{return false}}
function registerAccount(username,password){
  const clean=normalizeName(username);
  const key=normalizedKey(clean);
  if(!validUsername(clean))throw Object.assign(Error('用户名需为 2-30 位，只能使用字母、数字、点、下划线和短横线'),{status:400});
  if(!validPassword(password))throw Object.assign(Error('密码至少 6 位，最多 72 位'),{status:400});
  if(findAccountByKey(key))throw Object.assign(Error('该用户名已存在'),{status:409});
  const id=randomBytes(12).toString('hex');
  const salt=randomBytes(16).toString('hex');
  const account={id,username:clean,usernameKey:key,passwordSalt:salt,passwordHash:hashPassword(password,salt),createdAt:nowISO(),updatedAt:nowISO(),lastLoginAt:null};
  accounts.push(account);saveAccounts();
  fs.mkdirSync(userDir(id),{recursive:true,mode:0o700});
  return account;
}
// Sessions are persisted as token hashes so a Docker restart doesn't log everyone out.
const persistedSessions=readJSON(SESSIONS_FILE,{});
const sessions=new Map(Object.entries(persistedSessions).filter(([key,value])=>/^[a-f0-9]{64}$/.test(key)&&value&&value.expire>Date.now()));
const sessionKey=token=>crypto.createHash('sha256').update(token).digest('hex');
function saveSessions(){atomic(SESSIONS_FILE,JSON.stringify(Object.fromEntries(sessions)))}
function sessionCookie(token){return `hs_account=${token}; Path=${COOKIE_PATH}; Max-Age=${SESSION_AGE}; HttpOnly; SameSite=Strict${COOKIE_SECURE?'; Secure':''}`}
function createSession(account){
  const token='v1.'+randomBytes(24).toString('hex');
  for(const [key,item] of sessions)if(item.expire<=Date.now())sessions.delete(key);
  sessions.set(sessionKey(token),{accountId:account.id,expire:Date.now()+SESSION_AGE*1000});
  saveSessions();account.lastLoginAt=nowISO();account.updatedAt=nowISO();saveAccounts();return token;
}
function getSession(req){
  const token=cookieMap(req).hs_account||'';
  if(!/^v1\.[a-f0-9]{48}$/.test(token))return null;
  const key=sessionKey(token),item=sessions.get(key);
  if(!item||item.expire<=Date.now()){if(item){sessions.delete(key);saveSessions()}return null}
  const account=accounts.find(a=>a.id===item.accountId);if(!account)return null;
  if(item.expire-Date.now()<7*24*3600*1000){item.expire=Date.now()+SESSION_AGE*1000;saveSessions()}
  return {token,account};
}
const limiter={
  inFlight:0,queue:[],limit:MAX_CONCURRENT,
  async run(work){if(this.queue.length>24)throw Error('同时发起的上游请求过多，请稍后重试');if(this.inFlight>=this.limit)await new Promise(resolve=>this.queue.push(resolve));this.inFlight++;try{return await work()}finally{this.inFlight--;this.queue.shift()?.()}}
};
const loginHits=new Map(),registerHits=new Map(),visitors=new Map(),logsByAccount=new Map(),logHits=new Map();
const TOTAL_QUOTA_BYTES=Math.floor(TOTAL_QUOTA_GB*1024**3);
function logsFor(account){if(!logsByAccount.has(account.id))logsByAccount.set(account.id,openDiagnostics(userDir(account.id)));return logsByAccount.get(account.id)}
function overLimit(map,key,limit,windowMs){const now=Date.now(),item=map.get(key);if(!item||item.until<=now){map.set(key,{count:1,until:now+windowMs});return false}item.count++;return item.count>limit}
function accountStatus(account){const totalBytes=totalDirBytes(USERS_DIR);return {name:account.username,id:account.id,createdAt:account.createdAt,lastLoginAt:account.lastLoginAt,quota:{perUserBytes:Math.round(USER_QUOTA_GB*1024**3),totalBytes:Math.round(TOTAL_QUOTA_GB*1024**3),currentTotalBytes:totalBytes}}}
function handlerFor(account){
  if(visitors.has(account.id))return visitors.get(account.id);
  const env={DATA_DIR:userDir(account.id),APP_PASSWORD:digest('password:'+account.id),APP_ENCRYPTION_KEY:digest('encryption:'+account.id),APP_ALLOWED_HOST:ALLOWED_HOST,APP_BASE_PATH:'',ANON_WORKSPACE:'1',COOKIE_SECURE:COOKIE_SECURE?'1':'0',DEMO_MODE:'0',MAX_CONCURRENT:String(MAX_CONCURRENT),MEDIA_QUOTA_GB:String(USER_QUOTA_GB)};
  const instance=createWorkspace({env,limiter,log:item=>logsFor(account).append(item),globalBytesLeft:()=>Math.max(0,TOTAL_QUOTA_BYTES-totalDirBytes(USERS_DIR))});
  visitors.set(account.id,instance);
  return instance;
}

async function handleAuth(req,res,url){
  const ip=getIp(req);
  if(req.method==='GET'&&url.pathname==='/api/status'){
    const session=getSession(req);
    if(!session)return sendJSON(res,200,{backend:true,authenticated:false,version:'0.6.27',accountMode:true,inviteOnly:true,demoMode:false,basePath:BASE,quotas:{perUserGB:USER_QUOTA_GB,totalGB:TOTAL_QUOTA_GB}});
    res.setHeader('Set-Cookie',sessionCookie(session.token));
    return sendJSON(res,200,{backend:true,authenticated:true,version:'0.6.27',accountMode:true,inviteOnly:true,demoMode:false,basePath:BASE,user:accountStatus(session.account)});
  }
  if(req.method==='POST'&&url.pathname==='/api/register'){
    if(!sameOrigin(req))return fail(res,403,'禁止跨站请求');
    if(overLimit(registerHits,ip,MAX_REGISTER_PER_DAY,24*3600*1000))return fail(res,429,'注册过于频繁，请明天再试');
    const body=await readJSONBody(req);
    if(String(body.inviteCode||'').trim()!==INVITE_CODE)return fail(res,403,'邀请码不正确');
    const account=registerAccount(body.username,body.password);
    const token=createSession(account);
    return sendJSON(res,201,{ok:true,user:accountStatus(account)},{'Set-Cookie':sessionCookie(token)});
  }
  if(req.method==='POST'&&url.pathname==='/api/login'){
    if(!sameOrigin(req))return fail(res,403,'禁止跨站请求');
    if(overLimit(loginHits,ip,MAX_LOGIN_PER_15MIN,15*60*1000))return fail(res,429,'登录尝试次数过多，请稍后再试');
    const body=await readJSONBody(req);const key=normalizedKey(body.username);const account=findAccountByKey(key);
    if(!account||!verifyPassword(account,String(body.password||'')))return fail(res,401,'用户名或密码不正确');
    const token=createSession(account);
    return sendJSON(res,200,{ok:true,user:accountStatus(account)},{'Set-Cookie':sessionCookie(token)});
  }
  if(req.method==='POST'&&url.pathname==='/api/logout'){
    if(!sameOrigin(req))return fail(res,403,'禁止跨站请求');
    const session=getSession(req);if(session){sessions.delete(sessionKey(session.token));saveSessions()}
    return sendJSON(res,200,{ok:true},{'Set-Cookie':`hs_account=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Strict${COOKIE_SECURE?'; Secure':''}`});
  }
  if(req.method==='GET'&&url.pathname==='/healthz')return sendJSON(res,200,{ok:true,version:'0.6.27'});
  return false;
}

async function handler(req,res){
  try{
    if(ALLOWED_HOST&&String(req.headers.host||'').split(':')[0].toLowerCase()!==ALLOWED_HOST)return fail(res,421,'域名不匹配');
    const original=new URL(req.url,'http://localhost');
    if(BASE&&original.pathname===BASE){res.writeHead(308,{Location:BASE+'/'});return res.end()}
    if(BASE&&!original.pathname.startsWith(BASE+'/'))return fail(res,404,'资源不存在');
    const url=BASE?new URL(original.pathname.slice(BASE.length)+original.search,'http://localhost'):original;
    req.url=url.pathname+url.search;
    const handled=await handleAuth(req,res,url);
    if(handled!==false)return;
    if(url.pathname==='/cowart'||url.pathname.startsWith('/cowart/')){
      if(process.env.COWART_PREVIEW!=='1')return fail(res,404,'预览未启用');
      const session=getSession(req);
      if(!session)return fail(res,401,'请先登录');
      res.setHeader('Set-Cookie',sessionCookie(session.token));
      return cowartCanvasResponse(req,res,url.pathname);
    }
    if(url.pathname==='/api/cowart/snapshot'){
      if(process.env.COWART_PREVIEW!=='1')return fail(res,404,'预览未启用');
      const session=getSession(req);
      if(!session)return fail(res,401,'请先登录');
      if(!sameOrigin(req))return fail(res,403,'禁止跨站写入画布');
      res.setHeader('Set-Cookie',sessionCookie(session.token));
      return await handleCowartData(req,res,url,session.account);
    }
    if(!url.pathname.startsWith('/api/'))return serveStatic(req,res,url.pathname);
    const session=getSession(req);
    if(!session)return fail(res,401,'请先登录账号');
    if(!sameOrigin(req))return fail(res,403,'禁止跨站请求');
    res.setHeader('Set-Cookie',sessionCookie(session.token));
    if(url.pathname==='/api/logs'){
      const logs=logsFor(session.account);
      if(req.method==='GET')return sendJSON(res,200,{logs:logs.read(),count:logs.read().length});
      if(req.method==='DELETE'){logs.clear();return sendJSON(res,200,{ok:true})}
      if(req.method==='POST'){
        if(overLimit(logHits,session.account.id,60,5*60*1000))return fail(res,429,'日志写入过于频繁');
        const body=await readJSONBody(req);
        logs.append({source:'browser',level:'error',action:body.action,status:body.status,method:body.method,path:body.path,message:body.message});
        return sendJSON(res,201,{ok:true});
      }
      return fail(res,405,'日志接口不支持该方法');
    }
    return handlerFor(session.account).handler(req,res);
  }catch(error){
    const code=Number(error?.status)||500;
    console.error('[Hamoki accounts]',String(error?.stack||error?.message||error).slice(0,500));
    if(!res.headersSent)return fail(res,code,code===500?'账号系统暂时不可用，请稍后重试':String(error.message||'请求失败').slice(0,180));
    res.end();
  }
}
const server=http.createServer(handler);
server.requestTimeout=210000;
function restoreQueuedJobsOnStartup(){
  for(const account of accounts){
    try{
      const pending=readJSON(path.join(userDir(account.id),'jobs.json'),null);
      if(pending&&!pending.paused&&Array.isArray(pending.jobs)&&pending.jobs.some(j=>j.status==='queued')){
        handlerFor(account);
        console.log('[Hamoki queue recovery] resumed pending workspace');
      }
    }catch(e){console.error('[Hamoki queue recovery] workspace startup failed:',e?.code||e?.name||'unknown')}
  }
}
server.listen(PORT,HOST,()=>{console.log(`Hamoki Studio account gateway ready on http://${HOST}:${PORT}`);restoreQueuedJobsOnStartup()});

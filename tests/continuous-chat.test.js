'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const net=require('node:net');
const wait=t=>new Promise(ok=>setTimeout(ok,t));
async function freePort(){const s=net.createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const p=s.address().port;await new Promise(ok=>s.close(ok));return p}
async function boot(port,data){const child=spawn(process.execPath,[path.resolve(__dirname,'../gateway.js')],{cwd:path.resolve(__dirname,'..'),env:{...process.env,DATA_DIR:data,HOST:'127.0.0.1',PORT:String(port),APP_ALLOWED_HOST:'ps.test',INVITE_CODE:'hamoki',APP_ENCRYPTION_KEY:'hamoki-v065-stream-tests-secret-verylong',NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1',COOKIE_SECURE:'1'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);for(let i=0;i<140;i++){if(output.includes('account gateway ready'))return child;if(child.exitCode!==null)throw Error(output);await wait(40)}throw Error('Gateway failed: '+output)}
function browser(port){let cookie='';return async (route,method='GET',body)=>{const payload=body===undefined?null:Buffer.from(JSON.stringify(body));return await new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:route,method,headers:{Host:'ps.test',...(cookie?{Cookie:cookie}:{}),...(payload?{'Content-Type':'application/json','Content-Length':payload.length}:{})}},res=>{let chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];const raw=Buffer.concat(chunks).toString('utf8');resolve({status:res.statusCode,body:res.headers['content-type']?.includes('json')?JSON.parse(raw):raw,headers:res.headers})})});req.on('error',reject);req.end(payload)})}}
function parseSSE(raw){return raw.split(/\r?\n\r?\n/).map(item=>{const type=item.match(/^event:\s*(.+)$/m)?.[1],data=item.match(/^data:\s*(.*)$/m)?.[1];if(!type||!data)return null;return {type,data:JSON.parse(data)}}).filter(Boolean)}
test('V0.6.5 streaming multi-turn conversation persists per project, isolates accounts and handles upstream failure',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-v065-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const port=await freePort();const app=await boot(port,dir);t.after(()=>app.kill('SIGTERM'));
 const calls=[];
 const mock=http.createServer(async(req,res)=>{
  const raw=Buffer.concat(await (async()=>{const items=[];for await(const chunk of req)items.push(chunk);return items})()).toString('utf8');
  const payload=JSON.parse(raw);calls.push(payload);
  if(req.headers.authorization!=='Bearer text-unique-key')throw Error('Different API key used');
  if(payload.stream&&payload.messages.some(m=>m.content==='出错吧')){
   res.writeHead(429,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'额度有限'}}));return;
  }
  if(payload.stream){
   res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8'});
   const prefix='data: '+JSON.stringify({choices:[{delta:{content:'你好，'}}]})+'\n\n';
   res.write(prefix);
   const suffix='data: '+JSON.stringify({choices:[{delta:{content:'小猴子！'}}]})+'\n\n';
   const buff=Buffer.from(suffix);
   const ix=buff.indexOf(Buffer.from('小猴子'));
   if(ix>0){res.write(buff.subarray(0,ix+1));await wait(4);res.write(buff.subarray(ix+1))}else res.write(buff);
   res.end('data: [DONE]\n\n');return;
  }
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'非流式文字回复'}}]}));
 });
 await new Promise(ok=>mock.listen(0,'127.0.0.1',ok));t.after(()=>mock.close());
 const base=`http://127.0.0.1:${mock.address().port}/v1`;
 const a=browser(port),b=browser(port);
 assert.equal((await a('/api/register','POST',{username:'streamer',password:'goodpassword',inviteCode:'hamoki'})).status,201);
 assert.equal((await b('/api/register','POST',{username:'otheruser',password:'goodpassword',inviteCode:'hamoki'})).status,201);
 const provider=await a('/api/providers','POST',{name:'文本中转站',url:base,mode:'openai',imageMode:'images',apiKey:'main-key-not-for-chat',imageModel:'image-model',visionModel:'vision-model',capabilities:{text:{inheritBaseUrl:false,baseUrl:base,inheritApiKey:false,apiKey:'text-unique-key',defaultModel:'text-model'}}});
 assert.equal(provider.status,201,JSON.stringify(provider.body));
 const pid=provider.body.provider.id;
 assert.equal((await a('/api/bindings','PUT',{bindings:{text:{providerId:pid,model:'text-model'}}})).status,404);
 const first=(await a('/api/projects')).body.projects[0].id;
 const second=(await a('/api/projects','POST',{title:'第二个无关联项目'})).body.project.id;
 assert.equal((await b('/api/chat/stream','POST',{prompt:'不要共享',projectId:first})).status,400);
 const send=body=>a('/api/chat/stream','POST',body);
 let one=await send({prompt:'你好',projectId:first});assert.equal(one.status,200);assert.match(one.headers['content-type'],/text\/event-stream/);
 const events=parseSSE(one.body);assert.deepEqual(events.map(e=>e.type),['start','delta','delta','done']);assert.equal(events.filter(e=>e.type==='delta').map(e=>e.data.text).join(''),'你好，小猴子！');
 let two=await send({prompt:'你还记得我吗',projectId:first});assert.equal(two.status,200);
 assert.equal(calls[1].stream,true);assert.equal(calls[1].model,'text-model');
 assert.deepEqual(calls[1].messages.map(m=>m.role),['user','assistant','user']);
 assert.equal(calls[1].messages[0].content,'你好');assert.equal(calls[1].messages[1].content,'你好，小猴子！');
 let isolated=await send({prompt:'另一项目话题',projectId:second});assert.equal(isolated.status,200);
 assert.equal(calls[2].messages.length,1,'Project histories must not mix');
 const failed=await send({prompt:'出错吧',projectId:first});assert.equal(failed.status,200);assert.deepEqual(parseSSE(failed.body).map(x=>x.type),['start','error']);
 const project=(await a('/api/projects/'+first)).body.project;
 assert.equal(project.messages.length,4);assert.equal(project.messages.filter(m=>m.capability==='text').length,4);
 assert.equal(project.messages[0].role,'user');assert.equal(project.messages[1].role,'assistant');
 const legacy=await a('/api/chat','POST',{prompt:'后备普通对话',projectId:first});assert.equal(legacy.status,200);assert.equal(legacy.body.answer,'非流式文字回复');
 assert.equal(calls[4].messages.length,5,'Regular chat also keeps multi-turn history');
 assert.equal((await b('/api/projects/'+first)).status,404);
});
test('V0.6.5 caps text history length and message roles',()=>{
 const {textMessages}=require('../lib/upstream');
 const messages=textMessages([{role:'assistant',content:'图片提示不应包含',capability:'image'},{role:'user',content:'上下文'+'.'.repeat(4000)}],'现在怎么样');
 assert.equal(messages.at(-1).content,'现在怎么样');
 assert.ok(messages.length<=25);
 assert.ok(messages.every(m=>m.content.length<=8000));
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const net=require('node:net');
const wait=t=>new Promise(r=>setTimeout(r,t));
async function port(){const s=net.createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const p=s.address().port;await new Promise(ok=>s.close(ok));return p}
async function start(p,dir){const child=spawn(process.execPath,[path.join(__dirname,'..','gateway.js')],{cwd:path.join(__dirname,'..'),env:{...process.env,DATA_DIR:dir,APP_ALLOWED_HOST:'ps.test',APP_ENCRYPTION_KEY:'fake-secret-for-v064-very-long-test-isolation',INVITE_CODE:'hamoki',COOKIE_SECURE:'1',HOST:'127.0.0.1',PORT:String(p),NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);for(let i=0;i<140;i++){if(output.includes('account gateway ready'))return child;if(child.exitCode!==null)throw Error(output);await wait(40)}throw Error('timeout: '+output)}
function client(p){let cookie='';return {async req(url,method='GET',body){const buff=body===undefined?null:Buffer.from(JSON.stringify(body));return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:p,path:url,method,headers:{Host:'ps.test',...(cookie?{Cookie:cookie}:{}),...(buff?{'Content-Type':'application/json','Content-Length':buff.length}:{})}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];const raw=Buffer.concat(chunks),out=(res.headers['content-type']||'').includes('json')?JSON.parse(raw.toString()):raw;resolve({status:res.statusCode,body:out})})});req.on('error',reject);req.end(buff)})}}}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==','base64');
test('V0.6.4 separate text/image/vision credentials, endpoint and model routing without leakage',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-cap-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const p=await port(),app=await start(p,dir);t.after(()=>app.kill());
 const seen=[];const mock=http.createServer(async(req,res)=>{
  const body=Buffer.concat(await (async()=>{const a=[];for await(const b of req)a.push(b);return a})()).toString();
  seen.push({url:req.url,auth:req.headers.authorization,body});
  res.setHeader('Content-Type','application/json');
  if(req.url.endsWith('/models'))return res.end(JSON.stringify({data:[{id:'text-model'},{id:'image-model'},{id:'vision-model'}]}));
  if(req.url.endsWith('/chat/completions')){const text=JSON.parse(body).messages[0].content;
   return res.end(JSON.stringify({choices:[{message:{content:Array.isArray(text)?'识别到戴帽子的小猴子':'这里是文字回答'}}]}))}
  if(req.url.endsWith('/images/generations'))return res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));
  res.statusCode=404;res.end(JSON.stringify({error:{message:'not implemented'}}));
 });await new Promise(ok=>mock.listen(0,'127.0.0.1',ok));t.after(()=>mock.close());const base=`http://127.0.0.1:${mock.address().port}/v1`;
 const a=client(p),b=client(p);assert.equal((await a.req('/api/register','POST',{username:'alpha',password:'password123',inviteCode:'hamoki'})).status,201);assert.equal((await b.req('/api/register','POST',{username:'beta',password:'password456',inviteCode:'hamoki'})).status,201);
 const add=await a.req('/api/providers','POST',{name:'万能自定义',url:base,apiKey:'base-secret',mode:'openai',imageMode:'images',imageModel:'image-model',visionModel:'vision-model',capabilities:{text:{inheritBaseUrl:false,baseUrl:base,inheritApiKey:false,apiKey:'text-secret',defaultModel:'text-model'},image:{inheritBaseUrl:false,baseUrl:base,inheritApiKey:false,apiKey:'image-secret',defaultModel:'image-model'},vision:{inheritBaseUrl:false,baseUrl:base,inheritApiKey:false,apiKey:'vision-secret',defaultModel:'vision-model'}}});
 assert.equal(add.status,201,JSON.stringify(add.body));const id=add.body.provider.id;
 assert.equal(JSON.stringify(add.body).includes('text-secret'),false,'secrets must not leak in provider');
 assert.equal((await b.req('/api/providers')).body.providers.length,0,'other account cannot see provider');
 assert.equal((await a.req('/api/bindings')).status,404,'removed global route read must stay disabled');
 assert.equal((await a.req('/api/bindings','PUT',{bindings:{text:{providerId:id,model:'text-model'}}})).status,404,'removed global route writes must stay disabled');
 const text=await a.req('/api/chat','POST',{prompt:'你是谁？'});assert.equal(text.status,200,JSON.stringify(text.body));assert.equal(text.body.answer,'这里是文字回答');
 const project=(await a.req('/api/projects')).body.projects[0].id;
 const photo=await a.req('/api/jobs','POST',{projectId:project,prompt:'画一个猴子',count:1,ratio:'1:1',resolution:'1K'});assert.equal(photo.status,201,JSON.stringify(photo.body));
 let finished=false;for(let i=0;i<85;i++){const jobs=(await a.req('/api/jobs')).body.jobs;if(jobs.some(j=>j.id===photo.body.jobs[0].id&&j.status==='done')){finished=true;break}await wait(55)}assert.equal(finished,true,'image must finish');
 const reverse=await a.req('/api/reverse','POST',{image:'data:image/png;base64,'+png.toString('base64'),kind:'detailed'});assert.equal(reverse.status,200,JSON.stringify(reverse.body));assert.match(reverse.body.prompt,/识别到/);
 for(const [suffix,key] of [['/images/generations','Bearer image-secret']])assert.ok(seen.some(x=>x.url.endsWith(suffix)&&x.auth===key));
 assert.ok(seen.some(x=>x.url.endsWith('/chat/completions')&&x.auth==='Bearer text-secret'&&x.body.includes('text-model')));
 assert.ok(seen.some(x=>x.url.endsWith('/chat/completions')&&x.auth==='Bearer vision-secret'&&x.body.includes('vision-model')));
 assert.equal((await b.req('/api/chat','POST',{prompt:'no shared keys'})).status,400);
 const saved=(await a.req('/api/providers')).body.providers[0];assert.equal(saved.capabilities.image.hasKey,true);assert.equal(saved.capabilities.text.defaultModel,'text-model');assert.doesNotMatch(JSON.stringify(saved),/text-secret|image-secret|vision-secret|base-secret/);
 // Validate persisted encrypted data after restart and without leaking credentials
 const content=fs.readFileSync(path.join(dir,'users',fs.readdirSync(path.join(dir,'users')).find(id=>fs.existsSync(path.join(dir,'users',id,'providers.enc.json'))),'providers.enc.json'),'utf8');assert.doesNotMatch(content,/text-secret|image-secret|vision-secret/);
 const view=await a.req('/api/models?providerId='+id+'&capability=text');assert.equal(view.status,200);
});

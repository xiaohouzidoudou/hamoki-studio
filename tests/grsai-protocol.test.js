'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
process.env.NODE_ENV='test';process.env.ALLOW_PRIVATE_UPSTREAMS='1';
const upstream=require('../lib/upstream');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==','base64');
async function mockServer(t,handle){
 const app=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);
  handle(req,Buffer.concat(chunks),res);
 });
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
 return 'http://127.0.0.1:'+app.address().port;
}
function setup(url){return {id:'g',name:'Grsai',url,mode:'grsai',imageMode:'grsai',imageModel:'',apiKey:'fake-test-key'}}
const task={model:'nano-banana-2.1',prompt:'Draw a friendly cartoon monkey',ratio:'16:9',resolution:'2K',quality:'auto'};
test('Grsai submits unified nano-banana async JSON, polls GET id, downloads PNG',async t=>{
 const calls=[],progress=[];
 let url;
 url=await mockServer(t,(req,raw,res)=>{
  const body=raw.length?JSON.parse(raw.toString('utf8')):null;
  calls.push({method:req.method,path:req.url,body,auth:req.headers.authorization});
  res.setHeader('Content-Type',req.url==='/pic.png'?'image/png':'application/json');
  if(req.url==='/v1/api/generate')return res.end(JSON.stringify({id:'test-task-001',status:'running',progress:0}));
  if(req.url==='/v1/api/result?id=test-task-001')return res.end(JSON.stringify({id:'test-task-001',status:'succeeded',progress:100,results:[{b64_json:PNG.toString('base64')}]}));
  if(req.url==='/pic.png')return res.end(PNG);
  res.statusCode=404;res.end(JSON.stringify({error:'unexpected mock path'}));
 });
 const image=await upstream.generate(setup(url),task,[],null,undefined,data=>progress.push(data));
 assert.equal(image.mime,'image/png');assert.deepEqual(image.bytes,PNG);
 assert.equal(calls[0].path,'/v1/api/generate');assert.equal(calls[0].method,'POST');
 assert.equal(calls[0].auth,'Bearer fake-test-key');
 assert.deepEqual(Object.keys(calls[0].body).sort(),['aspectRatio','imageSize','images','model','prompt','replyType'].sort());
 assert.equal(calls[0].body.model,'nano-banana-2.1');assert.equal(calls[0].body.replyType,'async');
 assert.equal(calls[0].body.imageSize,'2K');assert.equal(calls[0].body.aspectRatio,'16:9');
 assert.equal(calls[1].path,'/v1/api/result?id=test-task-001');assert.equal(calls[1].method,'GET');assert.equal(calls[1].auth,'Bearer fake-test-key');
 assert.equal(calls.length,2);assert.equal(progress[0].id,'test-task-001');
});
test('Grsai resumes existing remote task ID without submitting a second paid generation',async t=>{
 let submissions=0,polls=0;
 const url=await mockServer(t,(req,raw,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/api/generate'){submissions++;return res.end(JSON.stringify({status:'running',id:'should-not-submit'}))}
  if(req.url.startsWith('/v1/api/result?')){polls++;return res.end(JSON.stringify({status:'failed',failure_reason:'mock upstream failed'}))}
  res.statusCode=404;res.end('{}');
 });
 await assert.rejects(()=>upstream.generate(setup(url),{...task,upstreamId:'already-paid-id'},[],null),/mock upstream failed/);
 assert.equal(submissions,0);assert.equal(polls,1);
});
test('Grsai reference images use new unified images array and masked edits are rejected before billing',async t=>{
 let post=null;let url;
 url=await mockServer(t,(req,raw,res)=>{
  if(req.url==='/v1/api/generate'){post=JSON.parse(raw.toString('utf8'));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'succeeded',results:[{b64_json:PNG.toString('base64')}]}));return}
  if(req.url==='/pic.png'){res.end(PNG);return}
  res.statusCode=404;res.end('not found');
 });
 const image={mime:'image/png',bytes:PNG};
 const result=await upstream.generate(setup(url),task,[image],null);
 assert.equal(result.mime,'image/png');assert.equal(post.images.length,1);
 assert.match(post.images[0],/^data:image\/png;base64,/);
 const before=post;
 await assert.rejects(()=>upstream.generate(setup(url),task,[image],{bytes:PNG}),/蒙版/);
 assert.equal(post,before,'mask rejected before any paid request');
});
test('Grsai is not silently routed to Gemini/OpenAI text and does not spoof /models',async()=>{
 const provider=setup('https://grsaiapi.com');
 await assert.rejects(()=>upstream.listModels(provider),/没有公开标准模型列表/);
 await assert.rejects(()=>upstream.reverse(provider,{mime:'image/png',base64:PNG.toString('base64')},task.model),/不支持反推/);
 await assert.rejects(()=>upstream.generateText(provider,{model:'nano-banana-2.1',prompt:'hello'}),/不支持文字对话/);
 const code=fs.readFileSync(path.join(__dirname,'../workspace.js'),'utf8');
 const ui=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.match(code,/\['openai','gemini','grsai'\]/);
 assert.match(ui,/mode==='grsai'/);
 assert.match(html,/<option value="grsai">Grsai 图片 API<\/option>/);
});

test('Account API saves Grsai protocol and queues one real-shaped async image job (mock upstream; no billing)',async t=>{
 const {spawn}=require('node:child_process');const {mkdtempSync,rmSync}=require('node:fs');const os=require('node:os'),net=require('node:net');
 const port=()=>new Promise(ok=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>ok(n))})});
 const upstreamCalls=[];let base;
 base=await mockServer(t,(req,raw,res)=>{
   upstreamCalls.push({method:req.method,url:req.url});
   res.setHeader('Content-Type','application/json');
   if(req.url==='/v1/api/generate'){assert.equal(req.headers.authorization,'Bearer test-grsai-key');const b=JSON.parse(raw.toString());assert.equal(b.model,'nano-banana-2.1');assert.equal(b.replyType,'async');return res.end(JSON.stringify({id:'grsai-remote-job-42',status:'running'}));}
   if(req.url==='/v1/api/result?id=grsai-remote-job-42')return res.end(JSON.stringify({id:'grsai-remote-job-42',status:'succeeded',results:[{b64_json:PNG.toString('base64')}]}));
   res.statusCode=404;res.end(JSON.stringify({error:'unexpected'}));
 });
 const root=mkdtempSync(path.join(os.tmpdir(),'hamoki-grsai-flow-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const appPort=await port();
 const gateway=spawn(process.execPath,[path.join(__dirname,'../gateway.js')],{cwd:path.join(__dirname,'..'),env:{...process.env,DATA_DIR:root,APP_ALLOWED_HOST:'ps.test',APP_ENCRYPTION_KEY:'unit-test-grsai-secret-567890abcdef',INVITE_CODE:'hamoki',HOST:'127.0.0.1',PORT:String(appPort),COOKIE_SECURE:'0',NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1'},stdio:['ignore','pipe','pipe']});
 t.after(()=>gateway.kill('SIGTERM'));let logs='';gateway.stdout.on('data',b=>logs+=b);gateway.stderr.on('data',b=>logs+=b);
 for(let i=0;i<120&&!logs.includes('account gateway ready');i++){if(gateway.exitCode!==null)throw Error(logs);await new Promise(ok=>setTimeout(ok,40))}
 assert.match(logs,/account gateway ready/);
 let cookie='';
 const call=async(endpoint,method='GET',body)=>new Promise((ok,fail)=>{
   const data=body===undefined?undefined:Buffer.from(JSON.stringify(body));
   const req=http.request({hostname:'127.0.0.1',port:appPort,path:endpoint,method,headers:{Host:'ps.test',...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json','Content-Length':data.length}:{})}},res=>{
    const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];ok({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())})});
   });req.on('error',fail);req.end(data);
 });
 const reg=await call('/api/register','POST',{username:'grsai_test',password:'password123',inviteCode:'hamoki'});
 assert.equal(reg.status,201,JSON.stringify(reg.body));
 const provider=await call('/api/providers','POST',{name:'Grsai Test',url:base,mode:'grsai',apiKey:'test-grsai-key',imageMode:'grsai',capabilities:{image:{enabled:true,defaultModel:''},vision:{enabled:false},text:{enabled:false}}});
 assert.equal(provider.status,201,JSON.stringify(provider.body));
 assert.equal(provider.body.provider.mode,'grsai');assert.equal(provider.body.provider.imageMode,'grsai');assert.equal(provider.body.provider.imageModel,'');
 const id=provider.body.provider.id;
 const projects=await call('/api/projects');const projectId=projects.body.projects[0].id;
 const submitted=await call('/api/jobs','POST',{projectId,providerId:id,model:'nano-banana-2.1',prompt:'一只小猴子',ratio:'1:1',resolution:'1K',count:1});
 assert.equal(submitted.status,201,JSON.stringify(submitted.body));
 const jobId=submitted.body.jobs[0].id;
 let job=null;
 for(let i=0;i<120;i++){
  const result=await call('/api/jobs?projectId='+projectId);
  job=result.body.jobs.find(x=>x.id===jobId);
  if(['done','failed'].includes(job?.status))break;
  await new Promise(ok=>setTimeout(ok,90));
 }
 assert.equal(job?.status,'done',JSON.stringify(job));assert.equal(job?.upstreamId,'grsai-remote-job-42');
 assert.equal(upstreamCalls.filter(c=>c.url==='/v1/api/generate').length,1,'exactly one paid mock submit');
 assert.ok(upstreamCalls.some(c=>c.method==='GET'&&c.url==='/v1/api/result?id=grsai-remote-job-42'));
 const history=await call('/api/history?projectId='+projectId);
 assert.equal(history.body.history[0].model,'nano-banana-2.1');
});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),net=require('node:net');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==';
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
async function port(){const s=net.createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const p=s.address().port;await new Promise(ok=>s.close(ok));return p}
async function until(f){for(let i=0;i<130;i++){const v=await f();if(v)return v;await sleep(75)}throw Error('Timed out waiting for the image review')}
test('approved project image becomes style reference, and explicit review records outcome without retrying',async t=>{
 const requests=[];
 const mock=http.createServer(async(req,res)=>{
  const parts=[];for await(const x of req)parts.push(x);
  requests.push({path:req.url,size:Buffer.concat(parts).length});
  res.writeHead(200,{'Content-Type':'application/json'});
  if(req.url.includes('/chat/completions')){
   return res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({status:'needs_work',summary:'顶部按钮尺寸有偏差',issues:['按钮尺寸与参考不一致'],correction:'只调整顶部按钮尺寸，其他保持不变'})}}]}));
  }
  return res.end(JSON.stringify({data:[{b64_json:png}]}));
 });
 await new Promise(ok=>mock.listen(0,'127.0.0.1',ok));t.after(()=>mock.close());
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-art-review-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const appPort=await port(),root=path.resolve(__dirname,'..'),env={...process.env,
   PORT:String(appPort),DATA_DIR:dir,HOST:'127.0.0.1',INVITE_CODE:'hamoki',APP_ALLOWED_HOST:'ps.test',APP_ENCRYPTION_KEY:'assistant-review-integration-secret-256bits-long',
   ALLOW_PRIVATE_UPSTREAMS:'1',NODE_ENV:'test',COOKIE_SECURE:'1'};
 const child=spawn(process.execPath,[path.join(root,'gateway.js')],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',x=>output+=x);
 t.after(()=>child.kill());
 await until(()=>{if(child.exitCode!==null)throw Error('Server failed: '+output.slice(-1000));return output.includes('account gateway ready')});
 let cookie='';
 async function api(route,method='GET',body){
  const payload=body===undefined?null:Buffer.from(JSON.stringify(body));
  return await new Promise((resolve,reject)=>{
   const req=http.request({host:'127.0.0.1',port:appPort,path:route,method,headers:{Host:'ps.test',...(cookie?{Cookie:cookie}:{}),...(payload?{'Content-Type':'application/json','Content-Length':payload.length}:{})}},res=>{
    const parts=[];res.on('data',x=>parts.push(x));res.on('end',()=>{
      if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];
      const raw=Buffer.concat(parts).toString('utf8');
      resolve({status:res.statusCode,body:JSON.parse(raw)});
    });
   });req.on('error',reject);req.end(payload);
  });
 }
 assert.equal((await api('/api/register','POST',{username:'testreview',password:'mock-test-password',inviteCode:'hamoki'})).status,201);
 const project=(await api('/api/projects')).body.projects[0].id;
 const provider=(await api('/api/providers','POST',{name:'mock-upstream',url:'http://127.0.0.1:'+mock.address().port+'/v1',
   mode:'openai',imageMode:'images',apiKey:'local-fixture',imageModel:'gpt-image-1',visionModel:'gpt-4o-mini'})).body.provider;
 assert.ok(provider.id);
 const make=(autoFixMax=0)=>api('/api/jobs','POST',{projectId:project,providerId:provider.id,model:'gpt-image-1',prompt:'绘制周年庆活动界面',
   ratio:'1:1',resolution:'1K',quality:'auto',count:1,
   review:{enabled:true,confirmed:true,providerId:provider.id,model:'gpt-4o-mini',autoFixMax}});
 const first=await make();assert.equal(first.status,201,JSON.stringify(first.body));
 const h1=await until(async()=>{const x=(await api('/api/history?projectId='+project)).body.history[0];return x?.review?.status==='needs_work'?x:null});
 assert.match(h1.review.correction,/只调整/);
 const state=(await api('/api/projects/'+project)).body.project;
 const node=state.nodes.find(n=>n.historyId===h1.id);
 assert.ok(node);
 const accepted=await api('/api/projects/'+project+'/memory/feedback','POST',{nodeId:node.id,historyId:h1.id,kind:'approved'});
 assert.equal(accepted.status,200);
 const second=await make();assert.equal(second.status,201,JSON.stringify(second.body));
 assert.equal(second.body.jobs[0].sourceId,null,'style reference cannot silently become an edit source');
 const h2=await until(async()=>{const x=(await api('/api/history?projectId='+project)).body.history[0];return x?.id!==h1.id&&x.review?.status==='needs_work'?x:null});
 assert.equal(h2.parentId,null);
 assert.equal(requests.filter(x=>x.path.includes('/chat/completions')).length,2,'one review per paid image');
 assert.equal(requests.filter(x=>x.path.includes('/images/')).length,2,'no automatic paid correction was triggered');
 assert.ok(requests.some(x=>x.path.includes('/images/edits')),'approved style image sent to image model');
 // Simulate a paid correction budget of exactly one. The mock reviewer rejects
 // BOTH generations so the second result must not trigger a third billable call.
 const third=await make(1);assert.equal(third.status,201);
 const fixed=await until(async()=>{
  const recent=(await api('/api/history?projectId='+project)).body.history;
  const child=recent.find(x=>x.parentId&&x.review?.status==='needs_work');
  return child&&recent.find(x=>x.id===child.parentId)?.review?.autoFix?.status==='done'?child:null;
 });
 assert.ok(fixed.parentId,'the one correction must be linked to its previous version');
 assert.equal(requests.filter(x=>x.path.includes('/images/')).length,4,'exactly three requested images and one auto correction');
 assert.equal(requests.filter(x=>x.path.includes('/chat/completions')).length,4,'review exactly once per image');
 const allJobs=(await api('/api/jobs')).body.jobs;
 assert.equal(allJobs.filter(x=>x.autoFixDepth===1).length,1,'auto correction cannot recursively spend quota');
});

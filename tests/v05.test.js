'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {spawn}=require('node:child_process');const http=require('node:http');const net=require('node:net');
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==';
const IMG='data:image/png;base64,'+PNG;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const randomPort=()=>new Promise(ok=>{const srv=net.createServer();srv.listen(0,'127.0.0.1',()=>{const port=srv.address().port;srv.close(()=>ok(port))})});
async function waitFor(fn,ms=12000){const end=Date.now()+ms;while(Date.now()<end){const result=await fn();if(result)return result;await sleep(70)}throw Error('Timeout waiting for server/job state')}
test('V0.5 real adapters: conversational edit, role-based multi-reference, transparent bg, probes, queue backoff',async t=>{
 const seen={generations:[],edits:[],vision:0,rateHits:0};
 const mock=http.createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  const body=Buffer.concat(chunks).toString('utf8');const json=req.headers['content-type']?.includes('application/json')?JSON.parse(body||'{}'):{};
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'gpt-image-2'},{id:'gpt-4o-mini'}]}));
  if(req.url==='/v1/chat/completions'){seen.vision++;return res.end(JSON.stringify({choices:[{message:{content:'一只橘色小猴子举着放大镜'}}]}))}
  if(req.url==='/v1/images/generations'){
    seen.generations.push(json);
    if(json.model==='limited'){seen.rateHits++;if(seen.rateHits===1){res.statusCode=429;res.setHeader('Retry-After','1');return res.end(JSON.stringify({error:{message:'Rate limit, 1 second'}}))}}
    return res.end(JSON.stringify({data:[{b64_json:PNG}]}));
  }
  if(req.url==='/v1/images/edits'){
    seen.edits.push(body);
    return res.end(JSON.stringify({data:[{b64_json:PNG}]}));
  }
  res.statusCode=404;res.end(JSON.stringify({error:{message:'bad route'}}));
 });
 await new Promise(done=>mock.listen(0,'127.0.0.1',done));t.after(()=>mock.close());
 const port=await randomPort(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-v05-'));
 t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const proc=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,APP_PASSWORD:'v05-test-password-sufficient',NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1',DATA_DIR:tmp,PORT:String(port),MAX_CONCURRENT:'2'},stdio:['ignore','pipe','pipe']});
 t.after(()=>proc.kill('SIGTERM'));let logs='';proc.stdout.on('data',c=>logs+=c);proc.stderr.on('data',c=>logs+=c);
 await waitFor(()=>logs.includes('ready at'));
 const base='http://127.0.0.1:'+port;let cookie='';
 async function api(url,method='GET',payload){const r=await fetch(base+url,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(payload===undefined?{}:{'Content-Type':'application/json'})},body:payload===undefined?undefined:JSON.stringify(payload)});return {status:r.status,body:await r.json(),headers:r.headers}}
 const login=await api('/api/login','POST',{password:'v05-test-password-sufficient'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
 const projectId=(await api('/api/projects')).body.projects[0].id;
 const p=(await api('/api/providers','POST',{name:'接口验证',url:'http://127.0.0.1:'+mock.address().port+'/v1',mode:'openai',imageMode:'images',imageModel:'gpt-image-2',visionModel:'gpt-4o-mini',apiKey:'test-key'})).body.provider.id;
 const cap=(await api('/api/providers/'+p+'/capabilities')).body;
 assert.equal(cap.support.mask,'model-dependent');assert.equal(cap.verified.textToImage,undefined);
 assert.equal((await api('/api/providers/'+p+'/probe','POST',{kind:'generate'})).status,400);
 const probe=(await api('/api/providers/'+p+'/probe','POST',{kind:'generate',confirmCost:true})).body;
 assert.equal(probe.success,true);assert.ok(probe.previewUrl.startsWith('/api/media/'));
 assert.equal((await api('/api/providers/'+p+'/probe','POST',{kind:'reverse',confirmCost:true})).body.success,true);
 assert.equal((await api('/api/providers/'+p+'/probe','POST',{kind:'edit',confirmCost:true})).body.success,true);
 const validated=(await api('/api/providers/'+p+'/capabilities')).body.verified;
 assert.ok(validated.textToImage.success&&validated.imageReverse.success&&validated.referenceImage.success);
 const one=(await api('/api/jobs','POST',{projectId,providerId:p,prompt:'橙色小猴子戴帽子和护目镜',count:1})).body.jobs[0];
 await waitFor(async()=>{const j=(await api('/api/jobs')).body.jobs.find(x=>x.id===one.id);return j?.status==='done'});
 const baseHistory=(await api('/api/history')).body.history[0];
 const parentId=baseHistory.id;const allNodes=(await api('/api/projects/'+projectId)).body.project.nodes;
 const generated=allNodes.find(n=>n.historyId===parentId);assert.ok(generated);
 const second=(await api('/api/projects/'+projectId+'/assets','POST',{image:IMG,name:'配色参考',x:480,y:180})).body.node;
 const edit=(await api('/api/jobs','POST',{projectId,providerId:p,sourceId:parentId,sourceNodeId:generated.id,referenceNodes:[{nodeId:generated.id,role:'shape'},{nodeId:second.id,role:'color'}],prompt:'换成红色头发，其他不变',ratio:'2:3',resolution:'2K',count:1,transparentBg:true})).body.jobs[0];
 await waitFor(async()=>{const j=(await api('/api/jobs')).body.jobs.find(x=>x.id===edit.id);return j?.status==='done'});
 const edited=(await api('/api/history')).body.history.find(h=>h.jobId===edit.id);
 assert.equal(edited.parentId,parentId);assert.equal(edited.transparentBg,true);assert.equal(edited.editInstruction,'换成红色头发，其他不变');
 assert.ok(seen.edits.some(text=>text.includes('橙色小猴子戴帽子和护目镜')&&text.includes('换成红色头发')&&text.includes('只参考这张图的配色')&&text.includes('name="background"')&&text.includes('transparent')));
 const msg=(await api('/api/projects/'+projectId)).body.project.messages.find(m=>m.groupId===edit.groupId&&m.role==='user');
 assert.equal(msg.referenceRoles[1].role,'color');
 // A 429 with Retry-After:1 must wait rather than retry immediately (prevents repeated billing).
 const wait=(await api('/api/jobs','POST',{projectId,providerId:p,model:'limited',prompt:'退避重试',count:1})).body.jobs[0];
 await waitFor(()=>seen.rateHits>=1);await sleep(210);assert.equal(seen.rateHits,1,'A rate-limited task must not restart immediately');
 await waitFor(async()=>{const j=(await api('/api/jobs')).body.jobs.find(x=>x.id===wait.id);return j?.status==='done'},7000);
 assert.equal(seen.rateHits,2);
 const noBatch=await api('/api/jobs','POST',{projectId,providerId:p,prompt:'超过单批上限',count:33});assert.equal(noBatch.status,400);
 const batch=await api('/api/queue','POST',{action:'pause'});assert.equal(batch.status,200);
 const many=await api('/api/jobs','POST',{projectId,providerId:p,prompt:'32张批量队列',count:32});assert.equal(many.status,201);assert.equal(many.body.jobs.length,32);
 const queue=(await api('/api/jobs?projectId='+projectId)).body.jobs;assert.ok(queue.filter(j=>many.body.jobs.some(q=>q.id===j.id)&&j.status==='queued').length===32);
 assert.equal((await api('/api/queue','POST',{action:'resume'})).status,200);
 await waitFor(async()=>{const j=(await api('/api/jobs')).body.jobs.filter(j=>many.body.jobs.some(x=>x.id===j.id));return j.every(x=>x.status==='done')},25000);
 assert.equal(seen.vision,1);assert.ok(seen.edits.length>=2);assert.ok(seen.generations.length>=34);
});

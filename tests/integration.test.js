'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const PORT=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
const sleep=n=>new Promise(r=>setTimeout(r,n));
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==';
const img='data:image/png;base64,'+PNG;
async function start(port,tmp){const proc=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,APP_PASSWORD:'very-strong-password-123',PORT:String(port),HOST:'127.0.0.1',DATA_DIR:tmp,NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1',MAX_CONCURRENT:'2'},stdio:['ignore','pipe','pipe']});let logs='';proc.stdout.on('data',x=>logs+=x);proc.stderr.on('data',x=>logs+=x);for(let i=0;i<100;i++){if(logs.includes('ready at'))return proc;if(proc.exitCode!==null)throw Error('Server exited: '+logs);await sleep(60)}throw Error('Server did not start: '+logs)}
async function waitFor(cond,ms=13000){const end=Date.now()+ms;while(Date.now()<end){const ret=await cond();if(ret)return ret;await sleep(70)}throw Error('Timed out waiting for expected state')}
test('providers, reverse, multiple image adapters, masks, compare, queue, downloads, encryption',async t=>{
  const hits={images:0,edits:0,gemini:0,chat:0,responses:0,retry:0,vision:0};let lastEdit='';
  const upstream=http.createServer(async(req,res)=>{
    const chunks=[];for await(const part of req)chunks.push(part);const raw=Buffer.concat(chunks);const text=raw.toString('utf8');const parsed=req.headers['content-type']?.includes('json')?JSON.parse(text||'{}'):{};
    res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/models'||req.url==='/v1beta/models'){res.end(JSON.stringify({data:[{id:'gpt-image-2'},{id:'gpt-4o-mini'},{id:'retry-model'}]}));return}
    if(req.url==='/v1/chat/completions'){
      hits.chat++;if(parsed.model==='gpt-4o-mini'){hits.vision++;assert.ok(parsed.messages[0].content[1].image_url.url.startsWith('data:image/png;base64,'));res.end(JSON.stringify({choices:[{message:{content:'橙色小猴子拿着放大镜。'}}]}));return}
      assert.equal(parsed.model,'chat-image');res.end(JSON.stringify({choices:[{message:{images:[{image_url:{url:img}}]}}]}));return;
    }
    if(req.url==='/v1/images/generations'){
      hits.images++;if(parsed.model==='retry-model'){hits.retry++;if(hits.retry===1){res.statusCode=429;res.end(JSON.stringify({error:{message:'try later'}}));return}}
      assert.equal(req.headers.authorization,'Bearer sk-first');assert.match(parsed.prompt,/1:1|16:9/);res.end(JSON.stringify({data:[{b64_json:PNG}]}));return;
    }
    if(req.url==='/v1/images/edits'){
      hits.edits++;lastEdit=text;assert.match(req.headers['content-type'],/multipart\/form-data/);assert.match(text,/name="image"|name="image\[\]"/);res.end(JSON.stringify({data:[{b64_json:PNG}]}));return;
    }
    if(req.url==='/v1beta/models/gemini-2.5-flash:generateContent'){
      assert.equal(req.headers['x-goog-api-key'],'sk-second');res.end(JSON.stringify({candidates:[{content:{parts:[{text:'精致动漫插画风格，赛璐璐上色，干净线条。'}]}}]}));return;
    }
    if(req.url==='/v1beta/models/gemini-2.5-flash-image:generateContent'){
      hits.gemini++;assert.equal(req.headers['x-goog-api-key'],'sk-second');assert.deepEqual(parsed.generationConfig.responseModalities,['TEXT','IMAGE']);res.end(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:PNG}}]}}]}));return;
    }
    if(req.url==='/v1/responses'){
      hits.responses++;assert.equal(parsed.tools[0].type,'image_generation');assert.equal(parsed.tools[0].model,'gpt-image-2');res.end(JSON.stringify({output:[{type:'image_generation_call',result:PNG}]}));return;
    }
    res.statusCode=404;res.end(JSON.stringify({error:{message:'not found '+req.url}}));
  });
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));t.after(()=>upstream.close());const endpointPort=upstream.address().port;
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hs-v03-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));const port=await PORT();let proc=await start(port,tmp);t.after(()=>proc.kill('SIGTERM'));
  const base=`http://127.0.0.1:${port}`;let cookie='';
  async function api(route,method='GET',body){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});const contentType=r.headers.get('content-type')||'';return {status:r.status,headers:r.headers,data:contentType.includes('application/json')?await r.json():await r.arrayBuffer()}}
  const unauth=await api('/api/providers');assert.equal(unauth.status,401);
  const wrong=await api('/api/login','POST',{password:'bad'});assert.equal(wrong.status,401);
  const login=await api('/api/login','POST',{password:'very-strong-password-123'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  const addp=async b=>(await api('/api/providers','POST',b)).data.provider.id;
  const baseProvider={name:'站点 A',url:`http://127.0.0.1:${endpointPort}/v1`,mode:'openai',imageMode:'images',imageModel:'gpt-image-2',visionModel:'gpt-4o-mini',apiKey:'sk-first'};
  const a=await addp(baseProvider);
  const g=await addp({name:'Gemini 站',url:`http://127.0.0.1:${endpointPort}/v1beta`,mode:'gemini',imageModel:'gemini-2.5-flash-image',visionModel:'gemini-2.5-flash',apiKey:'sk-second'});
  const c=await addp({...baseProvider,name:'Chat 站',imageMode:'chat',imageModel:'chat-image',apiKey:'sk-third'});
  const d=await addp({...baseProvider,name:'Responses 站',imageMode:'responses',responseModel:'gpt-5',apiKey:'sk-fourth'});
  const providers=await api('/api/providers');assert.equal(providers.data.providers.length,4);assert.equal(providers.data.providers[0].hasKey,true);assert.equal(JSON.stringify(providers.data).includes('sk-first'),false);
  const crypt=fs.readFileSync(path.join(tmp,'providers.enc.json'),'utf8');assert.ok(!crypt.includes('sk-first')&&!crypt.includes('站点 A'));
  const models=await api('/api/providers/'+a+'/check');assert.equal(models.data.reachable,true);assert.ok(models.data.latencyMs>=0);
  const reverse=await api('/api/reverse','POST',{providerId:a,image:img,kind:'detailed'});assert.equal(reverse.status,200);assert.match(reverse.data.prompt,/橙色小猴/);
  const geminiReverse=await api('/api/reverse','POST',{providerId:g,image:img,kind:'style'});assert.equal(geminiReverse.status,200);assert.match(geminiReverse.data.prompt,/赛璐璐/);
  const invalid=await api('/api/reverse','POST',{providerId:a,image:'data:text/html;base64,YWJj'});assert.equal(invalid.status,400);
  const configUpdate=await api('/api/providers/'+c,'PUT',{name:'Chat 站改名',mode:'openai',imageMode:'chat',imageModel:'chat-image',visionModel:'gpt-4o-mini',url:baseProvider.url});assert.equal(configUpdate.status,200);assert.equal(configUpdate.data.provider.hasKey,true);
  const activated=await api('/api/providers/'+g+'/activate','POST',{});assert.equal(activated.data.activeId,g);
  const jobResult=await api('/api/jobs','POST',{providerId:a,prompt:'一只探险猴子',ratio:'1:1',resolution:'1K',quality:'high',count:2,references:[]});assert.equal(jobResult.status,201);assert.equal(jobResult.data.jobs.length,2);
  await waitFor(async()=>{const j=await api('/api/jobs');return j.data.jobs.filter(x=>jobResult.data.jobs.some(y=>y.id===x.id)).every(x=>x.status==='done')});
  let hist=(await api('/api/history')).data.history;assert.equal(hist.length,2);assert.ok(hist[0].url.startsWith('/api/media/'));
  const asset=await fetch(base+hist[0].url,{headers:{Cookie:cookie}});assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/image\/png/);assert.ok((await asset.arrayBuffer()).byteLength>30);
  const forbidden=await fetch(base+hist[0].url);assert.equal(forbidden.status,401);
  const favorite=await api('/api/history/'+hist[0].id+'/favorite','POST',{favorite:true});assert.equal(favorite.data.image.favorite,true);
  const favs=await api('/api/history?favorite=1');assert.equal(favs.data.history.length,1);
  const parent=hist[0].id;
  const edit=await api('/api/jobs','POST',{providerId:a,prompt:'修改眼睛',sourceId:parent,mask:img,ratio:'1:1',resolution:'1K',quality:'auto',count:1});assert.equal(edit.status,201);
  await waitFor(async()=>{const j=(await api('/api/jobs')).data.jobs.find(x=>x.id===edit.data.jobs[0].id);return j.status==='done'});
  hist=(await api('/api/history')).data.history;assert.ok(hist.some(x=>x.parentId===parent&&x.masked));assert.match(lastEdit,/name="mask"/);
  const compare=await api('/api/jobs','POST',{prompt:'宇航员在火星上',ratio:'16:9',resolution:'2K',quality:'medium',count:1,targets:[{providerId:a},{providerId:g},{providerId:c},{providerId:d}],references:[img]});assert.equal(compare.status,201);assert.equal(compare.data.jobs.length,4);
  await waitFor(async()=>{const all=(await api('/api/jobs')).data.jobs;return compare.data.jobs.every(x=>all.find(y=>y.id===x.id)?.status==='done')},18000);
  hist=(await api('/api/history')).data.history;assert.ok(hist.filter(x=>x.groupId===compare.data.groupId).length===4);assert.ok(hits.gemini&&hits.chat&&hits.responses&&hits.edits>=2);
  const zip=await api('/api/export');assert.equal(zip.status,200);assert.equal(Buffer.from(zip.data).toString('ascii',0,2),'PK');
  const download=await fetch(base+'/api/download/'+hist[0].id,{headers:{Cookie:cookie}});assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);
  await api('/api/queue','POST',{action:'pause'});
  const q=await api('/api/jobs','POST',{providerId:a,prompt:'取消的工作',ratio:'1:1',resolution:'1K',quality:'auto',count:1});const pending=q.data.jobs[0].id;
  assert.equal((await api('/api/jobs')).data.jobs.find(x=>x.id===pending).status,'queued');
  assert.equal((await api('/api/jobs/'+pending+'/cancel','POST',{})).data.job.status,'cancelled');
  const retried=await api('/api/jobs/'+pending+'/retry','POST',{});assert.equal(retried.status,201);assert.equal((await api('/api/jobs')).data.paused,true);
  await api('/api/queue','POST',{action:'resume'});
  await waitFor(async()=>{const all=(await api('/api/jobs')).data.jobs;return all.find(x=>x.id===retried.data.job.id).status==='done'});
  const limited=await api('/api/jobs','POST',{providerId:a,model:'retry-model',prompt:'限流测试',ratio:'1:1',resolution:'1K',quality:'auto',count:1});
  await waitFor(async()=>{const all=(await api('/api/jobs')).data.jobs;return all.find(x=>x.id===limited.data.jobs[0].id).status==='done'},15000);assert.equal(hits.retry,2);
  const csrf=await fetch(base+'/api/queue',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',Origin:'https://evil.example'},body:'{"action":"pause"}'});assert.equal(csrf.status,403);
  assert.equal((await fetch(base+'/assets/hamoki-avatar-128.png')).status,200);
  assert.match(await (await fetch(base+'/')).text(),/图片反推/);
  await new Promise(r=>{proc.once('exit',r);proc.kill('SIGTERM')});
  proc=await start(port,tmp);cookie='';const relog=await api('/api/login','POST',{password:'very-strong-password-123'});cookie=relog.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/api/providers')).data.providers.length,4);assert.ok((await api('/api/history')).data.history.length>=9);
});

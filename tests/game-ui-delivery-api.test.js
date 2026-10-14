'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process'),{randomBytes}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),net=require('node:net');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const socket=net.createServer();socket.listen(0,'127.0.0.1',()=>{const p=socket.address().port;socket.close(()=>resolve(p))})});
const image=execFileSync('python3',['-c',"import io,base64;from PIL import Image,ImageDraw;im=Image.new('RGB',(480,270),(19,26,32));d=ImageDraw.Draw(im);d.rectangle((42,50,175,199),fill=(240,189,59));d.rectangle((280,63,410,206),fill=(88,190,124));out=io.BytesIO();im.save(out,format='PNG');print(base64.b64encode(out.getvalue()).decode())"]).toString().trim();
test('authenticated end-to-end: mock image -> original sprite split -> reviewed atlas and zip',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-ui-delivery-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let generated=0;
 const mock=http.createServer(async(req,res)=>{
  for await(const part of req)void part;
  res.setHeader('Content-Type','application/json');
  if(req.url.endsWith('/images/generations')){generated++;return res.end(JSON.stringify({data:[{b64_json:image}]}))}
  return res.end(JSON.stringify({choices:[{message:{content:'Mock'}}]}));
 });
 await new Promise(done=>mock.listen(0,'127.0.0.1',done));t.after(()=>mock.close());
 const port=await freePort();
 const app=spawn(process.execPath,[path.join(__dirname,'..','gateway.js')],{
  env:{...process.env,DATA_DIR:dir,PORT:String(port),APP_ALLOWED_HOST:'127.0.0.1',NODE_ENV:'test',
       INVITE_CODE:'delivery-testing-only',APP_ENCRYPTION_KEY:randomBytes(40).toString('hex'),
       ALLOW_PRIVATE_UPSTREAMS:'1'},stdio:['ignore','pipe','pipe']
 });
 t.after(()=>app.kill());
 let startup='';app.stdout.on('data',b=>startup+=b);app.stderr.on('data',b=>startup+=b);
 for(let i=0;i<180&&!startup.includes('account gateway ready');i++)await sleep(50);
 assert.match(startup,/account gateway ready/);
 let cookie='';const origin='http://127.0.0.1:'+port;
 async function call(uri,method='GET',payload){
  const resp=await fetch(origin+uri,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});
  const type=resp.headers.get('content-type')||'';
  return {status:resp.status,body:type.includes('application/json')?await resp.json():await resp.arrayBuffer(),
          cookie:resp.headers.get('set-cookie')};
 }
 assert.equal((await call('/api/projects')).status,401);
 const reg=await call('/api/register','POST',{username:'deliverytester',password:'testing123',inviteCode:'delivery-testing-only'});
 assert.equal(reg.status,201,JSON.stringify(reg.body));cookie=reg.cookie.split(';')[0];
 const loaded=await call('/api/projects');assert.equal(loaded.status,200,JSON.stringify(loaded.body)+'\n'+startup.slice(-1800));
 const projectId=loaded.body.projects[0].id,base='/api/projects/'+projectId+'/delivery';
 const provider=await call('/api/providers','POST',{name:'Mock images',url:'http://127.0.0.1:'+mock.address().port+'/v1',
    mode:'openai',imageMode:'images',apiKey:'testing-only',capabilities:{image:{defaultModel:'image-model'}}});
 assert.equal(provider.status,201,JSON.stringify(provider.body));
 const pid=provider.body.provider.id;
 const submitted=await call('/api/jobs','POST',{projectId,prompt:'Two isolated UI button assets with a solid dark background',providerId:pid,model:'image-model',ratio:'16:9',resolution:'1K',count:1});
 assert.equal(submitted.status,201,JSON.stringify(submitted.body));
 let finished=false;
 for(let i=0;i<120;i++){
  const jobs=(await call('/api/jobs?projectId='+projectId)).body.jobs;
  if(jobs.some(j=>j.status==='done')){finished=true;break}
  await sleep(70);
 }
 assert.ok(finished,'the source image job must finish');assert.equal(generated,1);
 const history=(await call('/api/history?projectId='+projectId)).body.history;
 assert.ok(history.length>=1);
 const source=history[0].id;
 assert.equal((await call(base+'/split','POST',{historyId:source})).status,400,'approved page gate');
 assert.equal((await call(base+'/split','POST',{historyId:'f0000000-0000-4000-a000-000000000000',approvedPage:true})).status,400);
 const request=await call(base+'/split','POST',{historyId:source,approvedPage:true,mode:'background',tolerance:8,connectGap:0});
 assert.equal(request.status,202,JSON.stringify(request.body));
 let view,pack;
 for(let i=0;i<140;i++){
  view=(await call(base)).body;pack=view.packs[0];
  if(pack?.status!=='splitting')break;
  await sleep(75);
 }
 assert.equal(pack.status,'review',pack.error);assert.equal(pack.items.length,2);
 assert.equal((await call(base+'/'+pack.id+'/file/zip')).status,400,'cannot download before review');
 assert.equal((await call(base+'/'+pack.id+'/file/sprite/0')).status,200);
 assert.equal((await call('/api/projects/f0000000-0000-4000-a000-000000000000/delivery/'+pack.id+'/file/sprite/0')).status,404);
 const mapping=pack.items.map((x,i)=>({...x,semanticName:['button-primary','icon-gold'][i],category:i?'icon':'control',
  state:'default',sliceType:i?'1:1':'9-slice',margins:i?[0,0,0,0]:[12,12,12,12]}));
 assert.equal((await call(base+'/approve','POST',{packId:pack.id,items:mapping,confirmTextFree:true})).status,400);
 assert.equal((await call(base+'/approve','POST',{packId:pack.id,items:mapping.map(x=>({...x,semanticName:'duplicate'})),confirmTextFree:true,confirmSlices:true})).status,400);
 const approved=await call(base+'/approve','POST',{packId:pack.id,items:mapping,confirmTextFree:true,confirmSlices:true});
 assert.equal(approved.status,202,JSON.stringify(approved.body));
 for(let i=0;i<150;i++){
  view=(await call(base)).body;pack=view.packs.find(x=>x.id===pack.id);
  if(pack.status!=='delivering')break;
  await sleep(75);
 }
 assert.equal(pack.status,'delivered',pack.error);assert.deepEqual(pack.targets,['unity','cocos','godot','generic']);
 for(const suffix of ['zip','reviewed-zip','atlas','unity','cocos','godot','generic']){
  const r=await call(base+'/'+pack.id+'/file/'+suffix);assert.equal(r.status,200,suffix);
  if(['unity','cocos','godot','generic'].includes(suffix))assert.equal(r.body.engine,suffix);
  else assert.ok(r.body.byteLength>20,suffix);
 }
 assert.equal((await call(base+'/approve','POST',{packId:pack.id,items:mapping,confirmTextFree:true,confirmSlices:true})).status,400);
 assert.equal(generated,1,'no additional AI model requests were performed by local export');
});

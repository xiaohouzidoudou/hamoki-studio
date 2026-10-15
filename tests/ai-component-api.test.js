'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const http=require('node:http'),net=require('node:net'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const port=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
test('one real-shaped source -> AI detection -> approved batch -> independently normalized PNGs',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-component-e2e-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const image=execFileSync('python3',['-c','import io,sys;from PIL import Image,ImageDraw;im=Image.new("RGB",(96,64),(242,242,242));ImageDraw.Draw(im).rectangle((20,12,74,52),fill=(202,45,23));buf=io.BytesIO();im.save(buf,format="PNG");sys.stdout.buffer.write(buf.getvalue())']);
 let visionCalls=0,imageCalls=0;
 const mock=http.createServer(async(req,res)=>{
  const buffers=[];for await(const chunk of req)buffers.push(chunk);
  res.setHeader('Content-Type','application/json');
  if(req.url.endsWith('/chat/completions')){
   visionCalls++;
   return res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({items:[
    {name:'原画干净背景',category:'background',box:[0,0,1000,1000],description:'非常干净的浅灰色机械活动背景，需要移除覆盖的界面元素'},
    {name:'红色活动按钮',category:'control',box:[208,187,771,813],description:'红色立体卡通按钮，具有明显金属粗边和鲜艳高光质感'}
   ]})}}]}));
  }
  imageCalls++;res.end(JSON.stringify({data:[{b64_json:image.toString('base64')}]}));
 });
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));t.after(()=>mock.close());
 const p=await port(),child=spawn(process.execPath,[path.join(__dirname,'../gateway.js')],{cwd:path.join(__dirname,'..'),env:{...process.env,NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1',PORT:String(p),DATA_DIR:dir,APP_ALLOWED_HOST:'127.0.0.1',INVITE_CODE:'comp-qa-invite',APP_ENCRYPTION_KEY:'hamoki-component-test-private-key-long-enough'},stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 for(let n=0;n<160&&!output.includes('account gateway ready');n++)await wait(50);
 assert.match(output,/account gateway ready/,output.slice(-800));
 const root='http://127.0.0.1:'+p;let cookie='';
 async function req(uri,method='GET',data){
  const result=await fetch(root+uri,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
  const body=await result.json();return {status:result.status,body,headers:result.headers};
 }
 assert.equal((await req('/api/projects')).status,401);
 const signed=await req('/api/register','POST',{username:'designer',password:'sample-pass-234',inviteCode:'comp-qa-invite'});
 assert.equal(signed.status,201,JSON.stringify(signed.body));cookie=signed.headers.get('set-cookie').split(';')[0];
 const proj=(await req('/api/projects')).body.projects[0].id;
 const provider=await req('/api/providers','POST',{name:'Mock UI provider',url:'http://127.0.0.1:'+mock.address().port+'/v1',mode:'openai',imageMode:'images',apiKey:'stub-key',imageModel:'img-test',visionModel:'vision-test'});
 assert.equal(provider.status,201,JSON.stringify(provider.body));const providerId=provider.body.provider.id;
 const generated=await req('/api/jobs','POST',{projectId:proj,providerId,model:'img-test',prompt:'一张蓝色游戏活动主界面',ratio:'1:1',resolution:'1K',count:1});
 assert.equal(generated.status,201,JSON.stringify(generated.body));const sourceJob=generated.body.jobs[0].id;
 async function until(fn,limit=12000){for(let elapsed=0;elapsed<limit;elapsed+=160){const v=await fn();if(v)return v;await wait(160)}throw Error('timed out, logs '+output.slice(-1400))}
 const source=await until(async()=>{const q=(await req('/api/jobs')).body.jobs.find(x=>x.id===sourceJob);return q?.status==='done'?q.resultId:null});
 assert.equal((await req('/api/projects/'+proj+'/ai-components')).body.plan,null);
 assert.equal((await req('/api/projects/'+proj+'/ai-components/analyze','POST',{historyId:source,confirmCost:false})).status,400);
 assert.equal(visionCalls,0);
 assert.equal((await req('/api/projects/'+proj+'/ai-components/analyze','POST',{historyId:source,confirmCost:true,vision:{providerId,model:'vision-test'}})).status,202);
 const identified=await until(async()=>{const v=(await req('/api/projects/'+proj+'/ai-components')).body.plan;return v?.status==='ready'?v:null});
 assert.equal(identified.items.length,2);
 assert.equal(visionCalls,1);
 const chargeBefore=imageCalls;
 assert.equal((await req('/api/projects/'+proj+'/ai-components/generate-all','POST',{confirmCost:false})).status,400);
 assert.equal(imageCalls,chargeBefore);
 const all=await req('/api/projects/'+proj+'/ai-components/generate-all','POST',{confirmCost:true,image:{providerId,model:'img-test'}});
 assert.equal(all.status,202,JSON.stringify(all.body));
 const finished=await until(async()=>{const v=(await req('/api/projects/'+proj+'/ai-components')).body.plan;return v?.items?.every(item=>item.status==='done')?v:null},20000);
 assert.equal(finished.items.length,2);
 assert.equal(imageCalls,chargeBefore+2);
 assert.equal(finished.items[0].url.startsWith('/api/media/'),true);
 assert.equal(finished.items[1].transparentVerified,true);
 const media=await fetch(root+finished.items[1].url,{headers:{Cookie:cookie}});
 assert.equal(media.status,200);assert.match(media.headers.get('content-type'),/image\/png/);
 assert.deepEqual([...new Uint8Array((await media.arrayBuffer()).slice(0,8))],[137,80,78,71,13,10,26,10]);
 assert.equal((await req('/api/projects/'+proj+'/ai-components/generate-all','POST',{confirmCost:true,image:{providerId,model:'img-test'}})).status,400);
 assert.equal((await req('/api/projects/'+proj+'/ai-components/generate','POST',{confirmCost:false,itemId:identified.items[1].id})).status,400);
 assert.equal((await req('/api/projects/'+proj+'/ai-components/generate','POST',{confirmCost:true,itemId:identified.items[1].id,retry:true,image:{providerId,model:'img-test'}})).status,202);
 const repeated=await until(async()=>{const v=(await req('/api/projects/'+proj+'/ai-components')).body.plan.items[1];return v.status==='done'&&v.resultId!==finished.items[1].resultId?v:null},12000);
 assert.ok(repeated.resultId);
});



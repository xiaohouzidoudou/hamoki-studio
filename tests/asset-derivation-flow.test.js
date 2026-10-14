'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{randomBytes}=require('node:crypto');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),net=require('node:net');
const {styleOutput}=require('./fixtures/ai-asset-style.fixture');
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==';
const kinds=['screen','kit','icons','background','character'],wait=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(ok=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>s.close(()=>ok(s.address()?.port)))});
test('one picture to five queued and finished game assets with explicit fees',async t=>{
 const baseDir=fs.mkdtempSync(path.join(os.tmpdir(),'asset-family-'));t.after(()=>fs.rmSync(baseDir,{recursive:true,force:true}));
 let calls={vision:0,text:0,image:0};
 const mock=http.createServer(async(req,res)=>{
  let data='';for await(const chunk of req)data+=chunk;
  res.setHeader('Content-Type','application/json');
  if(req.url.endsWith('/images/edits')||req.url.endsWith('/images/generations')){
   assert.match(req.headers['content-type'],/multipart\/form-data|application\/json/);
   calls.image++;return res.end(JSON.stringify({data:[{b64_json:image}]}));
  }
  const b=JSON.parse(data||'{}');
  if(Array.isArray(b.messages?.[0]?.content)){calls.vision++;return res.end(JSON.stringify({choices:[{message:{content:styleOutput}}]}))}
  calls.text++;
  const items=kinds.map((kind,i)=>({index:i+1,kind,prompt:('同一个游戏 Style DNA 统一卡通材质和粗描边，准确制作 '+kind+' 素材，无不必要前景与装饰。').repeat(7)}));
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({items})}}]}));
 });
 await new Promise(ok=>mock.listen(0,'127.0.0.1',ok));t.after(()=>mock.close());
 const serverPort=await new Promise(ok=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>ok(p))})});
 const env={...process.env,PORT:String(serverPort),DATA_DIR:baseDir,APP_ALLOWED_HOST:'127.0.0.1',NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1',INVITE_CODE:'test-invite',APP_ENCRYPTION_KEY:randomBytes(40).toString('hex')};
 const app=spawn(process.execPath,[path.join(__dirname,'..','gateway.js')],{env,stdio:['ignore','pipe','pipe']});
 t.after(()=>app.kill());
 let log='';app.stdout.on('data',c=>log+=c);app.stderr.on('data',c=>log+=c);
 for(let i=0;i<160&&!log.includes('account gateway ready');i++)await wait(50);
 assert.match(log,/account gateway ready/);
 let cookie='';const origin='http://127.0.0.1:'+serverPort;
 async function call(url,method='GET',body){
  const res=await fetch(origin+url,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  return {code:res.status,json:await res.json(),cookie:res.headers.get('set-cookie')};
 }
 assert.equal((await call('/api/projects')).code,401);
 const signed=await call('/api/register','POST',{inviteCode:'test-invite',username:'testerasset',password:'testpass123'});
 assert.equal(signed.code,201,JSON.stringify(signed.json));cookie=signed.cookie.split(';')[0];
 const id=(await call('/api/projects')).json.projects[0].id,base='/api/projects/'+id+'/derive';
 const imported=await call('/api/projects/'+id+'/assets','POST',{name:'样例画风',image:'data:image/png;base64,'+image});
 assert.equal(imported.code,201,JSON.stringify(imported.json));
 const pic=imported.json.node.id;
 const prov=await call('/api/providers','POST',{name:'test models',mode:'openai',imageMode:'images',url:'http://127.0.0.1:'+mock.address().port+'/v1',apiKey:'mock-key',
 capabilities:{text:{defaultModel:'mock-text'},vision:{defaultModel:'mock-vision'},image:{defaultModel:'mock-image'}}});
 assert.equal(prov.code,201,JSON.stringify(prov.json));
 const p=prov.json.provider.id,vision={providerId:p,model:'mock-vision'},text={providerId:p,model:'mock-text'},img={providerId:p,model:'mock-image'};
 const initial=await call(base);
 assert.equal(initial.json.derivation.drafts.length,0);
 assert.equal((await call(base+'/style','POST',{referenceNodeIds:[pic],vision})).code,400);
 assert.deepEqual(calls,{vision:0,text:0,image:0});
 assert.equal((await call(base+'/style','POST',{referenceNodeIds:[pic],vision,confirmCost:true})).code,202);
 async function settled(){for(let i=0;i<130;i++){const x=(await call(base)).json;if(x.derivation.status!=='running')return x;await wait(60)}throw Error('run not settled')}
 let view=await settled();assert.equal(view.derivation.status,'ready',view.derivation.error);assert.equal(calls.vision,1);
 const inputs=kinds.map(kind=>({kind,description:'完成 '+kind+' 素材，画风和比例统一'}));
 assert.equal((await call(base+'/prepare','POST',{items:inputs,referenceNodeIds:[pic],styleSource:'derived',text})).code,400);
 assert.equal(calls.text,0);
 assert.equal((await call(base+'/prepare','POST',{items:inputs,referenceNodeIds:[pic],styleSource:'derived',text,confirmCost:true})).code,202);
 view=await settled();assert.equal(view.derivation.status,'ready',view.derivation.error);
 assert.equal(view.derivation.drafts.length,5);assert.equal(calls.text,1);assert.equal(calls.image,0);
 const ids=view.derivation.drafts.map(x=>x.id);
 assert.equal((await call(base+'/submit','POST',{ids,image:img,resolution:'1K'})).code,400);
 assert.equal(calls.image,0);
 const sent=await call(base+'/submit','POST',{ids,image:img,resolution:'1K',confirmCost:true});
 assert.equal(sent.code,201,JSON.stringify(sent.json));assert.equal(sent.json.jobs.length,5);
 assert.equal((await call(base+'/submit','POST',{ids,image:img,resolution:'1K',confirmCost:true})).code,400);
 let finished=false;
 for(let i=0;i<200;i++){const jobs=(await call('/api/jobs?projectId='+id)).json.jobs;
  if(jobs.filter(x=>x.groupId===sent.json.groupId&&x.status==='done').length===5){finished=true;break}await wait(75)}
 assert.ok(finished,'all five images finish through existing queue');assert.equal(calls.image,5);
 view=(await call(base)).json;assert.equal(view.derivation.drafts.filter(x=>x.status==='done').length,5);
});

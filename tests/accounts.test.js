'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const net=require('node:net');
const getPort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==';
const img='data:image/png;base64,'+PNG;

async function launch(port,dataDir){
 const child=spawn(process.execPath,[path.resolve(__dirname,'../gateway.js')],{cwd:path.resolve(__dirname,'..'),env:{...process.env,DATA_DIR:dataDir,APP_ALLOWED_HOST:'ps.test',APP_ENCRYPTION_KEY:'dedicated-test-secret-is-not-a-production-key-123456',HOST:'127.0.0.1',PORT:String(port),COOKIE_SECURE:'1',NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1',INVITE_CODE:'hamoki',USER_QUOTA_GB:'1',TOTAL_QUOTA_GB:'5'},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
 for(let i=0;i<110;i++){if(output.includes('account gateway ready'))return child;if(child.exitCode!==null)throw Error('Gateway exited: '+output);await wait(50)}
 child.kill();throw Error('Gateway failed to start: '+output);
}

test('V0.6.3 account workspaces isolate users, keys, media and survive restart',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-account-'));
 t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 const port=await getPort();let child=await launch(port,dataDir);t.after(()=>child.kill('SIGTERM'));
 let hits=0;
 const mock=http.createServer(async(req,res)=>{
   if(req.url==='/v1/images/generations'){
     hits++;
     assert.equal(req.headers.authorization,'Bearer example-own-secret');
     for await(const _ of req){}
     res.writeHead(200,{'Content-Type':'application/json'});
     res.end(JSON.stringify({data:[{b64_json:PNG}]}));return;
   }
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'gpt-image-1'}]}));
 });
 await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));t.after(()=>mock.close());
 const endpoint=`http://127.0.0.1:${mock.address().port}/v1`;
 function client(){
  let cookie='';
  return {get cookie(){return cookie},set cookie(c){cookie=c},async request(api,method='GET',body,origin){
   const {status,raw,headers}=await new Promise((resolve,reject)=>{
    const payload=body===undefined?null:Buffer.from(JSON.stringify(body));
    const request=http.request({hostname:'127.0.0.1',port,path:api,method,headers:{Host:'ps.test',...(cookie?{Cookie:cookie}:{}),...(payload?{'Content-Type':'application/json','Content-Length':payload.length}:{}),...(origin?{Origin:origin}:{})}},response=>{
      const chunks=[];response.on('data',part=>chunks.push(part));response.on('end',()=>resolve({status:response.statusCode,raw:Buffer.concat(chunks),headers:response.headers}));
    });request.on('error',reject);request.end(payload);
   });
   if(headers['set-cookie']?.[0])cookie=headers['set-cookie'][0].split(';')[0];
   return {status,body:(headers['content-type']||'').includes('application/json')?JSON.parse(raw.toString()):raw,headers:{get(name){return headers[name.toLowerCase()]?.[0]&&name.toLowerCase()==='set-cookie'?headers[name.toLowerCase()][0]:headers[name.toLowerCase()]||null}}};
  }};
 }
 const a=client(),b=client();
 assert.equal((await a.request('/api/providers')).status,401);
 const status0=await a.request('/api/status');
 assert.equal(status0.status,200);assert.equal(status0.body.authenticated,false);assert.equal(status0.body.accountMode,true);assert.equal(status0.body.version,'0.6.27');
 const ra=await a.request('/api/register','POST',{inviteCode:'hamoki',username:'usera',password:'secret123'});
 assert.equal(ra.status,201,JSON.stringify(ra.body));assert.equal(ra.body.user.name,'usera');
 const freshStorage=await a.request('/api/storage');
 assert.equal(freshStorage.status,200,'logged-in storage endpoint works on fresh account');
 assert.equal(typeof freshStorage.body.totalBytes,'number');
 assert.equal(typeof freshStorage.body.quotaBytes,'number');
 assert.ok(freshStorage.body.quotaBytes>0);

 const rb=await b.request('/api/register','POST',{inviteCode:'hamoki',username:'userb',password:'secret456'});
 assert.equal(rb.status,201,JSON.stringify(rb.body));
 assert.match(ra.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Secure/);
 assert.equal((await b.request('/api/register','POST',{inviteCode:'hamoki',username:'usera',password:'secret123'})).status,409);
 const pa=(await a.request('/api/projects')).body.projects[0].id;
 const pb=(await b.request('/api/projects')).body.projects[0].id;
 assert.notEqual(pa,pb);
 const aCreated=await a.request('/api/projects','POST',{title:'A 机甲设计'});
 assert.equal(aCreated.status,201);const projectA=aCreated.body.project.id;
 assert.equal((await b.request('/api/projects')).body.projects.length,1);
 assert.equal((await b.request('/api/projects/'+projectA)).status,404);
 const add=await a.request('/api/providers','POST',{name:'A 私人模型',url:endpoint,mode:'openai',imageMode:'images',imageModel:'gpt-image-1',visionModel:'gpt-4o-mini',apiKey:'example-own-secret'});
 assert.equal(add.status,201,JSON.stringify(add.body));const pid=add.body.provider.id;
 assert.equal((await a.request('/api/providers')).body.providers.length,1);
 assert.equal((await b.request('/api/providers')).body.providers.length,0);
 const uploaded=await a.request('/api/projects/'+projectA+'/assets','POST',{image:img,name:'私人参考图',x:40,y:50});
 assert.equal(uploaded.status,201);const photo=uploaded.body.node.url;
 assert.equal((await a.request(photo)).status,200);
 assert.equal((await b.request(photo)).status,404);
 const csrf=await a.request('/api/projects','POST',{title:'恶意跨站'},'https://evil.example');assert.equal(csrf.status,403);
 const noKey=await b.request('/api/jobs','POST',{prompt:'不能使用 A 的 Key',count:1});assert.equal(noKey.status,400);assert.equal(hits,0);
 const submitted=await a.request('/api/jobs','POST',{projectId:projectA,providerId:pid,prompt:'画一只戴帽子的小猴子',count:1,ratio:'1:1',resolution:'1K'});
 assert.equal(submitted.status,201,JSON.stringify(submitted.body));
 let entry=null;
 for(let i=0;i<140;i++){
  const jobs=(await a.request('/api/jobs?projectId='+projectA)).body.jobs;
  entry=jobs.find(j=>j.id===submitted.body.jobs[0].id);
  if(entry?.status==='done'||entry?.status==='failed')break;
  await wait(60);
 }
 assert.equal(entry?.status,'done',JSON.stringify(entry));assert.equal(hits,1);
 const hist=(await a.request('/api/history?projectId='+projectA)).body.history;
 assert.equal(hist.length,1);
 assert.equal((await b.request('/api/history')).body.history.length,0);
 assert.equal((await b.request(hist[0].url)).status,404);
 const projectNodes=(await a.request('/api/projects/'+projectA)).body.project.nodes;
 assert.equal(projectNodes.length,2,'reference and generated image should be on canvas');
 const ids=projectNodes.map(n=>n.id);
 const bundle=await a.request('/api/projects/'+projectA+'/nodes/export?ids='+ids.join(','));
 assert.equal(bundle.status,200);
 assert.equal(bundle.body.subarray(0,2).toString(),'PK','export is ZIP of original image bytes');
 assert.match(bundle.headers.get('content-disposition'),/hamoki-selected-images.zip/);
 assert.equal((await b.request('/api/projects/'+projectA+'/nodes/export?ids='+ids.join(','))).status,404,'other accounts cannot access bulk ZIP');
 const remove=await a.request('/api/projects/'+projectA+'/nodes/batch','DELETE',{ids});
 assert.equal(remove.status,200,JSON.stringify(remove.body));
 assert.equal((await a.request('/api/projects/'+projectA)).body.project.nodes.length,0);
 assert.equal((await a.request('/api/history?projectId='+projectA)).body.history.length,1,'removing canvas nodes never deletes generated history');
 const badRestore=await b.request('/api/projects/'+projectA+'/nodes/restore','POST',{batchId:remove.body.batchId});
 assert.equal(badRestore.status,404,'batch restore is account- and project-scoped');
 const restore=await a.request('/api/projects/'+projectA+'/nodes/restore','POST',{batchId:remove.body.batchId});
 assert.equal(restore.status,200,JSON.stringify(restore.body));
 assert.equal(restore.body.restored.length,2);
 assert.equal((await a.request('/api/projects/'+projectA)).body.project.nodes.length,2);
 assert.equal((await a.request('/api/projects/'+projectA+'/nodes/restore','POST',{batchId:remove.body.batchId})).status,404,'undo cannot restore twice');
 const duplicate=await a.request('/api/projects/'+projectA+'/nodes/batch','DELETE',{ids:[ids[0],ids[0]]});
 assert.equal(duplicate.status,400);
 const invalidZip=await a.request('/api/projects/'+projectA+'/nodes/export?ids='+ids[0]+','+ids[0]);
 assert.equal(invalidZip.status,400);
 assert.equal((await a.request('/api/logout','POST',{})).status,200);
 assert.equal((await a.request('/api/providers')).status,401);
 const badLogin=await a.request('/api/login','POST',{username:'usera',password:'wrongpass'});assert.equal(badLogin.status,401);
 const goodLogin=await a.request('/api/login','POST',{username:'usera',password:'secret123'});assert.equal(goodLogin.status,200);
 await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM')});
 child=await launch(port,dataDir);
 assert.equal((await a.request('/api/providers')).status,200); // persistent secure session survives restart
 const relogin=await a.request('/api/login','POST',{username:'usera',password:'secret123'});assert.equal(relogin.status,200);
 assert.equal((await a.request('/api/projects')).body.projects.length,2);
 assert.equal((await a.request('/api/providers')).body.providers.length,1);
 assert.equal((await a.request('/api/history')).body.history.length,1);
 assert.equal((await b.request('/api/login','POST',{username:'userb',password:'secret456'})).status,200);
 assert.equal((await b.request('/api/providers')).body.providers.length,0);
 const usersDir=path.join(dataDir,'users');
 assert.equal(fs.readdirSync(usersDir).length,2);
});

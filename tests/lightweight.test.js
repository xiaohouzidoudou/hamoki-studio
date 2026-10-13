'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){return await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==','base64');
const webp=fs.readFileSync(path.join(__dirname,'..','assets','hamoki-avatar-128.webp'));
async function start(t,{MEDIA_QUOTA_GB='8',MAX_CONCURRENT='1'}={}){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-light-')),PORT=await port(),base=`http://127.0.0.1:${PORT}`;
 const server=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,APP_PASSWORD:'strong-test-password-here',DEMO_MODE:'1',DATA_DIR:folder,PORT:String(PORT),MEDIA_QUOTA_GB,MAX_CONCURRENT},stdio:['ignore','pipe','pipe']});
 t.after(()=>{server.kill('SIGTERM');fs.rmSync(folder,{recursive:true,force:true})});
 let log='';server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
 for(let i=0;i<80&&!log.includes('ready at');i++)await sleep(60);
 assert.match(log,/ready at/);
 let cookie='';
 async function req(uri,method='GET',body=null,headers={}){
  const res=await fetch(base+uri,{method,headers:{...headers,...(cookie?{Cookie:cookie}:{}),...(body!==null?{'Content-Type':'application/json'}:{})},body:body!==null?JSON.stringify(body):undefined});
  const raw=Buffer.from(await res.arrayBuffer()),type=res.headers.get('content-type')||'';
  return {status:res.status,body:type.includes('application/json')?JSON.parse(raw.toString()):raw,raw,headers:res.headers};
 }
 const login=await req('/api/login','POST',{password:'strong-test-password-here'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
 return {req,folder,base};
}
test('V0.6.1 browser previews are separate, cached, authenticated and do not replace original images',async t=>{
 const a=await start(t,{MAX_CONCURRENT:'8'});const {req}=a;
 const project=(await req('/api/projects')).body.defaultId;
 const s=(await req('/api/storage')).body;assert.equal(s.mode,'local');assert.equal(s.concurrency,2);assert.equal(s.originalBytes,0);
 const upload=await req(`/api/projects/${project}/assets`,'POST',{image:'data:image/png;base64,'+png.toString('base64'),preview:'data:image/webp;base64,'+webp.toString('base64'),name:'reference'});
 assert.equal(upload.status,201,JSON.stringify(upload.body));assert.match(upload.body.node.previewUrl,/^\/api\/previews\//);
 const full=await req(upload.body.node.url),thumb=await req(upload.body.node.previewUrl);
 assert.equal(full.status,200);assert.equal(thumb.status,200);assert.equal(full.headers.get('content-type'),'image/png');assert.equal(thumb.headers.get('content-type'),'image/webp');assert.deepEqual(full.raw,png);assert.deepEqual(thumb.raw,webp);assert.equal(Number(full.headers.get('content-length')),png.length);
 assert.match(full.headers.get('cache-control'),/private/);
 const unchanged=await req(upload.body.node.url,'GET',null,{'If-None-Match':full.headers.get('etag')});assert.equal(unchanged.status,304);assert.equal(unchanged.raw.length,0);
 const used=(await req('/api/storage')).body;assert.equal(used.originalBytes,png.length);assert.equal(used.previewBytes,webp.length);assert.equal(used.originalCount,1);assert.equal(used.previewCount,1);
 const second=await req(`/api/projects/${project}/assets`,'POST',{image:'data:image/png;base64,'+png.toString('base64'),name:'another'});assert.equal(second.status,201);
 const missing=await req(second.body.node.previewUrl);assert.equal(missing.status,404);
 const created=await req(second.body.node.url+'/preview','POST',{preview:'data:image/webp;base64,'+webp.toString('base64')});assert.equal(created.status,201);assert.equal(created.body.saved,true);
 const duplicate=await req(second.body.node.url+'/preview','POST',{preview:'data:image/webp;base64,'+webp.toString('base64')});assert.equal(duplicate.status,201);assert.equal(duplicate.body.saved,false);
 const notImage=await req(second.body.node.url+'/preview','POST',{preview:'data:image/png;base64,'+png.toString('base64')});assert.equal(notImage.status,413);
 const unknown=await req('/api/media/00000000-0000-0000-0000-000000000000.png/preview','POST',{preview:'data:image/webp;base64,'+webp.toString('base64')});assert.equal(unknown.status,404);
 const generated=(await req('/api/jobs','POST',{projectId:project,prompt:'demo',count:1,ratio:'1:1'}));assert.equal(generated.status,201);
 await sleep(250);const history=(await req(`/api/history?projectId=${project}`)).body.history;
 assert.equal(history.length,1);assert.ok(history[0].previewUrl);assert.equal((await req(history[0].url)).status,200);
});
test('V0.6.1 disk budget rejects new originals safely and retains old files',async t=>{
 const {req}=await start(t,{MEDIA_QUOTA_GB:'0.000001'});const project=(await req('/api/projects')).body.defaultId;
 const okay=await req(`/api/projects/${project}/assets`,'POST',{image:'data:image/png;base64,'+png.toString('base64'),name:'small'});assert.equal(okay.status,201);
 const big=Buffer.concat([png,Buffer.alloc(1500)]);
 const denied=await req(`/api/projects/${project}/assets`,'POST',{image:'data:image/png;base64,'+big.toString('base64'),name:'not enough space'});
 assert.equal(denied.status,413);assert.match(denied.body.error,/空间预算/);
 const original=await req(okay.body.node.url);assert.equal(original.status,200);assert.deepEqual(original.raw,png);
 const usage=(await req('/api/storage')).body;assert.equal(usage.originalCount,1);assert.equal(usage.originalBytes,png.length);
});

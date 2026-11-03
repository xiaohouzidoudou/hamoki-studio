'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {prepare,serve,readRecord}=require('../lib/cowart-archive');
const zip=require('../lib/zip');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==','base64');

async function start(t,overrides={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cowart-upload-'));
 const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;await new Promise(r=>server.close(r));
 let child;
 async function launch(){
  child=spawn(process.execPath,[path.join(__dirname,'../gateway.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',APP_ALLOWED_HOST:'ps.test',APP_ENCRYPTION_KEY:'cowart-upload-test-only-12345678901234567890',INVITE_CODE:'local',COOKIE_SECURE:'0',NODE_ENV:'test',COWART_PREVIEW:'1',...overrides},stdio:['ignore','pipe','pipe']});
  let logs='';for(const s of [child.stdout,child.stderr])s.on('data',b=>logs+=b);
  for(let i=0;i<150;i++){
   if(logs.includes('account gateway ready'))return;
   if(child.exitCode!==null)throw Error(logs);
   await new Promise(r=>setTimeout(r,30));
  }
  throw Error('Gateway did not start: '+logs);
 }
 async function stop(){if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done}}
 await launch();
 t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true})});
 function client(){let cookie='';return async(api,method='GET',body,headers={})=>{
  const bytes=body===undefined?null:Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
  return new Promise((resolve,reject)=>{
   const req=http.request({hostname:'127.0.0.1',port,path:api,method,headers:{Host:'ps.test',...(cookie?{Cookie:cookie}:{}),...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{}),...headers}},res=>{
    const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{
     if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];
     const raw=Buffer.concat(chunks);resolve({status:res.statusCode,body:(res.headers['content-type']||'').includes('json')?JSON.parse(raw):raw});
    });
   });req.on('error',reject);req.end(bytes);
  });
 }}
 return {dir,client,restart:async()=>{await stop();await launch()}};
}

const {Readable}=require('node:stream');
const {File}=require('node:buffer');
const {spawnSync}=require('node:child_process');
const imageName='12345678-1234-1234-1234-123456789abc.png';
function snapshot(src='/api/media/'+imageName){
 return {schema:{hamokiCanvas:2},store:{
  'page:source':{id:'page:source',typeName:'page',name:'原页面',index:'a1',meta:{}},
  'asset:source':{id:'asset:source',typeName:'asset',type:'image',meta:{preserved:true},props:{src,mimeType:'image/png',w:1,h:1}},
  'shape:source':{id:'shape:source',typeName:'shape',type:'image',parentId:'page:source',index:'a1',x:20,y:30,rotation:.4,opacity:.8,props:{assetId:'asset:source',w:180,h:180,crop:{topLeft:{x:.1,y:0},bottomRight:{x:.9,y:1}},flipX:true},meta:{studioHistoryId:'old-history',studioProjectId:'old-project'}},
  'shape:annotation':{id:'shape:annotation',typeName:'shape',type:'text',parentId:'page:source',index:'a2',x:220,y:30,props:{text:'注释'},meta:{cowartAnnotationSourceShapeId:'shape:source'}},
  'opaque:legacy':{id:'opaque:legacy',typeName:'future-record',meta:{untouched:true}}
 }};
}
async function collect(files){const chunks=[];for await(const bytes of zip.streamFiles(files))chunks.push(bytes);return Buffer.concat(chunks)}
async function temporary(t){const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'canvas-archive-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir}
async function inlineArchive(){return prepare(snapshot('data:image/png;base64,'+png.toString('base64')),'/unused',{projectId:'source',revision:7})}
async function archiveClient(){return import('../cowart/src/canvas/archive.js')}

test('完整备份原图逐字节可被标准 ZIP 读取，清单校验且源快照不变',async t=>{
 const dir=await temporary(t);fs.writeFileSync(path.join(dir,imageName),png);
 const source=snapshot(),before=structuredClone(source),archive=await prepare(source,dir,{projectId:'source',revision:7});
 const bytes=await collect(archive.files);assert.equal(bytes.length,archive.length);assert.deepEqual(source,before);
 const file=path.join(dir,'backup.zip');fs.writeFileSync(file,bytes);
 const checked=spawnSync('python3',['-c',`import zipfile,json,hashlib,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 m=json.loads(z.read('canvas.json'))
 assert len(z.namelist())==2 and m['sourceRevision']==7
 f=m['files'][0]
 assert hashlib.sha256(z.read(f['path'])).hexdigest()==f['sha256']
 print(z.read(f['path']).hex())`,file],{encoding:'utf8'});
 assert.equal(checked.status,0,checked.stderr);assert.equal(checked.stdout.trim(),png.toString('hex'));
 const {openArchive,restoreArchive}=await archiveClient();
 const opened=await openArchive(new File([bytes],'backup.zip'));
 let uploads=0;
 const restored=await restoreArchive(opened,async blob=>{uploads++;assert.deepEqual(Buffer.from(await blob.arrayBuffer()),png);return '/api/media/'+imageName});
 const abort=new AbortController();
 await assert.rejects(restoreArchive(opened,async()=>{abort.abort();return '/api/media/'+imageName},{signal:abort.signal}),{name:'AbortError'});
 assert.equal(opened.snapshot.store['shape:source'].meta.studioHistoryId,'old-history','取消不能改变待导入文档');
 assert.equal(uploads,1);assert.deepEqual(restored.store['shape:source'].props,before.store['shape:source'].props);
 assert.equal(restored.store['shape:source'].meta.studioHistoryId,undefined);
 assert.deepEqual(restored.store['shape:source'].meta.hamokiArchiveOrigin,{historyId:'old-history',projectId:'old-project'});
 const {CanvasDocument}=await import('../cowart/src/canvas/model.js');
 const doc=new CanvasDocument(null,{getBoundingClientRect:()=>({width:1000,height:700,left:0,top:0})});
 const oldPage=doc.pageId,previous=structuredClone(doc.records);
 doc.importSnapshot(restored);
 assert.ok(doc.records[oldPage]);assert.equal(doc.getPages().length,2);
 const imported=Object.values(doc.records).find(r=>r.meta?.hamokiArchiveOrigin);
 const annotation=Object.values(doc.records).find(r=>r.meta?.cowartAnnotationSourceShapeId);
 assert.equal(annotation.meta.cowartAnnotationSourceShapeId,imported.id);
 assert.notEqual(imported.id,'shape:source');
 doc.undo();assert.deepEqual(doc.records,previous);doc.redo();assert.equal(doc.getPages().length,2);
});

test('备份缺失原图、外部地址和符号链接在返回 ZIP 前拒绝',async t=>{
 const dir=await temporary(t);
 await assert.rejects(prepare(snapshot(),dir),/不可读取/);
 await assert.rejects(prepare(snapshot('https://example.com/private.png'),dir),/安全打包/);
 const external=path.join(dir,'external.png');fs.writeFileSync(external,png);fs.symlinkSync(external,path.join(dir,imageName));
 await assert.rejects(prepare(snapshot(),dir),/安全读取/);
 const missing=snapshot();delete missing.store['asset:source'];await assert.rejects(prepare(missing,dir),/引用缺失/);
 const empty=await prepare(null,dir);assert.equal(empty.manifest.files.length,0);
 const {openArchive}=await archiveClient();assert.ok((await openArchive(new File([await collect(empty.files)],'empty.zip'))).snapshot);
});

test('损坏、篡改清单、重复路径和未来版本备份均在上传前拒绝',async()=>{
 const archive=await inlineArchive(),bytes=await collect(archive.files),{openArchive}=await archiveClient();
 const corrupt=Buffer.from(bytes);const name=archive.files[1].name;
 const position=corrupt.indexOf(Buffer.from(name))+Buffer.byteLength(name);
 corrupt[position]^=1;
 await assert.rejects(openArchive(new File([corrupt],'broken.zip')),/校验/);
 async function modified(change){
  const manifest=structuredClone(archive.manifest);change(manifest);
  const bytes=Buffer.from(JSON.stringify(manifest));
  const first={name:'canvas.json',size:bytes.length,crc32:zip.crc32(bytes),open:()=>Readable.from([bytes])};
  return new File([await collect([first,...archive.files.slice(1)])],'tampered.zip');
 }
 await assert.rejects(openArchive(await modified(m=>m.files[0].sha256='0'.repeat(64))),/校验/);
 await assert.rejects(openArchive(await modified(m=>m.snapshot.schema.hamokiCanvas=3)),/较新的版本/);
 await assert.rejects(openArchive(await modified(m=>m.files.push(m.files[0]))),/清单/);
 await assert.rejects(openArchive(await modified(m=>m.snapshot.store['shape:source'].parentId='shape:source')),/层级循环/);
 await assert.rejects(openArchive(new File([bytes.subarray(0,bytes.length-1)],'truncated.zip')));
 const stopped=new AbortController();stopped.abort();
 await assert.rejects(openArchive(new File([bytes],'valid.zip'),{signal:stopped.signal}),{name:'AbortError'});
});

test('流式 ZIP 校验源文件变化并拒绝路径穿越，原有 pack 保持可用',async()=>{
 assert.equal(zip.crc32(Buffer.from('456789'),zip.crc32(Buffer.from('123'))),0xcbf43926);
 const file={name:'assets/file.png',size:3,crc32:zip.crc32(Buffer.from('abc')),open:()=>Readable.from([Buffer.from('abd')])};
 await assert.rejects(collect([file]),/source changed/);
 for(const name of ['../file','/file','a/../b','a\\b','a//b'])assert.throws(()=>zip.byteLength([{...file,name}]),/name/);
 assert.throws(()=>zip.byteLength([file,file]),/name/);
 assert.equal(zip.pack([{name:'old.png',bytes:png}]).readUInt32LE(0),0x04034b50);
});

test('完整备份 API 鉴权、账户隔离、原图缺失失败及只读版本保持',async t=>{
 const app=await start(t),a=app.client(),b=app.client(),guest=app.client();
 assert.equal((await guest('/api/cowart/archive?projectId=x')).status,401);
 for(const [client,username] of [[a,'archivea'],[b,'archiveb']])assert.equal((await client('/api/register','POST',{username,password:'password123',inviteCode:'local'})).status,201);
 const pa=(await a('/api/projects')).body.defaultId,pb=(await b('/api/projects')).body.defaultId;
 const route='/api/cowart/archive?projectId='+pa;
 assert.equal((await b(route)).status,404);assert.equal((await a(route,'POST')).status,405);
 assert.equal((await a(route,'POST',undefined,{Origin:'https://evil.invalid'})).status,403);
 const uploaded=await a('/api/cowart/assets?projectId='+pa,'POST',png,{'Content-Type':'image/png'});assert.equal(uploaded.status,201);
 const source=snapshot(uploaded.body.url);
 assert.equal((await a('/api/cowart/snapshot?projectId='+pa,'PUT',{snapshot:source,revision:0})).status,200);
 const before=(await a('/api/cowart/snapshot?projectId='+pa)).body;
 const result=await a(route);assert.equal(result.status,200);
 const {openArchive,restoreArchive}=await archiveClient();
 const opened=await openArchive(new File([result.body],'backup.zip'));
 assert.equal(opened.manifest.sourceProjectId,pa);
 const restored=await restoreArchive(opened,async blob=>{
  const put=await b('/api/cowart/assets?projectId='+pb,'POST',Buffer.from(await blob.arrayBuffer()),{'Content-Type':blob.type});
  assert.equal(put.status,201);return put.body.url;
 });
 assert.deepEqual((await b(restored.store['asset:source'].props.src)).body,png);
 assert.deepEqual((await a('/api/cowart/snapshot?projectId='+pa)).body,before,'导出不改变版本和任务状态');
 const foreign=snapshot(restored.store['asset:source'].props.src);
 assert.equal((await a('/api/cowart/snapshot?projectId='+pa,'PUT',{snapshot:foreign,revision:1})).status,200);
 const denied=await a(route);assert.equal(denied.status,409);assert.match(denied.body.error,/不可读取/);
 assert.equal((await a(route)).status,409,'失败必须释放下载锁');
 assert.deepEqual((await a(uploaded.body.url)).body,png,'不删除旧图');
});

test('同账号完整备份并发受限，客户端关闭后释放锁',async()=>{
 const {PassThrough}=require('node:stream');
 const makeResponse=()=>{const res=new PassThrough();res.writeHead=()=>{};return res};
 const options={accountId:'stream-test',projectId:'source',revision:0,snapshot:null,mediaDirectory:'/unused'};
 const first=makeResponse(),pending=serve({method:'GET'},first,options);
 await assert.rejects(serve({method:'GET'},makeResponse(),options),error=>error.status===429);
 first.destroy();await pending;
 const next=makeResponse();next.resume();await serve({method:'GET'},next,options);
 assert.equal(next.writableFinished,true);
});

test('未保存空画布可备份，损坏的已落盘 JSON 不得变成空白备份',async t=>{
 const dir=await temporary(t),file=path.join(dir,'snapshot.json');
 assert.equal(await readRecord(file),null);
 for(const invalid of ['{broken','null','{}','{"snapshot":null}']){
  fs.writeFileSync(file,invalid);
  await assert.rejects(readRecord(file),error=>error.status===409&&/损坏/.test(error.message));
 }
 const record={revision:9,snapshot:snapshot()};fs.writeFileSync(file,JSON.stringify(record));
 assert.deepEqual(await readRecord(file),record);
});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {spawn}=require('node:child_process'), net=require('node:net');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const port=()=>new Promise(ok=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>ok(n))})});
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==';
async function waitUntil(fn){for(let i=0;i<80;i++){const got=await fn();if(got)return got;await sleep(80)}throw Error('Timeout waiting for generated image')}
test('V0.6 batch scene updates, grouping and complete offline project backup/restore',async t=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-v06-'));const listen=await port();t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
 const server=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,APP_PASSWORD:'v06-secure-test-pass',DEMO_MODE:'1',DATA_DIR:data,PORT:String(listen)},stdio:['ignore','pipe','pipe']});t.after(()=>server.kill('SIGTERM'));let log='';server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
 await waitUntil(()=>log.includes('ready at'));const base=`http://127.0.0.1:${listen}`;let session='';
 async function request(endpoint,method='GET',body,raw=false){const res=await fetch(base+endpoint,{method,headers:{...(session?{Cookie:session}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,body:raw?Buffer.from(await res.arrayBuffer()):await res.json(),headers:res.headers}}
 const login=await request('/api/login','POST',{password:'v06-secure-test-pass'});assert.equal(login.status,200);session=login.headers.get('set-cookie').split(';')[0];
 const id=(await request('/api/projects')).body.defaultId;
 const note=(await request(`/api/projects/${id}/notes`,'POST',{x:45,y:75,text:'最初灵感'})).body.node;
 const asset=(await request(`/api/projects/${id}/assets`,'POST',{image:'data:image/png;base64,'+PNG,name:'原始图片',x:400,y:100,parentNodeId:note.id})).body.node;
 assert.equal(asset.parentNodeId,note.id);
 const update=(await request(`/api/projects/${id}/nodes/batch`,'PATCH',{updates:[{id:note.id,x:120,y:130,groupId:'a'.repeat(36)},{id:asset.id,x:600,y:140,groupId:'a'.repeat(36)}]}));assert.equal(update.status,200);assert.equal(update.body.nodes.length,2);
 const invalid=await request(`/api/projects/${id}/nodes/batch`,'PATCH',{updates:[{id:'deadbeef-dead-beef-dead-beefdeadbeef',x:55}]});assert.equal(invalid.status,400);
 const imageId=(await request('/api/jobs','POST',{projectId:id,prompt:'测试猴子',count:1,ratio:'1:1'})).body.jobs[0].id;
 await waitUntil(async()=>{const r=await request(`/api/jobs?projectId=${id}`);return r.body.jobs.find(j=>j.id===imageId)?.status==='done'});
 const project=(await request(`/api/projects/${id}`)).body.project;
 const layerOrder=project.nodes.map(n=>n.id).reverse();const reorder=await request(`/api/projects/${id}/nodes/batch`,'PATCH',{updates:[{id:note.id}],orderIds:layerOrder});assert.equal(reorder.status,200);
 const before=(await request(`/api/projects/${id}`)).body.project;assert.deepEqual(before.nodes.map(n=>n.id),layerOrder);
 const download=await request(`/api/projects/${id}/backup`,'GET',undefined,true);assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/\.hamoki/);assert.equal(download.body.subarray(0,2).toString('hex'),'1f8b');
 const contents=JSON.parse(zlib.gunzipSync(download.body).toString());assert.equal(contents.kind,'hamoki-project');assert.equal(contents.schema,1);assert.equal(contents.project.nodes.length,3);assert.ok(contents.history.length>=1);assert.ok(contents.media.length>=2);assert.ok(!JSON.stringify(contents).includes('apiKey'));
 const imported=await request('/api/projects/import','POST',{archive:download.body.toString('base64')});assert.equal(imported.status,201,JSON.stringify(imported.body));const copied=imported.body.project;
 assert.notEqual(copied.id,id);assert.equal(copied.nodes.length,before.nodes.length);assert.equal(copied.nodes.filter(x=>x.kind==='generated').length,1);assert.equal(copied.nodes.find(x=>x.kind==='reference').parentNodeId,copied.nodes.find(x=>x.kind==='note').id);
 const groupIds=copied.nodes.filter(x=>x.groupId).map(x=>x.groupId);assert.equal(new Set(groupIds).size,1);assert.notEqual(groupIds[0],'a'.repeat(36));
 const restoredHistory=(await request(`/api/history?projectId=${copied.id}`)).body.history;assert.equal(restoredHistory.length,contents.history.length);assert.ok(restoredHistory[0].url.startsWith('/api/media/'));
 const source=await request(restoredHistory[0].url,'GET',undefined,true);assert.equal(source.status,200);
 const corrupt=await request('/api/projects/import','POST',{archive:Buffer.from('bad').toString('base64')});assert.equal(corrupt.status,400);
 const stillOriginal=(await request(`/api/projects/${id}`)).body.project;assert.equal(stillOriginal.nodes.length,before.nodes.length);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createQueue,validate}=require('../assets/canvas-local-import.js');
const bytes=(size,name='picture.png')=>Object.assign(new Blob([Buffer.alloc(size)],{type:'image/png'}),{name});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const later=()=>{let yes,no;const promise=new Promise((resolve,reject)=>{yes=resolve;no=reject;});return {promise,resolve:yes,reject:no};};
function fixture(options={}){
 const persisted=options.persisted||new Map(),transports=[],events=[],committed=[],cancelled=[],urls=new Set();
 let seq=0;
 const storage={
   list:async projectId=>[...persisted.values()].filter(item=>item.projectId===projectId),
   put:async value=>{persisted.set(value.id,structuredClone(value));},
   remove:async id=>{persisted.delete(id);}
 };
 const transport=({item,onProgress})=>{
   const task=later();let aborted=false;
   const controller={item,onProgress,promise:task.promise,
     complete:(node={id:'server-'+item.id,url:'/media/'+item.id,kind:'reference'})=>task.resolve(node),
     fail:err=>task.reject(err||Error('mock upload failed')),
     abort:()=>{aborted=true;task.reject(Error('已取消上传'));},
     get aborted(){return aborted;}
   };
   transports.push(controller);return controller;
 };
 const queue=createQueue({
   storage,upload:transport,makeURL:()=>{const id='blob:test-'+(++seq);urls.add(id);return id;},
   revokeURL:url=>urls.delete(url),makeId:()=>('00000000-0000-4000-8000-'+String(++seq).padStart(12,'0')),
   maxConcurrent:options.maxConcurrent||2,
   onCommit:async(item,node)=>{committed.push({item,node,x:item.node.x,y:item.node.y});Object.assign(item.node,node,{x:item.node.x,y:item.node.y});},
   onCancelRemote:async item=>{cancelled.push(item.id);},
   notify:(type,item,error)=>events.push({type,id:item.id,error:error?.message})
 });
 return {queue,storage,persisted,transports,events,committed,cancelled,urls};
}
test('large PNG instant node before any network operation',async()=>{
 const f=fixture(),file=bytes(11*1024*1024);
 const node=f.queue.add(file,{projectId:'p',x:114,y:-50,w:300,h:200});
 assert.equal(node.x,114);assert.equal(node.y,-50);assert.equal(node.__local,true);
 assert.equal(f.transports.length,0); // upload waits for IndexedDB transaction
 await flush();
 assert.equal(f.transports.length,1);
 assert.equal(f.persisted.size,1);
 f.transports[0].onProgress(49);
 assert.equal(f.queue.get(node.id).progress,49);
 f.transports[0].complete();
 await flush();await flush();
 assert.equal(f.committed.length,1);assert.equal(f.committed[0].x,114);
 assert.equal(f.queue.get(node.id),null);
 assert.equal(f.persisted.size,0);
});
test('multi-file parallelism with per-file independent progress',async()=>{
 const f=fixture(),nodes=Array.from({length:7},(_,i)=>f.queue.add(bytes(1000,'f'+i+'.png'),{projectId:'p',x:20+i*330}));
 await flush();assert.equal(f.transports.length,2);
 f.transports[0].onProgress(12);f.transports[1].onProgress(71);
 assert.equal(f.queue.get(nodes[0].id).progress,12);
 assert.equal(f.queue.get(nodes[1].id).progress,71);
 f.transports[0].complete();await flush();await flush();
 assert.equal(f.transports.length,3);
 for(let j=1;j<7;j++){
   if(!f.transports[j])await flush();
   f.transports[j].complete();await flush();await flush();
 }
 assert.equal(f.persisted.size,0);assert.equal(f.committed.length,7);
});
test('paste-like repeated same bytes creates distinct local nodes',async()=>{
 const f=fixture(),clip=bytes(500);
 const a=f.queue.add(clip,{projectId:'p'}),b=f.queue.add(clip,{projectId:'p',x:44,y:44});
 assert.notEqual(a.id,b.id);assert.notEqual(a.url,b.url);
 await flush();
 f.transports[0].complete();f.transports[1].complete();await flush();await flush();
 assert.equal(f.committed.length,2);
});
test('upload failure retains draft and retries without a duplicate node',async()=>{
 const f=fixture(),node=f.queue.add(bytes(1024),{projectId:'p'});
 await flush();f.transports[0].fail(Error('HTTP 502'));await flush();
 assert.equal(f.queue.get(node.id).phase,'failed');
 assert.equal(f.persisted.size,1);assert.equal(f.queue.nodes('p').length,1);
 f.queue.retry(node.id);await flush();
 assert.equal(f.transports.length,2);
 f.transports[1].complete({id:'existing-server-id',url:'/media/image',kind:'reference'});
 await flush();await flush();
 assert.equal(f.committed.length,1);assert.equal(f.persisted.size,0);
});
test('cancel stops only selected upload, deletes local blob and tombstones server ID',async()=>{
 const f=fixture(),a=f.queue.add(bytes(400),{projectId:'p'}),b=f.queue.add(bytes(600),{projectId:'p'});
 await flush();
 const pending=f.queue.ensure(a.id).catch(e=>e.message);
 const result=await f.queue.cancel(a.id);
 assert.equal(result,true);
 assert.equal(await pending,'已取消上传');
 assert.equal(f.transports[0].aborted,true);
 assert.equal(f.transports[1].aborted,false);
 assert.equal(f.persisted.has(a.id),false);
 assert.equal(f.urls.has(a.url),false);
 assert.equal(f.cancelled.length,1);
 f.transports[1].complete();await flush();await flush();
 assert.equal(f.committed.length,1);
});
test('cropped image is local-only until explicitly referenced by generation',async()=>{
 const f=fixture(),image=f.queue.add(bytes(1300),{projectId:'p',deferred:true});
 await flush();assert.equal(f.transports.length,0);
 assert.equal(f.queue.get(image.id).phase,'deferred');
 const reference=f.queue.ensure(image.id);
 await flush();assert.equal(f.transports.length,1);
 f.transports[0].complete();const saved=await reference;
 assert.ok(saved.id.startsWith('server-'));
 assert.equal(f.committed.length,1);
});
test('geometry changed in flight preserved at server commit',async()=>{
 const f=fixture(),node=f.queue.add(bytes(1300),{projectId:'p',x:3,y:5});
 await flush();f.queue.update(node.id,{x:888,y:444,w:712,h:366});
 await flush();f.transports[0].complete();await flush();await flush();
 assert.deepEqual([f.committed[0].x,f.committed[0].y],[888,444]);
});
test('refresh restoration retains project isolation and resumes unfinished uploads',async()=>{
 const records=new Map(),f=fixture({persisted:records});
 const a=f.queue.add(bytes(200),{projectId:'p',x:302,mode:'deferred',deferred:true});
 const b=f.queue.add(bytes(300),{projectId:'other',deferred:true});
 await flush();
 const next=fixture({persisted:records});
 await next.queue.restore('p');
 assert.equal(next.queue.nodes('p').length,1);
 assert.equal(next.queue.nodes('other').length,0);
 assert.equal(next.queue.nodes('p')[0].x,302);
 assert.equal(next.transports.length,0);
 const uploading=next.queue.ensure(a.id);
 await flush();next.transports[0].complete();await uploading;
 assert.equal(records.has(a.id),false);
 assert.equal(records.has(b.id),true);
});
test('invalid formats and oversize rejected before adding to canvas',()=>{
 const f=fixture();
 assert.throws(()=>f.queue.add(bytes(12*1024*1024+1),{projectId:'p'}),/12MB/);
 assert.throws(()=>validate(new Blob(['test'],{type:'image/svg+xml'})),/PNG/);
 assert.equal(f.queue.nodes('p').length,0);
});
test('page wiring exposes local imports, no automatic crop upload or model calls',()=>{
 const root=path.join(__dirname,'..');
 const studio=fs.readFileSync(path.join(root,'studio-v2.js'),'utf8');
 const script=fs.readFileSync(path.join(root,'script.js'),'utf8');
 const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
 assert.match(index,/assets\/canvas-local-import\.js/);
 assert.match(studio,/onApply:async output=>\{\s*const created=localImage/);
 assert.match(studio,/prepareGenerationReferences/);
 assert.match(script,/viewport\.addEventListener\('drop'/);
 assert.match(script,/window\.HamokiCanvas\.addReferenceFile\(original\)/);
 assert.match(script,/prepareGenerationReferences\?\.\(referenceFiles\)/);
 assert.match(server,/alreadyImported:true/);
 assert.match(server,/cancelledImportIds/);
});

test('browser restore merge deduplicates local draft by local or server id',()=>{
 const text=fs.readFileSync(path.join(__dirname,'../studio-v2.js'),'utf8');
 assert.match(text,/existing\.id===node\.id\|\|existing\.clientImportId===node\.id/);
});
test('child crops track their parent id while preparing a generation reference',async()=>{
 const f=fixture(),parent=f.queue.add(bytes(250),{projectId:'p',deferred:true});
 const crop=f.queue.add(bytes(250),{projectId:'p',deferred:true,parentNodeId:parent.id});
 await flush();
 f.queue.update(crop.id,{parentNodeId:'server-parent-id'});
 await flush();
 assert.equal(f.queue.get(crop.id).parentNodeId,'server-parent-id');
 assert.equal(f.persisted.get(crop.id).parentNodeId,'server-parent-id');
 assert.equal(f.queue.get(crop.id).phase,'deferred');
 assert.equal(f.transports.length,0);
});

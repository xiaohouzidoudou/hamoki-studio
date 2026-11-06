'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {placeGeneratedImage,placeRelatedImage} = require('../lib/v1-canvas-placement');

test('related outputs stack above/below the exact source without overlap',()=>{
 const original={id:'source',kind:'generated',x:220,y:180,w:320,h:240};
 const down=placeRelatedImage([original],{parentId:'source',width:288,height:288,gap:52});
 assert.deepEqual(down,{x:236,y:472,w:288,h:288});
 const first={id:'crop1',kind:'reference',parentNodeId:'source',...down};
 const up=placeRelatedImage([original,first],{parentId:'source',width:288,height:288,gap:52});
 assert.deepEqual(up,{x:236,y:-160,w:288,h:288});
 const second={id:'crop2',kind:'reference',parentNodeId:'source',...up};
 const third=placeRelatedImage([original,first,second],{parentId:'source',width:288,height:288,gap:52});
 for(const node of [original,first,second]){
   assert.ok(third.x>=node.x+node.w||third.x+third.w<=node.x||
     third.y>=node.y+node.h||third.y+third.h<=node.y,'no image overlaps');
 }
 const unrelated={id:'obstruction',x:236,y:472,w:288,h:288};
 assert.ok(placeRelatedImage([original,unrelated],{parentId:'source'}).y<original.y);
});

test('new image is placed to the right, aligns to top and avoids collisions', () => {
  assert.deepEqual(placeGeneratedImage([]), {x:150,y:170,w:288,h:288});
  const nodes=[
    {id:'a',kind:'generated',x:296,y:102,w:288,h:288},
    {id:'b',kind:'generated',x:662,y:102,w:288,h:288}
  ];
  const next=placeGeneratedImage(nodes,{gap:36});
  assert.deepEqual(next,{x:986,y:102,w:288,h:288});
  const withCollision=[...nodes,{id:'c',kind:'reference',x:990,y:95,w:288,h:288}];
  assert.deepEqual(placeGeneratedImage(withCollision,{gap:36}),{x:1314,y:102,w:288,h:288});
  const parent={id:'p',kind:'generated',x:50,y:350,w:288,h:288};
  const sibling={id:'child1',kind:'generated',parentNodeId:'p',x:374,y:350,w:288,h:288};
  assert.deepEqual(placeGeneratedImage([parent,sibling],{parentId:'p',gap:36}),
    {x:698,y:350,w:288,h:288});
});

function freePort() {
 return new Promise((resolve,reject)=>{
   const s=net.createServer();s.on('error',reject);
   s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});
 });
}
async function ask(base,route,method='GET',data) {
 const res=await fetch(base+route,{method,headers:data===undefined?undefined:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
 const body=await res.json();
 assert.ok(res.ok,`API ${route} returned ${res.status} ${JSON.stringify(body).slice(0,150)}`);
 return body;
}

test('successful local mock generations append to the right and history insertion also aligns', {timeout:30000}, async t => {
 const root=path.resolve(__dirname,'..');
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-v1-layout-'));
 const image=fs.readFileSync(path.join(root,'assets','hamoki-avatar-128.webp')).toString('base64');
 const upstream=http.createServer((req,res)=>{
   if(req.method==='POST' && req.url==='/v1/images/generations'){
      req.on('data',()=>{});req.on('end',()=>{
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({data:[{b64_json:image}]}));
      });
   } else {res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const port=await freePort();
 const base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.js'],{
    cwd:root,stdio:'ignore',windowsHide:true,
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',
      DATA_DIR:dataDir,DEMO_MODE:'0',NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1',
      APP_PASSWORD:'qa-only-local',APP_ENCRYPTION_KEY:'',APP_BASE_PATH:'',APP_ALLOWED_HOST:''}
 });
 t.after(async()=>{
   if(child.exitCode===null){
     const gone=new Promise(resolve=>child.once('exit',resolve));
     child.kill();
     await Promise.race([gone,new Promise(resolve=>setTimeout(resolve,1400))]);
   }
   upstream.closeAllConnections();
   await new Promise(resolve=>upstream.close(resolve));
   fs.rmSync(dataDir,{recursive:true,force:true});
 });
 let ready=false;
 for(let i=0;i<70;i++){
   try{const r=await fetch(base+'/api/status');if(r.ok){ready=true;break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,70));
 }
 assert.ok(ready,'local test server should start');
 const provider=(await ask(base,'/api/providers','POST',{
   name:'offline mock',mode:'openai',url:'http://127.0.0.1:'+upstream.address().port+'/v1',
   apiKey:'test-only-key',imageMode:'images',imageModel:'qa-image',visionModel:'qa-vision'
 })).provider;
 const projectId=(await ask(base,'/api/projects')).defaultId;
 async function generateOnce(){
   const job=(await ask(base,'/api/jobs','POST',{
      prompt:'V1 layout test',targets:[{providerId:provider.id,model:'qa-image'}],
      projectId,ratio:'1:1',resolution:'1K',quality:'auto',count:1
   })).jobs[0];
   for(let i=0;i<85;i++){
     const status=(await ask(base,'/api/jobs')).jobs.find(j=>j.id===job.id);
     if(status?.status==='done')return status;
     if(status?.status==='failed')throw Error('Mock image job failed: '+status.error);
     await new Promise(resolve=>setTimeout(resolve,55));
   }
   throw Error('Mock image did not finish');
 }
 const first=await generateOnce(), second=await generateOnce();
 assert.notEqual(first.id,second.id);
 const nodes=(await ask(base,'/api/projects/'+projectId)).project.nodes;
 assert.equal(nodes.length,2);
 assert.equal(nodes[1].x,nodes[0].x+nodes[0].w+36);
 assert.equal(nodes[1].y,nodes[0].y);
 const returned=(await ask(base,'/api/projects/'+projectId+'/nodes/from-history','POST',{
   historyId:first.resultId
 })).node;
 assert.equal(returned.x,nodes[1].x+nodes[1].w+36);
 assert.equal(returned.y,nodes[0].y);
 const UI=fs.readFileSync(path.join(root,'script.js'),'utf8');
 assert.match(UI,/window\.HamokiViewport/);
 assert.match(UI,/addEventListener\('wheel'/);
 assert.match(UI,/\{passive: false\}/);
 assert.match(UI,/showQueueNotice\(completed\[0\]/);
 const CSS=fs.readFileSync(path.join(root,'studio-v2.css'),'utf8');
 assert.match(CSS,/#queue-panel\.expanded/);
 assert.match(CSS,/#queue-panel:not\(\.expanded\) \.queue-content/);
 assert.match(CSS,/#queue-panel\.has-running::before/);
});

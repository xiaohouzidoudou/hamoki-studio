'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),css=fs.readFileSync(path.join(root,'assets/canvas-inline.css'),'utf8');
const a=app.indexOf('function visibleCanvasJobs('),b=app.indexOf('function renderCanvasJobs(){',a);
const code=app.slice(a,b);
test('canvas jobs display latest active or failed task, not a completed or retried parent',()=>{
 const items=[{id:'new',retryOf:'old',status:'failed'},{id:'old',status:'failed'},{id:'active',status:'running'},{id:'done',status:'done',resultId:'img'}];
 const result=vm.runInNewContext(code+'\nvisibleCanvasJobs('+JSON.stringify(items)+')',{});
 assert.deepEqual(Array.from(result,x=>x.id),['new','active']);
});
test('job cards render in world scene and preserve original positions',()=>{
 assert.match(html,/id="jobLayer" class="canvas-job-layer"/);
 assert.match(app,/renderCanvasJobs\(\)/);
 assert.match(app,/Number\(job\.canvasX\)/);
 assert.match(app,/origin\.x\+origin\.w\+34/);
 assert.match(app,/origin&&!job\.reservedCanvasSlot/);
 assert.match(app,/emptyStage.*classList\.toggle\('hidden'/);
 assert.match(app,/retry\.onclick=\(\)=>retryJob\(job\.id\)/);
 assert.match(css,/\.canvas-job-card\.status-failed/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});

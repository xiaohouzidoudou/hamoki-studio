'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const inline=app.slice(app.indexOf('let inlineChatNodeId=null'),app.indexOf('function regenerateFrom(id,nodeId)'));
const submit=app.slice(app.indexOf('let generationSubmissionPending=false'),app.indexOf('function activeGenerationJobs(){'));
assert.ok(inline.length>300&&submit.length>300,'canvas inline handlers are present');

function setup(options={}){
 const calls=[],notices=[];
 const controls={
  prompt:{value:'RIGHT SIDE DRAFT'},amount:{value:'4'},transparentBg:{checked:true},
  ratio:{value:'1:1'},canvasInlinePrompt:{value:'只换按钮颜色'},
  canvasInlineSend:{disabled:false,textContent:'开始修改'},
  generateBtn:{disabled:false},compareModal:{},assistantPanel:{classList:{remove(){}}}
 };
 const ctx={
  sourceId:'existing-source',sourceNodeId:'existing-node',maskData:'keep-mask',maskSourcePng:'keep-png',
  referenceInputs:[{data:'main-ref'}],referenceNodeRoles:[{nodeId:'main-node'}],
  demoMode:false,simpleStudio:false,composerMode:'text',providers:[{id:'provider',name:'Mock image provider'}],
  currentProject:{id:'project',nodes:[{id:'node-1',historyId:'history-1',kind:'generated',x:20,y:30,w:200,h:200}]},
  window:{innerWidth:1400},$:(id)=>controls[id],toast:(msg)=>notices.push(String(msg)),
  hide:()=>{},renderContext:()=>{},refreshProjectData:async()=>{},rememberQuickModel:()=>{},
  currentHistory:(id)=>id==='history-1'?{id,url:'fake.png'}:null,
  confirm:()=>options.confirm!==false,
  api:async(path,request)=>{calls.push({path,request});if(options.api)return options.api();return {jobs:[{id:'job-1'}]}},
  generationBody:()=>{
   const sourceId=ctx.sourceId,sourceNodeId=ctx.sourceNodeId;
   return {projectId:'project',providerId:'provider',model:'image-model',prompt:controls.prompt.value,
    ratio:'1:1',resolution:'1K',count:Number(controls.amount.value),sourceId,sourceNodeId,
    references:ctx.referenceInputs.slice(),referenceNodes:ctx.referenceNodeRoles.slice(),
    mask:ctx.maskData,transparentBg:controls.transparentBg.checked,review:null};
  },
  document:{querySelector:()=>null},
  show:()=>{},clamp:(x,a,b)=>Math.min(Math.max(x,a),b)
 };
 vm.createContext(ctx);vm.runInContext(inline+'\n'+submit,ctx);
 vm.runInContext("inlineChatNodeId='node-1'",ctx);
 return {ctx,calls,notices,controls,run:()=>vm.runInContext('submitInlineChat()',ctx)};
}
test('cancelled inline submit sends no paid request and preserves right-side draft',async()=>{
 const t=setup({confirm:false});await t.run();
 assert.equal(t.calls.length,0);
 assert.equal(t.controls.prompt.value,'RIGHT SIDE DRAFT');
 assert.equal(t.ctx.sourceId,'existing-source');assert.equal(t.ctx.maskData,'keep-mask');
 assert.equal(t.ctx.referenceInputs[0].data,'main-ref');
 assert.equal(t.controls.canvasInlinePrompt.value,'只换按钮颜色');
 assert.equal(t.controls.canvasInlineSend.disabled,false);
});
test('inline image request uses its own source, one image, no stale sidebar references',async()=>{
 const t=setup();await t.run();
 assert.equal(t.calls.length,1);const job=t.calls[0].request.body;
 assert.equal(job.prompt,'只换按钮颜色');assert.equal(job.sourceId,'history-1');
 assert.equal(job.sourceNodeId,'node-1');assert.equal(job.count,1);
 assert.equal(job.mask,null);assert.equal(job.transparentBg,false);
 assert.equal(job.references.length,0);assert.equal(job.referenceNodes.length,0);
 assert.equal(t.controls.prompt.value,'RIGHT SIDE DRAFT');assert.equal(t.controls.amount.value,'4');
 assert.equal(t.ctx.sourceId,'existing-source');assert.equal(t.ctx.maskData,'keep-mask');
 assert.equal(t.ctx.referenceInputs[0].data,'main-ref');
 assert.equal(t.controls.canvasInlineSend.disabled,false);
});
test('rapid double click creates only one job while request is pending',async()=>{
 let finish;const t=setup({api:()=>new Promise(resolve=>finish=resolve)});
 const one=t.run(),two=t.run();await two;assert.equal(t.calls.length,1);
 assert.equal(t.controls.canvasInlineSend.disabled,true);
 finish({jobs:[{id:'job-1'}]});await one;
 assert.equal(t.controls.canvasInlineSend.disabled,false);
});
test('uncertain network submit does not blindly retry or charge twice',async()=>{
 const t=setup({api:async()=>{throw Error('network disconnected')}});
 await t.run();await t.run();
 assert.equal(t.calls.length,1);assert.equal(t.controls.canvasInlineSend.textContent,'检查任务队列');
 assert.ok(t.notices.some(msg=>msg.includes('提交状态未确认')));
});

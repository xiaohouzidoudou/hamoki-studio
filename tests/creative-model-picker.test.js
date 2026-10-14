'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function pageHarness(){
 const nodes=new Map(),calls=[];
 class Element{
  constructor(tag='div'){this.tag=tag;this.value='';this.textContent='';this.children=[];this.listeners=new Map();this.dataset={};this.disabled=false;this.className='';this.classList={toggle:()=>{},add:()=>{},remove:()=>{}};this.style={};}
  append(...children){this.children.push(...children)}
  replaceChildren(...children){this.children=[...children]}
  addEventListener(type,fn){this.listeners.set(type,fn)}
  querySelectorAll(){return []}
  focus(){this.focused=true}
  get options(){return this.children}
  setAttribute(){}
  fire(type){const fn=this.listeners.get(type);assert.ok(fn,'listener missing: '+type);return fn({target:this})}
 }
 const elem=id=>{if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id)};
 const providers=[
  {id:'relay-A',name:'中转 A',hasKey:true,capabilities:{text:{enabled:true,defaultModel:'text-a-1',models:['text-a-1','text-a-2']},vision:{enabled:true,defaultModel:'vision-a-1',models:['vision-a-1']},image:{enabled:true,defaultModel:'image-a-1',models:['image-a-1']}}},
  {id:'relay-B',name:'中转 B',hasKey:true,capabilities:{text:{enabled:true,defaultModel:'text-b-1',models:['text-b-1']},vision:{enabled:true,defaultModel:'vision-b-1',models:['vision-b-1']},image:{enabled:true,defaultModel:'image-b-1',models:['image-b-1']}}}
 ];
 const flow={status:'document-ready',documents:[{id:'doc-1',name:'周年庆.docx',text:'签到奖励',images:[]}],pages:[{id:'page-1',docId:'doc-1',name:'登录奖励',sourceName:'周年庆.docx',requirements:'签到页',imageIndexes:[],analysis:{prompt:'完成周年庆 UI'}}],activePageId:'page-1',stages:{document:'done'},notes:'',styleNodeIds:[],routing:{text:{providerId:'relay-A',model:'text-a-1'},vision:{providerId:'relay-A',model:'vision-a-1'},image:{providerId:'relay-A',model:'image-a-1'}}};
 const currentProject={id:'project-1',nodes:[]};
 const sandbox={document:{getElementById:elem,createElement:tag=>new Element(tag)},providers,authorized:true,currentProject,historyItems:[],activeId:'relay-A',runtimeRoutes:{text:{},vision:{}},toast:()=>{},confirm:()=>true,show:()=>{},hide:()=>{},setComposerMode:()=>{},renderContext:()=>{},referenceNodeRoles:[],rememberQuickModel:(model,id)=>calls.push(['composer-model',id,model]),activate:async id=>{sandbox.activeId=id;calls.push(['activate',id])},api:async(url,options={})=>{
   calls.push(['api',url,options.body||null]);
   if(url==='projects/project-1/creative')return {flow};
   if(url==='projects/project-1/creative/settings'){flow.routing=options.body.routing;flow.styleNodeIds=options.body.styleNodeIds;flow.notes=options.body.notes;return {flow}}
   if(url.startsWith('models?'))return {models:['text-b-1','text-b-2','image-b-1','image-b-2','vision-b-1']};
   throw Error('Unexpected API: '+url);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','assets','creative-workflow-v2.js'),'utf8'),sandbox);
 return {elem,flow,calls,sandbox};
}
test('model selection is provider-specific, saved, restored, and applied to image composer',async()=>{
 const {elem,flow,calls,sandbox}=pageHarness();
 await elem('openCreativeWorkflow').fire('click');
 assert.equal(elem('creativeTextModelSelect').value,'text-a-1');
 assert.equal(elem('creativeVisionModelSelect').value,'vision-a-1');
 assert.equal(elem('creativeImageModelSelect').value,'image-a-1');
 assert.equal(elem('creativeTextModelSelect').options.some(x=>x.value==='text-a-2'),true);
 elem('creativeTextProvider').value='relay-B';await elem('creativeTextProvider').fire('change');
 assert.equal(elem('creativeTextModelSelect').value,'text-b-1','switch must not retain model of other provider');
 await elem('creativeTextFetch').fire('click');
 assert.equal(elem('creativeTextModelSelect').options.some(x=>x.value==='text-b-2'),true);
 elem('creativeTextModelSelect').value='text-b-2';await elem('creativeTextModelSelect').fire('change');
 elem('creativeVisionProvider').value='relay-B';await elem('creativeVisionProvider').fire('change');
 elem('creativeVisionModelSelect').value='__manual_model__';await elem('creativeVisionModelSelect').fire('change');
 elem('creativeVisionModel').value='vision-custom-model';await elem('creativeVisionModel').fire('input');
 elem('creativeImageProvider').value='relay-B';await elem('creativeImageProvider').fire('change');
 await elem('creativeImageFetch').fire('click');
 elem('creativeImageModelSelect').value='image-b-2';await elem('creativeImageModelSelect').fire('change');
 await elem('creativeSaveModels').fire('click');
 assert.deepEqual(JSON.parse(JSON.stringify(flow.routing)),{
  text:{providerId:'relay-B',model:'text-b-2'},
  vision:{providerId:'relay-B',model:'vision-custom-model'},
  image:{providerId:'relay-B',model:'image-b-2'}
 });
 assert.equal(elem('creativeTextModelSelect').value,'text-b-2','chosen model survives render');
 assert.equal(elem('creativeVisionModelSelect').value,'__manual_model__','manual model survives render');
 assert.equal(elem('creativeVisionModel').value,'vision-custom-model');
 await elem('creativeUsePrompt').fire('click');
 assert.equal(sandbox.activeId,'relay-B','image provider propagated to composer');
 assert.equal(elem('imageModel').value,'image-b-2','selected image model propagated to composer');
 assert.equal(elem('prompt').value,'完成周年庆 UI','art director prompt propagated to composer');
 assert.ok(calls.some(x=>x[0]==='composer-model'&&x[2]==='image-b-2'));
});

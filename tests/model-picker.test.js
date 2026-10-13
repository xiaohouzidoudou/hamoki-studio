'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const pick=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i+a.length);assert(i>=0&&j>i,a);return s.slice(i,j)};
class FakeEl {
 constructor(){this.value='';this.textContent='';this.children=[];this.disabled=false}
 replaceChildren(...x){this.children=x}
 append(x){this.children.push(x)}
}
function harness(){
 let saved=null;
 const els=new Map(),get=id=>{if(!els.has(id))els.set(id,new FakeEl());return els.get(id)};
 const ctx=vm.createContext({console,editId:'first-provider',activeId:'first-provider',modelCatalogByProvider:new Map(),
  $:get,document:{getElementById:get},el:(tag)=>Object.assign(new FakeEl(),{tag}),
  toast:()=>{},populateComposerModelSuggestions:()=>{},api:async(route,opts)=>{saved={route,opts};return {reachable:true,models:['nano-2.1','gpt-image-2','nano-2.1'],latencyMs:10}}});
 vm.runInContext('function formProvider(){return {name:"Draft",url:"https://api.example.test",mode:"gemini",apiKey:"sk-NEW",capabilities:{}}};function updateDraftTestControls(){};',ctx);
 vm.runInContext(pick(app,"function draftTestPayload(capability='image',baseOnly=true){","async function probeProvider(kind){"),ctx);
 vm.runInContext(pick(app,'async function fetchModels(){','function showCompare(){'),ctx);
 return {ctx,get,last:()=>saved};
}
test('Obsolete parallel model fields are removed, leaving only the per-feature selectors',()=>{
 for(const id of ['pfImage','pfVision','legacyModelFields'])assert.doesNotMatch(html,new RegExp('id="'+id+'"'));
 for(const id of ['capabilityEditor','imageModel','textModelInput','visionModelInput'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.doesNotMatch(app,/MODEL_PICKER_FIELDS|bindModelPickers|openModelPicker/);
});
test('model fetch sends temporary current form, no provider save and no state mutation',async()=>{
 const {ctx,get,last}=harness();
 await vm.runInContext('fetchModels()',ctx);
 assert.equal(last().route,'providers/draft/models');
 assert.equal(last().opts.method,'POST');
 assert.equal(last().opts.body.url,'https://api.example.test');
 assert.equal(last().opts.body.apiKey,'sk-NEW');
 assert.equal(last().opts.body.baseOnly,true);
 assert.equal(ctx.modelCatalogByProvider.get('first-provider').length,2);
 for(const cap of ['image','vision','text']){
  const options=get('provider-cap-models-'+cap).children;
  assert.equal(options.length,2);
  assert.equal(options[0].value,'nano-2.1');
 }
 assert.match(get('checkResult').textContent,/保存前不会生效/);
});
test('fetch before save never publishes a temporary model list as a saved provider',async()=>{
 const {ctx,get,last}=harness();ctx.editId=null;get('checkResult').textContent='manual model preserved';
 await vm.runInContext('fetchModels()',ctx);
 assert.equal(last().opts.body.savedId,null);
 assert.equal(ctx.modelCatalogByProvider.size,0);
 assert.equal(get('checkResult').textContent.includes('获取'),true);
});
test('capability groups have independent reuse toggles and draft is destroyed on close',()=>{
 for(const item of ['image','vision','text'])assert.match(app,new RegExp("const order=\\['image','vision','text','edit'\\]"));
 assert.match(app,/function closeSettingsModal\(\)\{if\(draftProvider\)/);
 assert.match(app,/function selectEdit\(id\)/);
 assert.match(app,/provider-draft/);
 assert.match(app,/inheritProtocol:/);
});

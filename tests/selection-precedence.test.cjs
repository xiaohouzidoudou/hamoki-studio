const fs=require('fs'),vm=require('vm'),assert=require('assert');
const app=fs.readFileSync('/src/assets/app.js','utf8'),server=fs.readFileSync('/src/workspace.js','utf8');
const cut=(s,a,b)=>{let i=s.indexOf(a),j=s.indexOf(b,i+a.length);assert(i>=0&&j>i);return s.slice(i,j)};
function setup(){
 const controls={imageModel:{value:'gemini-nano-banana-2.1'},ratio:{value:'3:4'},resolution:{value:'2K'},quality:{value:'auto'},prompt:{value:'x',focus(){}},transparentBg:{checked:false},amount:{value:'1'}};
 const providers=[{id:'gpt',name:'GPT',mode:'openai',imageMode:'images',imageModel:'gpt-image-2',hasKey:true,url:'https://test.invalid'}, {id:'gem',name:'Gemini',mode:'gemini',imageModel:'gemini-nano-banana-2.1',hasKey:true,url:'https://test.invalid'},{id:'open',name:'OpenAI',mode:'openai',imageMode:'images',imageModel:'gpt-image-2.5',hasKey:true,url:'https://test.invalid'}];
 const h={id:'old',providerId:'gpt',model:'gpt-image-2',ratio:'1:1',resolution:'1K',prompt:'old'};const requests=[];
 const c=vm.createContext({providers,activeId:'gem',sourceId:null,sourceNodeId:null,enhanceMode:false,maskData:null,maskSourcePng:null,editingPrompt:null,currentProject:{id:'prj',nodes:[{id:'node1',historyId:'old'}]},referenceInputs:[],referenceNodeRoles:[],jobs:[{id:'job1',providerName:'GPT',model:'gpt-image-2'}],window:{innerWidth:1400},innerWidth:1400,authorized:true,demoMode:false,abilityBindings:{edit:{providerId:'gpt',model:'gpt-image-2'}},currentHistory:id=>id==='old'?h:null,renderContext(){},renderProviderSelect(){throw Error('history changed provider')},toast(){},hide(){},refreshProjectData:async()=>{},confirm:()=>true,api:async(path,opts)=>{requests.push({path,opts})},currentBoardPoint:()=>({x:5,y:8}),checkProvider:()=>true,$:id=>{assert(controls[id],id);return controls[id]}});
 vm.runInContext('function activeProvider(){return providers.find(p=>p.id===activeId)};function routeBinding(cap){return abilityBindings[cap]}',c);
 vm.runInContext(cut(app,'function continueFrom(id,nodeId){','function checkProvider(capability'),c);
 vm.runInContext(cut(app,'function generationBody(targets){','async function submitGeneration(targets=null)'),c);
 vm.runInContext(cut(app,'async function retryJob(id){','function showFromLibrary()'),c);
 return {c,controls,requests};
}
let count=0;function test(name,fn){return Promise.resolve().then(fn).then(()=>{count++;console.log('PASS',name)})}
(async()=>{
 await test('continue keeps user model and ratio',()=>{let{c,controls:d}=setup();vm.runInContext('continueFrom("old","node1")',c);assert.equal(c.activeId,'gem');assert.equal(d.imageModel.value,'gemini-nano-banana-2.1');assert.equal(d.ratio.value,'3:4');assert.equal(d.resolution.value,'2K')});
 await test('regenerate keeps user settings',()=>{let{c,controls:d}=setup();vm.runInContext('regenerateFrom("old","node1")',c);assert.equal(c.activeId,'gem');assert.equal(d.imageModel.value,'gemini-nano-banana-2.1')});
 await test('enhance uses 4K and current Gemini',()=>{let{c,controls:d}=setup();vm.runInContext('enhanceFrom("old","node1")',c);assert.equal(c.activeId,'gem');assert.equal(d.resolution.value,'4K');assert.equal(d.imageModel.value,'gemini-nano-banana-2.1')});
 await test('background removal keeps chosen OpenAI',()=>{let{c,controls:d}=setup();c.activeId='open';d.imageModel.value='gpt-image-2.5';vm.runInContext('removeBackground("old","node1")',c);assert.equal(c.activeId,'open');assert.equal(d.imageModel.value,'gpt-image-2.5');assert(d.transparentBg.checked)});
 await test('image edit request overrides legacy edit binding',()=>{let{c}=setup();vm.runInContext('continueFrom("old","node1")',c);c.$('prompt').value='user edit';let b=vm.runInContext('generationBody(null)',c);assert.equal(b.providerId,'gem');assert.equal(b.model,'gemini-nano-banana-2.1');assert.equal(b.resolution,'2K')});
 await test('retry explicitly carries selected provider and model',async()=>{let{c,requests}=setup();await vm.runInContext('retryJob("job1")',c);assert.equal(requests[0].opts.body.providerId,'gem');assert.equal(requests[0].opts.body.model,'gemini-nano-banana-2.1')});
 await test('server respects edit target over saved binding',()=>{let c=vm.createContext({trim:(s,n)=>String(s||'').slice(0,n),assertProject:id=>({id,nodes:[]}),state:{activeId:'gpt'},jobs:[],MAX_QUEUED:30,REFERENCE_ROLES:{},getBinding:()=>({providerId:'gpt',model:'gpt-image-2'}),history:[{id:'old',projectId:'prj',prompt:'old'}],num:(n,d)=>n??d,provider:id=>({id,mode:'gemini'}),effectiveProvider:p=>p});vm.runInContext(cut(server,'function validateCreation(b){','function submit(b){'),c);let b=vm.runInContext('validateCreation({projectId:"prj",prompt:"edit",sourceId:"old",providerId:"gem",model:"gemini-nano-banana-2.1",ratio:"1:1",resolution:"2K",quality:"high"})',c);assert.equal(b.targets[0].providerId,'gem');assert.equal(b.targets[0].model,'gemini-nano-banana-2.1')});
 console.log('RESULT',count,'tests passed');
})().catch(e=>{console.error(e.stack);process.exit(1)});

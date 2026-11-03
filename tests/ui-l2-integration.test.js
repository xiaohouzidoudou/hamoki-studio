'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const dom=require('./helpers/ui-dom.cjs');
const main=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8'),l2=fs.readFileSync(path.join(__dirname,'../assets/ui-l2-optimization.js'),'utf8');
const cut=(start,end)=>{const a=main.indexOf(start),b=main.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return main.slice(a,b)};
function page(){
 const d=dom(),$=id=>d.document.getElementById(id),calls=[],saved=new Map();
 const state={ready:true,authorized:false,userId:'alice',providerCount:0,projectId:'p'};
 const bridge={state:()=>({...state}),newProviderTemplate:t=>{calls.push(['template',t]);return true},createOnboardingProvider:async()=>true,uploadOnboarding:async()=>'/original.png',preparePrompt:text=>calls.push(['prompt',text]),toast:text=>calls.push(['toast',text])};
 const context=vm.createContext({...d,window:{HamokiStudioUI:bridge},localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)}});
 vm.runInContext(l2,context);return {...d,$,calls,saved,state,bridge,context};
}
test('真实 HTML 的侧栏折叠同步样式、可访问性和持久状态',async()=>{
 const p=page(),section=p.document.querySelectorAll('.sidebar-section').find(n=>n.dataset.section==='pro'),content=section.querySelector('.section-content'),button=section.querySelector('.section-toggle');
 assert(section.classList.contains('collapsed'));assert.equal(content.hidden,true);assert.equal(content.inert,true);assert.equal(button.getAttribute('aria-expanded'),'false');
 await button.click();assert.equal(content.hidden,false);assert(section.classList.contains('expanded'));assert.equal(JSON.parse(p.saved.get('hs-sidebar-sections')).pro,'expanded');
 p.$('formTitle').textContent='编辑中转站';assert(p.$('quickTemplateButton'),'切换编辑记录后模板入口仍存在');
});
test('模型列表重复渲染只增加一个推荐说明，观察器可收敛，不改变模型选择',()=>{
 const p=page(),menu=p.$('composerModelMenu');menu.classList.remove('hidden');
 const option=p.document.createElement('button'),name=p.document.createElement('span');option.className='composer-model-option';name.className='composer-model-name';name.textContent='flux-turbo';option.append(name);menu.append(option);
 assert(p.flush()<=2);assert.equal(option.querySelectorAll('.composer-model-reason').length,1);assert(option.classList.contains('recommended'));
 for(let i=0;i<3;i++){menu.replaceChildren(option);p.flush();assert.equal(option.querySelectorAll('.composer-model-reason').length,1)}
 name.textContent='other-model';p.flush();assert.equal(option.querySelectorAll('.composer-model-reason').length,0);assert(!option.classList.contains('recommended'));assert.equal(p.calls.length,0);
});
test('延迟登录触发单一已有向导，完成状态按账号隔离，既有服务商不触发',async()=>{
 const p=page();assert(p.$('onboardingModal').classList.contains('hidden'));
 p.state.authorized=true;await p.document.fire('studio:ready');assert(!p.$('onboardingModal').classList.contains('hidden'));assert.equal(p.document.querySelectorAll('#onboardingModal').length,1);
 await p.$('onboardingClose').click();await p.document.fire('studio:ready');assert(p.$('onboardingModal').classList.contains('hidden'));
 p.state.userId='bob';await p.document.fire('studio:ready');assert(!p.$('onboardingModal').classList.contains('hidden'));
 await p.$('onboardingClose').click();p.state.userId='carol';p.state.providerCount=1;await p.document.fire('studio:ready');assert(p.$('onboardingModal').classList.contains('hidden'));
});
test('向导配置失败与上传取消/失败不前进，成功结果才展示，最后只准备提示词',async()=>{
 const p=page();p.state.authorized=true;await p.document.fire('studio:ready');
 const active=()=>p.$('onboardingModal').querySelectorAll('.onboarding-step').find(n=>n.classList.contains('active')).dataset.step;
 p.bridge.createOnboardingProvider=async()=>false;await p.$('onboardingSaveProvider').click();assert.equal(active(),'1');
 p.bridge.createOnboardingProvider=async()=>true;await p.$('onboardingSaveProvider').click();assert.equal(active(),'2');
 const input=p.$('onboardingFiles');input.files=[];await input.fire('change');assert.equal(active(),'2');assert(p.$('onboardingPreview').classList.contains('hidden'));
 input.files=[{name:'fake.png'}];p.bridge.uploadOnboarding=async()=>null;await input.fire('change');assert(p.$('onboardingContinueUpload').classList.contains('hidden'));assert.equal(p.$('onboardingUploadBtn').disabled,false);
 input.files=[{name:'fake.png'}];p.bridge.uploadOnboarding=async()=>'/original.png';await input.fire('change');assert.equal(p.$('onboardingPreview').querySelector('img').src,'/original.png');assert.equal(active(),'2');
 await p.$('onboardingContinueUpload').click();assert.equal(active(),'3');p.$('onboardingPrompt').value='我的描述';await p.$('onboardingGenerate').click();assert(p.calls.some(c=>c[0]==='prompt'&&c[1]==='我的描述'));assert(p.$('onboardingModal').classList.contains('hidden'));
});
test('快速/专业模式同步按钮，不隐藏画质数量、不改参数',async()=>{
 const p=page();assert(p.$('assistantPanel').classList.contains('workflow-quick'));
 const pro=p.document.querySelectorAll('.workflow-mode-btn').find(b=>b.dataset.mode==='pro');await pro.click();assert(!p.$('assistantPanel').classList.contains('workflow-quick'));assert.equal(pro.getAttribute('aria-pressed'),'true');assert.equal(p.saved.get('hs-workflow-mode'),'pro');
});
function providerHarness(){
 const d=dom(),$=id=>d.document.getElementById(id),calls=[];
 const provider={id:'old',name:'原服务商',url:'https://old.invalid/v1',hasKey:true,capabilities:{text:{hasKey:true,baseUrl:'https://private.invalid',defaultModel:'private-model'}}};
 const c=vm.createContext({document:d.document,el:(tag,cls,text)=>{const e=new d.Element(tag);e.className=cls||'';if(text!==undefined)e.textContent=text;return e},Option:function(text,value){const e=new d.Element('option');e.textContent=text;e.value=value;return e},window:{},$,providers:[provider],activeId:'old',editId:'old',draftProvider:false,authorized:true,studioReady:true,currentUser:{id:'alice'},currentProject:{id:'p',nodes:[]},demoMode:false,confirm:()=>true,
  renderCapabilityEditor:p=>calls.push(['capabilities',p]),renderProviderCards(){},updateDraftTestControls(){},syncResponses(){},syncProviderMode(){},hide(){},show(){},toast(){},
  formProvider:()=>({name:$('pfName').value,url:$('pfUrl').value,apiKey:$('pfKey').value}),api:async(url,options)=>{calls.push(['api',url,options]);return {provider:{id:'new'}}},loadProviders:async()=>{},closeSettingsModal(){},setComposerMode(){},uploadToCanvas:async()=>{},currentBoardPoint:()=>({x:0,y:0})});
 vm.runInContext(cut('const ABILITY_META=','function arrangeStudioLayout()'),c);
 vm.runInContext(cut('function syncProviderMode(){','// L1/L2 extensions'),c);
 vm.runInContext(cut('function selectEdit(id){','function closeSkillsMenu()'),c);
 vm.runInContext(cut('window.HamokiStudioUI=','async function deleteProvider()'),c);
 return {c,$,calls,provider,bridge:c.window.HamokiStudioUI};
}
test('模板从编辑旧服务商改为新草稿：拒绝保留原表单；确认清空 Key 与能力、仅显式保存 POST',async()=>{
 const p=providerHarness(),before=JSON.stringify(p.provider),template={name:'新模板',url:'https://new.invalid/v1',mode:'openai',imageMode:'chat'};
 vm.runInContext("selectEdit('old')",p.c);p.$('capabilityEditor').querySelector('[data-cap="text"][data-attr="apiKey"]').value='typed-cap-key';p.$('pfName').value='旧草稿';p.$('pfKey').value='typed-old-key';p.c.confirm=()=>false;assert.equal(p.bridge.newProviderTemplate(template),false);assert.equal(p.$('pfKey').value,'typed-old-key');assert.equal(p.c.editId,'old');
 p.c.confirm=()=>true;assert(p.bridge.newProviderTemplate(template));assert.equal(p.c.editId,null);assert(p.c.draftProvider);assert.equal(p.$('pfKey').value,'');assert.equal(p.$('pfUrl').value,template.url);const caps=vm.runInContext('collectCapabilityEditor()',p.c);for(const cap of Object.values(caps)){assert.equal(cap.apiKey,'');assert.equal(cap.baseUrl,'');assert.equal(cap.defaultModel,'');assert.equal(cap.inheritApiKey,true)}assert.equal(p.calls.filter(c=>c[0]==='api').length,0);
 p.$('pfKey').value='new-key';await vm.runInContext('saveProvider()',p.c);const request=p.calls.find(c=>c[0]==='api');assert.equal(request[1],'providers');assert.equal(request[2].method,'POST');assert.equal(request[2].body.apiKey,'new-key');assert.equal(JSON.stringify(p.provider),before);
});
function scene(){
 const requests=[],project={id:'p',nodes:[{id:'a',x:10,y:20,w:40,h:30},{id:'b',x:25,y:90,w:40,h:30},{id:'c',x:110,y:220,w:40,h:30}]};
 const c=vm.createContext({$:()=>({disabled:false}),currentProject:project,multiNodeIds:new Set(['a','b','c']),undoStack:[],redoStack:[],projectSaveBusy:0,forceProjectRefresh:false,lastProjectRevision:0,projectPath:x=>'/projects/p'+x,api:async(url,opts)=>{requests.push({url,opts});return {revision:2}},setSaving(){},updateUndoButtons(){},renderNodes(){},toast(){},refreshProjectData:async()=>{},selectedSceneNodes:()=>project.nodes});
 vm.runInContext(cut('function snapshotScene(ids){','async function groupSelection('),c);return {c,requests,project};
}
test('批量均分真实保存、可撤销/重做，失败保留原位置，不提交任何任务',async()=>{
 const {c,requests,project}=scene();await vm.runInContext("arrangeSelection('distribute-h')",c);assert.deepEqual(project.nodes.map(n=>n.x),[10,60,110]);assert.equal(c.undoStack.length,1);assert.equal(requests[0].opts.method,'PATCH');
 await vm.runInContext("stepHistory('undo')",c);assert.deepEqual(project.nodes.map(n=>n.x),[10,25,110]);await vm.runInContext("stepHistory('redo')",c);assert.deepEqual(project.nodes.map(n=>n.x),[10,60,110]);
 const before=JSON.stringify(project);c.api=async()=>{throw Error('模拟保存失败')};await vm.runInContext("arrangeSelection('top')",c);assert.equal(JSON.stringify(project),before);assert(requests.every(r=>r.url.endsWith('/nodes/batch')));
});
test('批量移除需确认、失败不删，成功进入撤销，下载走原图 ZIP 端点',async()=>{
 const {c,project,requests}=scene(),d=dom(),links=[];Object.assign(c,{confirm:()=>false,selectedImages:()=>project.nodes,referenceNodeRoles:[{nodeId:'b'}],sourceNodeId:'b',selectedNodeId:'b',renderContext(){},APP_BASE:'/studio',el:tag=>{const node=new d.Element(tag);links.push(node);return node},document:{body:new d.Element('body')}});
 vm.runInContext(cut('async function removeSelectedImages(){','function closeBoardContextMenu()'),c);await vm.runInContext('removeSelectedImages()',c);assert.equal(requests.length,0);
 c.confirm=()=>true;c.api=async()=>{throw Error('模拟移除失败')};await vm.runInContext('removeSelectedImages()',c);assert.equal(project.nodes.length,3);
 c.api=async(url,opts)=>{requests.push({url,opts});return {revision:3,batchId:'trash'}};await vm.runInContext('removeSelectedImages()',c);assert.equal(project.nodes.length,0);assert.equal(c.undoStack.at(-1).batchId,'trash');assert.equal(c.referenceNodeRoles.length,0);
 vm.runInContext(cut('function downloadSelectedImages(){','function addSelectedReferences()'),c);c.selectedImages=()=>[{id:'a'},{id:'b'}];await vm.runInContext('downloadSelectedImages()',c);assert(requests.every(r=>!r.url.includes('jobs')));assert.equal(links.at(-1).href,'/studio/projects/p/nodes/export?ids=a%2Cb');assert.equal(links.at(-1).download,'hamoki-selected-images.zip');
});

test('启动未加载完不展示向导，损坏或不可写的本地偏好不阻断初始化',async()=>{
 const p=page();p.state.authorized=true;p.state.ready=false;await p.document.fire('studio:ready');assert(p.$('onboardingModal').classList.contains('hidden'));p.state.ready=true;await p.document.fire('studio:ready');assert(!p.$('onboardingModal').classList.contains('hidden'));
 const d=dom();assert.doesNotThrow(()=>vm.runInNewContext(l2,{...d,window:{HamokiStudioUI:{state:()=>({authorized:false})}},localStorage:{getItem(){throw Error('denied')},setItem(){throw Error('denied')}}}));
});
test('顶部工具只沿用既有 changeTool 绑定，上传只触发一次文件选择',async()=>{
 const p=page();let clicks=0;p.$('canvasFiles').addEventListener('click',()=>clicks++);await p.$('uploadCanvasTop').click();assert.equal(clicks,1);
 const select=p.document.querySelectorAll('[data-tool]').find(b=>b.dataset.tool==='select');assert.equal((select.listeners.click||[]).length,0,'L2 不叠加第二套工具处理器');
});

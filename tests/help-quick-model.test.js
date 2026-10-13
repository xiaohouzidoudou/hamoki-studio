'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'assets/style.css'),'utf8');

class Node{
 constructor(type='div',style='',text=''){
  this.type=type;this.className=style;this.textContent=String(text);this.children=[];this.attrs={};this.style={};this.dataset={};this.scrollHeight=235;this.value='';this.events={};this.parentNode=null;this.disabled=false;
  this.classList={add:(name)=>this.className+=' '+name,remove:(name)=>this.className=this.className.split(' ').filter(x=>x!==name).join(' '),contains:(name)=>this.className.split(' ').includes(name),toggle:(name,on)=>{this.classList[on?'add':'remove'](name)}};
 }
 append(...items){for(const x of items){x.parentNode=this;this.children.push(x)}}
 replaceChildren(...items){this.children=[];this.append(...items)}
 setAttribute(k,v){this.attrs[k]=v}
 getAttribute(k){return this.attrs[k]}
 getBoundingClientRect(){return {top:750,bottom:787,left:240,right:520,width:280}}
 addEventListener(name,handler){this.events[name]=handler}
 querySelectorAll(sel){return this.children.filter(x=>x.className.split(' ').includes(sel.slice(1)))}
 scrollIntoView(){}
 focus(){}
}
function fakeRuntime(){
 const els=new Map(),get=id=>{if(!els.has(id))els.set(id,new Node());return els.get(id)};
 const body=new Node('body');
 const providers=[{id:'provider-aaaaaa',name:'小猪在生图',imageModel:'gpt-image-2.5',hasKey:true},{id:'provider-bbbbbb',name:'第二个中转站',imageModel:'banana-2',hasKey:true}];
 const catalogs=new Map([['provider-aaaaaa',['gpt-image-2.5','gpt-image-1','gpt-4o-mini']]]);
 const fetched=[],remembered=[];
 const ctx={
  document:{body,activeElement:null,addEventListener(){}},innerWidth:1440,innerHeight:900,
  providers,currentUser:{id:'account-example'},activeId:'provider-aaaaaa',modelCatalogByProvider:catalogs,quickModelFetches:new Map(),quickModelOpened:false,quickModelQuery:'',quickModelBusy:false,quickModelError:'',
  $:get,el:(tag,cls='',text='')=>new Node(tag,cls,text),show:id=>get(id).classList.remove('hidden'),hide:id=>get(id).classList.add('hidden'),
  activeProvider:()=>providers.find(p=>p.id===ctx.activeId),
  closeQuickProviderMenu:()=>{},closeCanvasMenu:()=>{},closeModelPicker:()=>{},
  rememberQuickModel:(model,id)=>remembered.push({model,id}),openSettings:()=>{},
  populateComposerModelSuggestions:()=>{},
  toast:()=>{},
  clamp:(x,min,max)=>Math.min(max,Math.max(min,x)),
  api:async url=>{fetched.push(url);return {models:['banana-2','gemini-image','banana-2']}},
  Map,Math,Set,String,Number,
 };
 const start=app.indexOf('function closeQuickModelMenu(){');
 const end=app.indexOf('function populateComposerModelSuggestions(',start);
 assert.ok(start>=0&&end>start);
 vm.createContext(ctx);vm.runInContext(app.slice(start,end),ctx);
 return {ctx,get,providers,catalogs,remembered,fetched};
}
function options(node){return node.children.filter(el=>el.className.split(' ').includes('composer-model-option'))}

test('Help is available before login, documents setup, paid calls, quota and logs',()=>{
 assert.match(html,/id="openHelp"[^>]*>.*?使用帮助/);
 assert.match(html,/id="authHelp"/);
 assert.match(html,/id="helpModal"/);
 for(const chapter of ['三步开始创作','账号注册与登录','添加中转站与选择模型','文字生图与参考图','无限画布与快捷键','图片反推与本地编辑','备份、空间与错误排查'])assert.ok(html.includes(chapter),chapter);
 assert.ok(html.includes('右侧生图模型框或下拉箭头'));
 assert.match(css,/\.help-modal\{[^}]*max-height/);
 assert.match(css,/@media\(max-width:650px\).*\.help-steps\{grid-template-columns:1fr/s);
 assert.match(app,/\$\('openHelp'\)\.onclick=openHelp/);
 assert.match(app,/\$\('authHelp'\)\.onclick=openHelp/);
 assert.match(app,/\$\('helpStartBtn'\)\.onclick=startFromHelp/);
});

test('composer has custom searchable listbox, always allows manual model ID and maintains provider scope',async()=>{
 assert.match(html,/id="imageModel"[^>]+aria-controls="composerModelMenu"/);
 assert.match(html,/id="composerModelToggle"/);
 assert.match(html,/id="composerModelMenu"[^>]+role="listbox"/);
 assert.doesNotMatch(html,/id="imageModel"[^>]+list="modelSuggestions"/);
 const {ctx,get,remembered}=fakeRuntime();
 vm.runInContext("openQuickModelMenu('')",ctx);
 assert.equal(ctx.quickModelOpened,true);
 assert.equal(get('imageModel').attrs['aria-expanded'],'true');
 const first=options(get('composerModelMenu'));
 assert.equal(first.length,3);
 assert.equal(first[1].children[0].textContent,'gpt-image-1');
 first[1].onclick();
 assert.equal(get('imageModel').value,'gpt-image-1');
 assert.equal(remembered[0].id,'provider-aaaaaa');
 assert.equal(remembered[0].model,'gpt-image-1');
 assert.equal(ctx.quickModelOpened,false);
 ctx.activeId='provider-bbbbbb';
 get('imageModel').value='banana-2';
 await vm.runInContext("openQuickModelMenu('')",ctx);
 await new Promise(setImmediate);
 assert.equal(ctx.quickModelOpened,true);
 const names=options(get('composerModelMenu')).map(x=>x.children[0].textContent);
 assert.equal(names.includes('banana-2'),true);
 assert.equal(names.includes('gemini-image'),true);
 assert.equal(names.includes('gpt-image-1'),false,'models from provider A must not leak into provider B');
 vm.runInContext("openQuickModelMenu('gemini')",ctx);
 assert.deepEqual(options(get('composerModelMenu')).map(x=>x.children[0].textContent),['gemini-image']);
 get('imageModel').value='custom-unlisted-model';
 assert.equal(get('imageModel').value,'custom-unlisted-model','manual input remains available');
});

test('opening quick model menu auto-fetches current provider model IDs and renders loading/errors',async()=>{
 const {ctx,get,catalogs,fetched}=fakeRuntime();
 catalogs.clear();
 const wait=vm.runInContext("openQuickModelMenu('')",ctx);
 await new Promise(setImmediate);
 assert.equal(fetched[0],'models?providerId=provider-aaaaaa');
 assert.deepEqual(options(get('composerModelMenu')).map(x=>x.children[0].textContent),['gpt-image-2.5','banana-2','gemini-image']);
 assert.equal(ctx.quickModelBusy,false);
 assert.equal(get('imageModel').attrs['aria-expanded'],'true');
 ctx.api=async()=>{throw Error('upstream /models unavailable')};
 catalogs.delete('provider-aaaaaa');
 await vm.runInContext("loadQuickModels('provider-aaaaaa',true)",ctx);
 assert.match(ctx.quickModelError,/获取失败/);
 assert.match(get('composerModelMenu').children.map(x=>x.textContent).join(' '),/获取失败/);
});

test('model choice becomes the generationBody model and survives provider rerender via scoped preferences',()=>{
 assert.match(app,/providerId:activeId,model:/);
 assert.match(app,/\$\('imageModel'\)\.value\.trim\(\)\|\|activeProvider\(\)\?\.imageModel/);
 assert.match(app,/quickModelPrefs\.get\(p\.id\)\|\|p\.imageModel/);
 assert.match(app,/const key=quickModelStorageKey\(\);if\(key\)savedUi\.set/);
 assert.match(app,/function quickModelStorageKey\(\)\{return currentUser\?\.id\?/);
 assert.match(app,/loadQuickModelPreferences\(\);fillAccountHeader/);
 assert.match(app,/forgetQuickModel\(editId\)/);
 assert.match(app,/bindQuickModelPicker\(\)/);
 assert.match(css,/\.composer-model-menu\{position:fixed;z-index:1610/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});

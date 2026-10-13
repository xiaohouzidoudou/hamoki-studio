'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'assets/style.css'),'utf8');
const backend=fs.readFileSync(path.join(root,'workspace.js'),'utf8');

function segment(begin,end){const i=app.indexOf(begin),j=app.indexOf(end,i+begin.length);assert.ok(i>=0&&j>i,`${begin} not found`);return app.slice(i,j)}

test('canvas menu positions inside viewport, quick provider selector is clickable instead of native dropdown',()=>{
 assert.match(html,/id="canvasMenuToggle"[^>]+aria-expanded="false"/);
 assert.match(html,/id="providerQuickToggle"[^>]+aria-haspopup="listbox"/);
 assert.match(html,/id="providerQuickMenu"[^>]+role="listbox"/);
 assert.match(html,/id="providerSelect"[^>]*aria-hidden="true"/);
 assert.match(app,/\$\('canvasMenuToggle'\)\.onclick=toggleCanvasMenu/);
 assert.match(app,/\$\('providerQuickToggle'\)\.onclick=openQuickProviderMenu/);
 assert.match(app,/document\.body\.append\(menu\)/);
 assert.match(css,/\.canvas-menu\{position:fixed;z-index:1600/);
 assert.match(css,/\.provider-quick-menu\{position:fixed;z-index:1600/);
 const ctx={innerWidth:390,innerHeight:555,clamp:(x,min,max)=>Math.max(min,Math.min(max,x)),Math};
 vm.createContext(ctx);
 vm.runInContext(segment('function positionFloatingMenu(','function closeCanvasMenu()'),ctx);
 const anchor={getBoundingClientRect:()=>({top:38,bottom:72,left:190,right:285,width:95})};
 const menu={id:'canvasMenu',scrollHeight:530,style:{}};
 ctx.positionFloatingMenu(anchor,menu);
 assert.equal(menu.style.top,'80px');
 assert.equal(menu.style.maxHeight,'467px');
 assert.ok(parseInt(menu.style.top)+parseInt(menu.style.maxHeight)<=555);
 const providerAnchor={getBoundingClientRect:()=>({top:484,bottom:522,left:220,right:323,width:103})};
 const providerMenu={id:'providerQuickMenu',scrollHeight:200,style:{}};
 ctx.positionFloatingMenu(providerAnchor,providerMenu,true);
 assert.ok(parseInt(providerMenu.style.top)<providerAnchor.getBoundingClientRect().top);
 assert.ok(parseInt(providerMenu.style.top)>=0);
 assert.ok(parseInt(providerMenu.style.left)+parseInt(providerMenu.style.width)<=390);
});

test('default quantity one, newest generated canvas items are atop selected older assets, captions reflow',()=>{
 const amount=html.match(/id="amount"[^>]*>(.*?)<\/select>/s)?.[1];
 assert.ok(amount&&amount.includes('<option selected>1</option>')&&!amount.includes('<option selected>2</option>'));
 assert.match(app,/card\.style\.zIndex=String\(depth\.get\(n\.id\)\)/);
 assert.match(backend,/p\.nodes\.push\(\{id:crypto\.randomUUID\(\),kind:'generated'/);
 assert.doesNotMatch(css,/\.canvas-node\.selected\{[^}]*z-index:20!important/);
 assert.match(css,/\.canvas-node \.node-foot b\{[^}]*white-space:normal[^}]*-webkit-line-clamp:3/);
 assert.match(css,/\.canvas-node:not\(\.note-node\) \.node-image-box\{[^}]*flex:1 1 auto/);
});

class Faux {
 constructor(tag='',cls='',t=''){
  this.tag=tag;this.className=cls;this.textContent=String(t);this.children=[];this.parentNode=null;this.id='';this.attributes={};
 }
 append(...children){for(const c of children){c.parentNode=this;this.children.push(c)}this.lastElementChild=this.children.at(-1)}
 remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.parentNode=null}}
 setAttribute(k,v){this.attributes[k]=v}
 get firstElementChild(){return this.children[0]}
}

test('generation chat animation shows real queued/running jobs, live wait clock, clears when done',()=>{
 const parent=new Faux('div');parent.id='conversation';
 const find=(node,id)=>node.id===id?node:(node.children||[]).map(c=>find(c,id)).find(Boolean);
 const ctx={
  jobs:[{id:'j1',createdAt:new Date(Date.now()-9000).toISOString(),status:'queued',projectId:'p1'}],
  paused:false,
  $:id=>find(parent,id),
  el:(tag,cls='',text='')=>new Faux(tag,cls,text),
  ico:()=>'<svg></svg>',
  Date,Math
 };
 vm.createContext(ctx);
 vm.runInContext(segment('function activeGenerationJobs()','function renderConversation()'),ctx);
 ctx.syncGenerationActivity();
 const card=find(parent,'generationActivity');assert.ok(card);
 assert.equal(card.attributes.role,'status');
 assert.match(find(parent,'generationTitle').textContent,/排队中/);
 assert.match(find(parent,'generationElapsed').textContent,/已等待/);
 ctx.jobs[0].status='running';ctx.syncGenerationActivity();
 assert.match(find(parent,'generationTitle').textContent,/正在绘制/);
 assert.equal(parent.children.length,1,'do not insert duplicate progress card on repeated polling');
 ctx.jobs[0].status='done';ctx.syncGenerationActivity();
 assert.equal(find(parent,'generationActivity'),undefined);
 assert.match(css,/generationSweep 2s/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(app,/syncGenerationActivity\(\);/);
});

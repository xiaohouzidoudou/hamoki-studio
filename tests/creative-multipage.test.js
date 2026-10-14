'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),net=require('node:net');
const {spawn}=require('node:child_process');
const JSZip=require('jszip');
const {parseDocx}=require('../lib/creative-docx');
const pageTools=require('../lib/creative-pages');
const {styleOutput}=require('./fixtures/ai-asset-style.fixture');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==','base64');
const wait=n=>new Promise(r=>setTimeout(r,n));
const port=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const x=s.address().port;s.close(()=>r(x))})});
const X=txt=>String(txt).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
async function word(title,sections){
 const z=new JSZip(),rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 z.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 z.file('_rels/.rels',`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`);
 z.file('word/_rels/document.xml.rels',`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/image" Target="media/image1.png"/></Relationships>`);
 z.file('word/media/image1.png',PNG);
 const paragraph=t=>`<w:p><w:r><w:t>${X(t)}</w:t></w:r></w:p>`;
 const heading=t=>`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${X(t)}</w:t></w:r></w:p>`;
 const picture='<w:p><w:r><w:drawing><wp:inline><wp:extent cx="10000" cy="10000"/><wp:docPr id="1" name="Prototype"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
 const rows=[paragraph(title),...sections.flatMap(s=>[heading(s.name),paragraph(s.details),...(s.image?[picture]:[])])].join('');
 z.file('word/document.xml',`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${rel}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${rows}</w:body></w:document>`);
 return z.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
test('Word outlines become page tasks and never infer prototype for unrelated page',async()=>{
 const source=await word('周年庆总览',[{name:'登录奖励',details:'签到7天领取奖励',image:true},{name:'4 倍钻石',details:'首充四倍钻石，细节依配置',image:false}]);
 const parsed=await parseDocx(source,()=> '11111111-1111-1111-1111-111111111111.png');
 const doc={...parsed,name:'周年庆总览.docx',id:'doc-a'};
 const pages=pageTools.docPages(doc);
 assert.ok(pages.some(p=>p.name==='登录奖励'&&p.imageIndexes.length===1),JSON.stringify(pages));
 assert.ok(pages.some(p=>p.name==='4 倍钻石'&&p.imageIndexes.length===0),JSON.stringify(pages));
 assert.equal(pages.find(p=>p.name==='4 倍钻石').status,'needs-prototype');
 const ai='{"pages":[{"name":"登录奖励","docId":"doc-a","requirements":"签到7天领取奖励","imageIndexes":[0]},{"name":"4 倍钻石","docId":"doc-a","requirements":"首充四倍钻石，细节依配置","imageIndexes":[]},{"name":"不存在的军团商城","docId":"doc-a","requirements":"","imageIndexes":[]}]}';
 const refined=pageTools.parsePageResponse(ai,[doc],pages);
 assert.equal(refined.length,2);
 assert.equal(refined.find(p=>p.name==='4 倍钻石').imageIndexes.length,0);
 const alternate=pageTools.parsePageResponse(JSON.stringify({pages:[
  {name:'登录奖励页面',docId:'unreliable-model-doc-id',imageIndexes:[0]},
  {name:'4 倍钻石 UI',docId:'',imageIndexes:[]},
  {name:'完全不存在的世界地图',docId:'',imageIndexes:[]}
 ]}),[doc],pages);
 assert.equal(alternate.length,2,'only grounded headings survive freeform suffix and wrong ID');
 assert.ok(alternate.some(p=>p.name==='登录奖励'));
 assert.equal(alternate.find(p=>p.name==='4 倍钻石').imageIndexes.length,0);
});
test('append preserves saved AI page structure, manual content, prototypes and plans',()=>{
 const doc={id:'a',name:'a.docx',blocks:[{kind:'text',level:1,text:'登录奖励'},{kind:'text',text:'原始需求'}],images:[]};
 const saved={id:'page-a',docId:'a',name:'人工拆分页面',requirements:'人工编辑需求',imageIndexes:[1,0],layoutImageIndex:1,
  analysis:{prompt:'有效方案'},quality:{report:'有效质检'},status:'ready',issues:['人工确认']};
 const pages=pageTools.mergePages([saved],[doc,{...doc,id:'b'}]);
 assert.deepEqual(pages[0],saved);
 assert.equal(pages.filter(p=>p.docId==='a').length,1,'append must not recreate pre-split sections');
 assert.equal(pages[1].docId,'b');
 assert.deepEqual(pageTools.mergePages(pages,[doc,{...doc,id:'b'}]),pages,'repeated merge is stable');
 const full=Array.from({length:pageTools.MAX_PAGES},(_,i)=>({...saved,id:'page-'+i}));
 assert.deepEqual(pageTools.mergePages(full,[{...doc,id:'b'},doc]),full,'page limit cannot evict saved pages to make room for new extraction');
});
test('repeated split retains plans only for unchanged requirements and prototype content',()=>{
 const doc={id:'a',name:'a.docx',text:'登录奖励 原始需求 更新需求',images:[{},{}]};
 const previous={id:'page-a',docId:'a',name:'登录奖励',requirements:'原始需求',imageIndexes:[0,1],layoutImageIndex:0,
  analysis:{prompt:'旧提示词',layout:'布局'},quality:{report:'旧质检'},status:'ready'};
 const split=(requirements,imageIndexes,prev=[previous])=>pageTools.parsePageResponse(JSON.stringify({pages:[{docId:'a',name:'登录奖励',requirements,imageIndexes}]}),[doc],prev)[0];
 const unchanged=split('原始需求',[0,1]);
 assert.deepEqual(unchanged.analysis,previous.analysis);assert.deepEqual(unchanged.quality,previous.quality);
 assert.deepEqual(split('原始需求',[0,1],[unchanged]),unchanged);
 for(const page of [split('更新需求',[0,1]),split('原始需求',[1,0]),split('原始需求',[0]),split('原始需求',[])]){
  assert.equal(page.id,previous.id);assert.deepEqual(page.analysis,{});assert.equal(page.quality,null);
  assert.equal(page.status,page.imageIndexes.length?'draft':'needs-prototype');
  assert.deepEqual(split(page.requirements,page.imageIndexes,[page]).analysis,{},'repeated split cannot resurrect a stale prompt');
 }
 const manual={...previous,requirements:'人工编辑的需求'};
 assert.equal(split('',[0,1],[manual]).requirements,manual.requirements,'unlocated AI requirements fall back to saved content');
 assert.deepEqual(split('',[0,1],[manual]).analysis,manual.analysis);
});
test('multi DOCX upload keeps earlier docs and per-page plans, then backup restores correct pointers',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-artflow-multi-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const mockCalls=[];
 const mock=http.createServer(async(req,res)=>{let body='';for await(const b of req)body+=b;const data=JSON.parse(body||'{}');mockCalls.push(data);
  let reply='';
  const c=data.messages?.[0]?.content||'',text=Array.isArray(c)?c[0].text:c;
  if(typeof text==='string'&&text.includes('只做“文档分屏”')){
   const ids=[...text.matchAll(/【docId:([^】]+)】/g)].map(x=>x[1]);
   reply=JSON.stringify({pages:[
    {name:'登录奖励',docId:ids[0],requirements:'签到7天领取奖励',imageIndexes:[0]},
    {name:'4 倍钻石',docId:ids[0],requirements:'首次充值送四倍钻石',imageIndexes:[]},
    {name:'登录奖励详情',docId:ids[1],requirements:'每日签到分别显示奖品和领奖按钮',imageIndexes:[0]}]});
  }
  else if(Array.isArray(c))reply=String(text).includes('原始项目 tnbao91/ai_asset')?styleOutput:'Layout Blueprint 原型区域';
  else reply='最终生图提示词：\n完成正式周年庆 UI 主界面，深蓝金属设计。\n质检清单：保留完整按钮。';
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:reply}}]}));
 });
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));t.after(()=>mock.close());
 const p=await port();
 const proc=spawn(process.execPath,[path.join(__dirname,'..','gateway.js')],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(p),DATA_DIR:dir,APP_ALLOWED_HOST:'127.0.0.1',INVITE_CODE:'artflow-multi-test',APP_ENCRYPTION_KEY:'artflow-multi-local-secret-encryption-key-2026',NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1'},stdio:['ignore','pipe','pipe']});t.after(()=>proc.kill());
 let log='';proc.stdout.on('data',d=>log+=d);proc.stderr.on('data',d=>log+=d);for(let i=0;i<150&&!log.includes('account gateway ready');i++)await wait(50);
 assert.match(log,/account gateway ready/);
 let cookie='';
 async function req(uri,method='GET',body){
  const response=await fetch('http://127.0.0.1:'+p+uri,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const ct=response.headers.get('content-type')||'';
  return {code:response.status,body:ct.includes('json')?await response.json():Buffer.from(await response.arrayBuffer()),headers:response.headers};
 }
 const acc=await req('/api/register','POST',{username:'artflow',password:'testpass999',inviteCode:'artflow-multi-test'});
 assert.equal(acc.code,201);cookie=acc.headers.get('set-cookie').split(';')[0];
 const project=(await req('/api/projects')).body.projects[0].id;
 const first=await word('周年庆总览',[{name:'登录奖励',details:'签到7天领取奖励',image:true},{name:'4 倍钻石',details:'首次充值送四倍钻石',image:false}]);
 const second=await word('周年庆签到详细',[{name:'登录奖励详情',details:'每日签到分别显示奖品和领奖按钮',image:true}]);
 const up1=await req('/api/projects/'+project+'/creative/document','POST',{name:'周年庆总览.docx',data:first.toString('base64')});
 assert.equal(up1.code,201,JSON.stringify(up1.body));
 assert.equal(up1.body.flow.documents.length,1);
 assert.ok(up1.body.flow.pages.some(x=>x.name==='4 倍钻石'),JSON.stringify(up1.body.flow.pages));
 const login=up1.body.flow.pages.find(x=>x.name==='登录奖励');
 const editBeforeUpload=await req('/api/projects/'+project+'/creative/page','POST',{pageId:login.id,requirements:'人工调整登录需求',prototypeIndex:-1});
 assert.equal(editBeforeUpload.code,200);
 const duplicate=await req('/api/projects/'+project+'/creative/document','POST',{name:'重复.docx',data:first.toString('base64')});
 assert.equal(duplicate.code,409);
 const up2=await req('/api/projects/'+project+'/creative/document','POST',{name:'周年庆签到详细.docx',data:second.toString('base64')});
 assert.equal(up2.code,201,JSON.stringify(up2.body));
 let f=up2.body.flow;
 assert.equal(f.documents.length,2);
 assert.deepEqual(f.pages.find(x=>x.id===login.id),editBeforeUpload.body.flow.pages.find(x=>x.id===login.id));
 assert.equal(f.activePageId,login.id);
 const sameName=await req('/api/projects/'+project+'/creative/document','POST',{name:'周年庆总览.docx',data:second.toString('base64')});
 assert.equal(sameName.code,409,'a revised document must not silently create a same-name duplicate');
 assert.ok(f.pages.some(x=>x.name==='登录奖励详情'));
 assert.ok(f.pages.some(x=>x.name==='4 倍钻石'));
 const diamond=f.pages.find(x=>x.name==='4 倍钻石');
 assert.equal(diamond.imageIndexes.length,0,'overview-only diamond must not inherit login prototype');
 const pic=f.pages.find(x=>x.name==='登录奖励详情');
 const page=await req('/api/projects/'+project+'/creative/page','POST',{pageId:pic.id,requirements:'签到页面，有独立奖品格'});
 assert.equal(page.code,200);assert.equal(page.body.flow.activePageId,pic.id);
 const provider=await req('/api/providers','POST',{name:'多角色模拟',url:'http://127.0.0.1:'+mock.address().port+'/v1',mode:'openai',imageModel:'test-image',visionModel:'test-vision',apiKey:'dummy',capabilities:{text:{defaultModel:'test-text'},vision:{defaultModel:'test-vision'}}});
 assert.equal(provider.code,201,JSON.stringify(provider.body));
 const pid=provider.body.provider.id;
 const style=(await req('/api/projects/'+project+'/assets','POST',{name:'官方 UI 风格',image:'data:image/png;base64,'+PNG.toString('base64')})).body.node.id;
 const st=await req('/api/projects/'+project+'/creative/settings','POST',{activePageId:pic.id,notes:'保持风格',styleNodeIds:[style],routing:{text:{providerId:pid,model:'test-text'},vision:{providerId:pid,model:'test-vision'}}});
 assert.equal(st.code,200,JSON.stringify(st.body));
 const go=await req('/api/projects/'+project+'/creative/analyze','POST',{pageId:pic.id});
 assert.equal(go.code,202);
 for(let i=0;i<100;i++){f=(await req('/api/projects/'+project+'/creative')).body.flow;if(['ready','failed'].includes(f.status))break;await wait(35)}
 assert.equal(f.status,'ready',f.error);
 assert.match(f.styleDNA,/Style DNA/);
 assert.ok(f.pages.find(x=>x.id===pic.id).analysis.prompt);
 assert.equal(f.pages.find(x=>x.id===diamond.id).analysis?.prompt,undefined);
 const select=await req('/api/projects/'+project+'/creative/page','POST',{pageId:diamond.id,requirements:'首次充值送四倍钻石'});
 assert.equal(select.code,200);
 assert.equal(select.body.flow.styleDNA,f.styleDNA,'style reused across page selection');
 const go2=await req('/api/projects/'+project+'/creative/analyze','POST',{pageId:diamond.id});
 assert.equal(go2.code,202);
 for(let i=0;i<100;i++){f=(await req('/api/projects/'+project+'/creative')).body.flow;if(['ready','failed'].includes(f.status))break;await wait(35)}
 assert.equal(f.status,'ready',f.error);
 assert.match(f.pages.find(x=>x.id===diamond.id).analysis.prompt,/周年庆/);
 assert.ok(f.pages.find(x=>x.id===pic.id).analysis.prompt,'previous page must not be overwritten');
 const plannedPic=f.pages.find(x=>x.id===pic.id);
 const third=await word('额外商店',[{name:'商店',details:'购买礼包',image:false}]);
 const append=await req('/api/projects/'+project+'/creative/document','POST',{name:'商店.docx',data:third.toString('base64')});
 assert.equal(append.code,201);
 assert.deepEqual(append.body.flow.pages.find(x=>x.id===pic.id),plannedPic,'append keeps edited requirements and analyzed plan');
 const split=await req('/api/projects/'+project+'/creative/split','POST',{});
 assert.equal(split.code,202);
 for(let i=0;i<120;i++){f=(await req('/api/projects/'+project+'/creative')).body.flow;if(['split-ready','failed'].includes(f.status))break;await wait(35)}
 assert.equal(f.status,'split-ready',f.error);
 assert.equal(f.pages.filter(x=>x.name==='登录奖励详情').length,1);
 assert.deepEqual(f.pages.find(x=>x.name==='登录奖励详情').analysis,{},'changed requirements invalidate the old prompt');
 assert.equal(f.pages.find(x=>x.name==='登录奖励详情').quality,null);
 assert.ok(f.pages.find(x=>x.name==='4 倍钻石').analysis.prompt,'unchanged split keeps the valid plan');
 assert.equal(f.pages.find(x=>x.name==='4 倍钻石').imageIndexes.length,0);
 const batch=await req('/api/projects/'+project+'/creative/analyze','POST',{batch:true});
 assert.equal(batch.code,202);
 for(let i=0;i<110;i++){f=(await req('/api/projects/'+project+'/creative')).body.flow;if(['ready','failed'].includes(f.status))break;await wait(35)}
 assert.equal(f.status,'ready',f.error);
 assert.ok(f.pages.every(x=>x.analysis?.prompt),'bounded batch fills every pending page plan');
 assert.equal(f.styleDNA,st.body.flow.styleDNA||f.styleDNA);
 const plans=JSON.parse(JSON.stringify(f.pages));
 const repeat=await req('/api/projects/'+project+'/creative/split','POST',{});
 assert.equal(repeat.code,202);
 for(let i=0;i<120;i++){f=(await req('/api/projects/'+project+'/creative')).body.flow;if(['split-ready','failed'].includes(f.status))break;await wait(35)}
 assert.equal(f.status,'split-ready',f.error);
 assert.deepEqual(f.pages,plans,'identical re-split preserves all valid plans');
 for(const saved of plans){
  const selected=await req('/api/projects/'+project+'/creative/page','POST',{pageId:saved.id});
  assert.deepEqual(selected.body.flow.analysis,saved.analysis);
  assert.deepEqual(selected.body.flow.pages,plans,'page switching cannot change saved requirements or plans');
 }
 const backup=await req('/api/projects/'+project+'/backup');
 assert.equal(backup.code,200);
 const imp=await req('/api/projects/import','POST',{archive:backup.body.toString('base64')});
 assert.equal(imp.code,201,JSON.stringify(imp.body));
 const imported=(await req('/api/projects/'+imp.body.project.id+'/creative')).body.flow;
 assert.equal(imported.documents.length,3);
 assert.equal(imported.pages.length,f.pages.length);
 assert.equal(imported.styleDNA,f.styleDNA);
 assert.notEqual(imported.documents[0].id,f.documents[0].id);
 assert.notEqual(imported.documents[0].images[0].nodeId,f.documents[0].images[0].nodeId);
 assert.equal(imported.pages.find(x=>x.name==='登录奖励详情').analysis.prompt,f.pages.find(x=>x.name==='登录奖励详情').analysis.prompt);
 for(const saved of plans){
  const restored=imported.pages.find(x=>x.name===saved.name);
  for(const key of ['requirements','imageIndexes','layoutImageIndex','analysis','status'])assert.deepEqual(restored[key],saved[key]);
 }
 const restoredAppend=await req('/api/projects/'+imp.body.project.id+'/creative/document','POST',{name:'补充商店.docx',data:(await word('补充商店',[{name:'礼包',details:'领取礼包',image:false}])).toString('base64')});
 assert.equal(restoredAppend.code,201);
 assert.deepEqual(restoredAppend.body.flow.pages.slice(0,imported.pages.length),imported.pages,'restored saved pages survive another upload');
 const restoredPic=imported.pages.find(x=>x.name==='登录奖励详情');
 const changePrototype=await req('/api/projects/'+imp.body.project.id+'/creative/settings','POST',{
  activePageId:restoredPic.id,layoutImageIndex:-1,styleNodeIds:imported.styleNodeIds,notes:imported.notes});
 assert.equal(changePrototype.code,200);
 assert.deepEqual(changePrototype.body.flow.analysis,{});
 assert.equal(changePrototype.body.flow.quality,null);
 assert.ok(changePrototype.body.flow.pages.find(x=>x.name==='4 倍钻石').analysis.prompt,'prototype change invalidates only the changed page');
 assert.equal(imported.routing?.text?.providerId||'', '', 'provider routes should not be copied through backup');
 const remove=await req('/api/projects/'+imp.body.project.id+'/creative/document-remove','POST',{docId:imported.documents[0].id});
 assert.equal(remove.code,200,JSON.stringify(remove.body));
 assert.equal(remove.body.flow.documents.length,3);
 assert.ok(remove.body.flow.pages.every(x=>x.docId!==imported.documents[0].id));
 assert.equal((await req('/api/projects/'+project+'/creative')).body.flow.documents.length,3,'deleting imported copy must not affect original');
});

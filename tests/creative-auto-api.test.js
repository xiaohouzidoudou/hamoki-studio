'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),net=require('node:net');
const JSZip=require('jszip');
const {styleOutput}=require('./fixtures/ai-asset-style.fixture');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==';
const wait=n=>new Promise(r=>setTimeout(r,n));
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
async function docx(){
 const z=new JSZip(),rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 z.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 z.file('_rels/.rels',`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`);
 z.file('word/_rels/document.xml.rels',`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/image" Target="media/image1.png"/></Relationships>`);
 z.file('word/media/image1.png',Buffer.from(png,'base64'));
 const pic='<w:p><w:r><w:drawing><wp:inline><wp:extent cx="10000" cy="10000"/><wp:docPr id="1" name="Proto"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
 z.file('word/document.xml',`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${rel}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>周年庆签到</w:t></w:r></w:p><w:p><w:r><w:t>签到奖励区域，保留原型</w:t></w:r></w:p>${pic}</w:body></w:document>`);
 return z.generateAsync({type:'nodebuffer'});
}
test('one approved request executes original STYLE, LAYOUT, director, one image and CHECK without more clicks',async t=>{
 const calls=[];
 const mock=http.createServer(async(req,res)=>{
  const all=[];for await(const b of req)all.push(b);const raw=Buffer.concat(all),path=req.url;
  const payload=path.includes('/chat/completions')?JSON.parse(raw.toString('utf8')||'{}'):null;
  const prompt=JSON.stringify(payload?.messages||[]);
  calls.push({path,prompt:prompt.slice(0,2000)});
  res.writeHead(200,{'Content-Type':'application/json'});
  if(path.includes('/images/'))return res.end(JSON.stringify({data:[{b64_json:png}]}));
  let content;
  if(prompt.includes('STYLE / ANALYZER')||prompt.includes('STYLE 分析执行规则'))content=styleOutput;
  else if(prompt.includes('原型结构读取员'))content='Layout Blueprint: 5列×6行，保持所有签到奖励';
  else if(prompt.includes('质检员')||prompt.includes('CHECKER')||prompt.includes('CHECK 流程'))content='CHECK: 已对照原型和风格，未发现明显结构错误；待美术确认。';
  else content='最终生图提示词：\n严格使用周年庆签到原型布局，5列6行，游戏风格一致，完整按钮及奖励内容。\n质检清单：保持原型';
  res.end(JSON.stringify({choices:[{message:{content}}]}));
 });
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));t.after(()=>{mock.closeAllConnections();mock.close()});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-auto-creative-'));t.after(async()=>{child.kill();await wait(280);fs.rmSync(dir,{recursive:true,force:true,maxRetries:12,retryDelay:110})});
 const port=await freePort(),root=path.resolve(__dirname,'..');
 const child=spawn(process.execPath,[path.join(root,'gateway.js')],{cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:dir,HOST:'127.0.0.1',APP_ALLOWED_HOST:'ps.test',INVITE_CODE:'flowtest',APP_ENCRYPTION_KEY:'hamoki-auto-creative-integration-test-secret-256',ALLOW_PRIVATE_UPSTREAMS:'1',COOKIE_SECURE:'1',NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);t.after(()=>child.kill());
 for(let i=0;i<120&&!log.includes('account gateway ready');i++)await wait(65);
 assert.match(log,/account gateway ready/,log);
 let cookie='';
 async function api(route,method='GET',body){
  const payload=body===undefined?null:Buffer.from(JSON.stringify(body));
  return await new Promise((resolve,reject)=>{
   const q=http.request({host:'127.0.0.1',port,path:route,method,headers:{Host:'ps.test',...(cookie?{Cookie:cookie}:{}),...(payload?{'Content-Type':'application/json','Content-Length':payload.length}:{})}},res=>{
    const buf=[];res.on('data',x=>buf.push(x));res.on('end',()=>{
     if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];
     const txt=Buffer.concat(buf).toString('utf8');
     try{resolve({status:res.statusCode,body:JSON.parse(txt)})}catch{reject(Error(txt.slice(0,600)))}
    });
   });q.on('error',reject);q.end(payload);
  });
 }
 assert.equal((await api('/api/register','POST',{username:'artauto',password:'fixture-password',inviteCode:'flowtest'})).status,201);
 const pid=(await api('/api/projects')).body.projects[0].id;
 const unapproved=await api('/api/projects/'+pid+'/creative/auto','POST',{instruction:'做签到'});
 assert.notEqual(unapproved.status,202);
 const word=await docx();
 const doc=await api('/api/projects/'+pid+'/creative/document','POST',{name:'周年庆.docx',data:word.toString('base64')});
 assert.equal(doc.status,201,JSON.stringify(doc.body));
 const page=doc.body.flow.pages.find(x=>x.name.includes('周年庆签到'));
 assert.ok(page?.imageIndexes?.length,'real Word prototype must be linked before billing');
 const provider=await api('/api/providers','POST',{name:'MockArt',url:'http://127.0.0.1:'+mock.address().port+'/v1',mode:'openai',imageMode:'images',apiKey:'fake',imageModel:'gpt-image-1',visionModel:'gpt-4o-mini',capabilities:{text:{defaultModel:'gpt-4o-mini'},vision:{defaultModel:'gpt-4o-mini'}}});
 assert.equal(provider.status,201);
 const id=provider.body.provider.id;
 const style=await api('/api/projects/'+pid+'/assets','POST',{name:'真实美术风格参考.png',image:'data:image/png;base64,'+png});
 assert.equal(style.status,201);
 const request={instruction:'参考原型图，绘制周年庆签到UI，按钮突出',confirmed:true,pageId:page.id,review:true,
  routing:{text:{providerId:id,model:'gpt-4o-mini'},vision:{providerId:id,model:'gpt-4o-mini'},image:{providerId:id,model:'gpt-image-1'}},ratio:'9:16',resolution:'1K'};
 const started=await api('/api/projects/'+pid+'/creative/auto','POST',request);
 assert.equal(started.status,202,JSON.stringify(started.body));
 const duplicate=await api('/api/projects/'+pid+'/creative/auto','POST',request);
 assert.equal(duplicate.status,409,'duplicate job is blocked instead of double charging');
 let flow;
 for(let i=0;i<230;i++){
  flow=(await api('/api/projects/'+pid+'/creative')).body.flow;
  if(['awaiting_feedback','failed','uncertain'].includes(flow.autoRun?.status))break;
  await wait(75);
 }
 assert.equal(flow.autoRun?.status,'awaiting_feedback',JSON.stringify({flow:flow.autoRun,error:flow.error,calls:calls.map(x=>x.path),log:log.slice(-750)}));
 assert.match(flow.styleDNA,/rendering/);
 assert.equal(flow.pages.find(x=>x.id===page.id).analysis?.layout?.includes('5列×6行'),true);
 assert.ok(flow.pages.find(x=>x.id===page.id).analysis?.prompt);
 assert.ok(flow.pages.find(x=>x.id===page.id).quality?.report);
 assert.ok(flow.autoRun.resultId);
 const generated=(await api('/api/history?projectId='+pid)).body.history;
 assert.equal(generated.length,1);
 assert.ok(calls.filter(x=>x.path.includes('/images/')).length===1,'single image generation, no paid retry');
 assert.ok(calls.filter(x=>x.path.includes('/chat/completions')).length===4,'STYLE, LAYOUT, director and CHECK exactly once');
 const again=await api('/api/projects/'+pid+'/creative/auto','POST',{...request,ratio:'reference',review:false});
 assert.equal(again.status,202,'another user request may reuse saved plan');
 for(let i=0;i<120;i++){
  flow=(await api('/api/projects/'+pid+'/creative')).body.flow;
  if(flow.autoRun?.id===again.body.runId&&['awaiting_feedback','failed'].includes(flow.autoRun.status))break;
  await wait(65);
 }
 assert.equal(flow.autoRun.status,'awaiting_feedback',flow.autoRun.error);
 assert.equal(flow.autoRun.ratio,'1:1','reference ratio is derived from the actual test prototype (1×1), not the canvas setting');
 assert.equal(calls.filter(x=>x.path.includes('/images/')).length,2,'two user requests generate two images');
 assert.equal(calls.filter(x=>x.path.includes('/chat/completions')).length,4,'existing Style DNA, layout and director plan are reused without redundant model fees');
 // A second-round Chinese correction must automatically reuse the analyzed STYLE
 // even though the project has not yet explicitly locked Style DNA.
 const h1=(await api('/api/history?projectId='+pid)).body.history[0];
 assert.equal(flow.styleLocked,false,'analysis alone does not claim human approval');
 const edit=await api('/api/jobs','POST',{projectId:pid,providerId:id,model:'gpt-image-1',sourceId:h1.id,
  prompt:'背景再暗一点，按钮和奖励其他别动',ratio:'9:16',resolution:'1K',count:1,
  editSpec:{target:'背景',change:'调暗现有背景',preserve:'保留30份奖励和黄色按钮',
   englishVisualTerms:'darken existing background only'}});
 assert.equal(edit.status,201,JSON.stringify(edit.body));
 let refined;
 for(let i=0;i<140;i++){
  const hs=(await api('/api/history?projectId='+pid)).body.history;
  refined=hs.find(h=>h.parentId===h1.id);
  if(refined)break;
  await wait(75);
 }
 assert.ok(refined,'second-round image should be generated using the previous image');
 assert.match(refined.prompt,/保留30份奖励和黄色按钮/);
 assert.match(refined.prompt,/ai_asset STYLE 分析术语/);
 assert.match(refined.prompt,/chunky rectangular UI panels/);
 assert.ok(calls.some(x=>x.path.includes('/images/edits')),'uses actual previous image through edit API');
});

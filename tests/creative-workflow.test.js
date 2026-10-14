'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const net=require('node:net');
const {spawn}=require('node:child_process');
const JSZip=require('jszip');
const {parseDocx}=require('../lib/creative-docx');
const creative=require('../lib/creative-workflow');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLduAAAAABJRU5ErkJggg==','base64');
const uuid=v=>/^[a-f0-9-]{36}$/.test(v);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
async function sampleDocx(){
 const z=new JSZip();
 z.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 z.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 z.file('word/_rels/document.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>');
 z.file('word/media/image1.png',PNG);
 z.file('word/document.xml',`<?xml version="1.0" encoding="UTF-8"?>
 <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
 <w:p><w:r><w:t>周年庆开发需求</w:t></w:r></w:p>
 <w:p><w:r><w:t>游戏主界面入口 → 周年庆菜单 → 登录奖励、超级大放送</w:t></w:r></w:p>
 <w:p><w:r><w:drawing><wp:inline><wp:extent cx="10000" cy="10000"/><wp:docPr id="1" name="Prototype"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
 </w:body></w:document>`);
 return z.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
test('Word document extracts text and embedded prototype picture with order',async()=>{
 const buf=await sampleDocx(),images=[];
 const result=await parseDocx(buf,i=>{images.push(i);return '12345678-1234-1234-1234-123456789abc.png'});
 assert.match(result.text,/周年庆开发需求/);
 assert.match(result.text,/登录奖励/);
 assert.equal(result.images.length,1);
 assert.equal(images.length,1);
 assert.deepEqual(result.blocks.map(x=>x.kind),['text','text','image']);
 assert.equal(result.images[0].mime,'image/png');
 assert.equal(result.hash.length,64);
});
test('compressed DOCX zip bomb is rejected before it can be parsed',async()=>{
 const original=await sampleDocx(),zip=await JSZip.loadAsync(original);
 zip.file('word/huge.xml','x'.repeat(34*1024*1024));
 const tiny=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
 assert.ok(tiny.length<12*1024*1024);
 await assert.rejects(parseDocx(tiny,()=>{throw Error('should not save image')}),/内部文件过大/);
});
test('creative workflow has distinct stages, source-bound prompt and no speculative approvals',()=>{
 const state=creative.make();
 assert.equal(state.stages.document,'pending');
 assert.match(creative.stylePrompt('周年庆'),/Style DNA/);
 assert.match(creative.layoutPrompt('7 个活动','保留槽位'),/TARGET/);
 assert.match(creative.directorPrompt('doc','style','layout','notes'),/最终生图提示词/);
 assert.match(creative.qualityPrompt('doc','style','layout'),/建议返工/);
 assert.match(creative.extractPrompt('设计理解\n...\n最终生图提示词：\n绘制竖屏游戏界面\n质检清单：\n...'),/绘制竖屏/);
});
test('workflow APIs are authenticated, project-bound, restart-persistent and do not auto-call model',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-creative-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const port=await freePort(),proc=spawn(process.execPath,[path.join(__dirname,'..','gateway.js')],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:dir,APP_ALLOWED_HOST:'127.0.0.1',INVITE_CODE:'hamoki-creative-test-invite',APP_ENCRYPTION_KEY:'hamoki-creative-encryption-secret-long-2026',NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1'},stdio:['ignore','pipe','pipe']});
 t.after(()=>proc.kill());
 let output='';proc.stdout.on('data',c=>output+=c);proc.stderr.on('data',c=>output+=c);
 for(let i=0;i<160&&!output.includes('account gateway ready');i++)await wait(50);
 assert.match(output,/account gateway ready/);
 const root='http://127.0.0.1:'+port;let cookie='';
 async function req(url,method='GET',body){const response=await fetch(root+url,{method,headers:{Host:'studio.test',...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();return {status:response.status,data,headers:response.headers}}
 assert.equal((await req('/api/projects')).status,401);
 const signed=await req('/api/register','POST',{inviteCode:'hamoki-creative-test-invite',username:'artist1',password:'secure123'});
 assert.equal(signed.status,201);cookie=signed.headers.get('set-cookie').split(';')[0];
 const projects=await req('/api/projects');const id=projects.data.projects[0].id;assert.ok(uuid(id));
 const initial=await req('/api/projects/'+id+'/creative');assert.equal(initial.status,200,JSON.stringify(initial.data));assert.equal(initial.data.flow.status,'empty');
 const image=await req('/api/projects/'+id+'/assets','POST',{image:'data:image/png;base64,'+PNG.toString('base64'),name:'风格图'});
 assert.equal(image.status,201);
 const file=await sampleDocx();
 const imported=await req('/api/projects/'+id+'/creative/document','POST',{name:'周年庆.docx',data:file.toString('base64')});
 assert.equal(imported.status,201,JSON.stringify(imported.data));
 assert.equal(imported.data.importedImages,1);
 assert.equal(imported.data.flow.stages.document,'done');
 assert.ok(imported.data.flow.document.images[0].nodeId);
 assert.equal((await req('/api/projects/'+id+'/creative/analyze','POST',{})).status,400);
 const saved=await req('/api/projects/'+id+'/creative/settings','POST',{styleNodeIds:[image.data.node.id],layoutImageIndex:0,notes:'按原型创作',routing:{}});
 assert.equal(saved.status,200);
 assert.equal(saved.data.flow.styleNodeIds[0],image.data.node.id);
 assert.equal((await req('/api/projects/'+id+'/creative')).data.flow.notes,'按原型创作');
 assert.equal((await req('/api/projects/'+id+'/creative/settings','POST',{styleNodeIds:['wrong'],routing:{}})).status,400);
 assert.equal((await req('/api/projects/'+id+'/creative/quality','POST',{historyId:'not-existing'})).status,400);
 const userFolder=fs.readdirSync(path.join(dir,'users'))[0];const bkup=JSON.parse(fs.readFileSync(path.join(dir,'users',userFolder,'projects.json'),'utf8')).projects[0];
 assert.equal(bkup.creativeWorkflow.document.images.length,1);
 assert.equal(bkup.creativeWorkflow.stages.document,'done');
 assert.equal(bkup.creativeWorkflow.analysis?.director,undefined);
 const backup=await fetch(root+'/api/projects/'+id+'/backup',{headers:{Cookie:cookie}});
 assert.equal(backup.status,200);
 const encoded=Buffer.from(await backup.arrayBuffer()).toString('base64');
 const restored=await req('/api/projects/import','POST',{archive:encoded});
 assert.equal(restored.status,201,JSON.stringify(restored.data));
 const restoredId=restored.data.project.id;
 const restoredFlow=(await req('/api/projects/'+restoredId+'/creative')).data.flow;
 assert.equal(restoredFlow.document.images.length,1);
 assert.notEqual(restoredFlow.document.images[0].nodeId,imported.data.flow.document.images[0].nodeId);
 assert.equal(restoredFlow.styleNodeIds.length,1);
 assert.ok(restoredFlow.document.images[0].url.startsWith('/api/media/'));
});

test('agent collaboration runs visual style, layout and art direction, then quality review through existing model adapters',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-creative-agents-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const received=[];
 const mock=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk.toString();
  const body=JSON.parse(raw||'{}');received.push({path:req.url,body});
  res.setHeader('Content-Type','application/json');
  if(req.url.endsWith('/images/generations'))return res.end(JSON.stringify({data:[{b64_json:PNG.toString('base64')}]}));
  const content=body.messages?.[0]?.content||'';
  const multimodal=Array.isArray(content);
  const reply=multimodal?(
   String(content[0]?.text||'').includes('游戏 UI 美术风格')?'STYLE DNA: 深蓝金属与切角按钮':
   String(content[0]?.text||'').includes('原型分析')?'Layout Blueprint: 保留登录奖励的所有槽位':
   '质检报告：建议：可提交人工审核'
  ):'页面清单\n登录奖励\n最终生图提示词：\n绘制周年庆签到界面，深蓝色金属切角风格，保持原型槽位。\n质检清单：检查颜色和布局';
  return res.end(JSON.stringify({choices:[{message:{content:reply}}]}));
 });
 await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));t.after(()=>mock.close());
 const port=await freePort(),proc=spawn(process.execPath,[path.join(__dirname,'..','gateway.js')],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:dir,APP_ALLOWED_HOST:'127.0.0.1',INVITE_CODE:'hamoki-test-invite',APP_ENCRYPTION_KEY:'hamoki-test-secret-encryption-at-least-32chars',NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1'},stdio:['ignore','pipe','pipe']});t.after(()=>proc.kill());
 let output='';proc.stdout.on('data',c=>output+=c);proc.stderr.on('data',c=>output+=c);for(let i=0;i<180&&!output.includes('account gateway ready');i++)await wait(50);
 assert.match(output,/account gateway ready/);
 const base='http://127.0.0.1:'+port;let cookie='';
 async function request(uri,method='GET',data){const res=await fetch(base+uri,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});return {code:res.status,payload:await res.json(),cookie:res.headers.get('set-cookie')}};
 const signin=await request('/api/register','POST',{inviteCode:'hamoki-test-invite',username:'designer',password:'testpass123'});assert.equal(signin.code,201);cookie=signin.cookie.split(';')[0];
 const project=(await request('/api/projects')).payload.projects[0].id;
 const image=(await request('/api/projects/'+project+'/assets','POST',{name:'UI 风格图',image:'data:image/png;base64,'+PNG.toString('base64')})).payload.node.id;
 const doc=await sampleDocx();
 const upload=await request('/api/projects/'+project+'/creative/document','POST',{name:'周年庆.docx',data:doc.toString('base64')});assert.equal(upload.code,201);
 const provider=await request('/api/providers','POST',{name:'Mock 文本视觉和图片',url:'http://127.0.0.1:'+mock.address().port+'/v1',mode:'openai',imageMode:'images',imageModel:'test-image',visionModel:'test-vision',apiKey:'test-key',capabilities:{text:{defaultModel:'test-text'},vision:{defaultModel:'test-vision'}}});assert.equal(provider.code,201,JSON.stringify(provider.payload));
 const pid=provider.payload.provider.id;
 const settings=await request('/api/projects/'+project+'/creative/settings','POST',{styleNodeIds:[image],layoutImageIndex:0,notes:'游戏周年庆',routing:{text:{providerId:pid,model:'test-text'},vision:{providerId:pid,model:'test-vision'}}});assert.equal(settings.code,200);
 assert.equal(received.length,0,'no model calls from upload or settings');
 const run=await request('/api/projects/'+project+'/creative/analyze','POST',{});assert.equal(run.code,202);
 let flow;
 for(let i=0;i<120;i++){flow=(await request('/api/projects/'+project+'/creative')).payload.flow;if(['ready','failed'].includes(flow.status))break;await wait(50)}
 assert.equal(flow.status,'ready',flow.error||'analysis has not completed');
 assert.match(flow.analysis.style,/深蓝金属/);assert.match(flow.analysis.layout,/槽位/);assert.match(flow.analysis.prompt,/绘制周年庆签到界面/);
 assert.equal(received.length,3,'exactly two vision calls plus one text model call');
 const job=await request('/api/jobs','POST',{projectId:project,providerId:pid,model:'test-image',prompt:flow.analysis.prompt,count:1,ratio:'9:16',resolution:'1K'});
 assert.equal(job.code,201,JSON.stringify(job.payload));
 let result;
 for(let i=0;i<120;i++){result=(await request('/api/jobs?projectId='+project)).payload.jobs[0];if(result.status==='done')break;await wait(50)}
 assert.equal(result.status,'done',result.error||'image generation timed out');
 const hist=(await request('/api/history?projectId='+project)).payload.history;
 assert.ok(hist.length>0);
 const reviewed=await request('/api/projects/'+project+'/creative/quality','POST',{historyId:hist[0].id});assert.equal(reviewed.code,202);
 for(let i=0;i<120;i++){flow=(await request('/api/projects/'+project+'/creative')).payload.flow;if(['review','failed'].includes(flow.status))break;await wait(50)}
 assert.equal(flow.status,'review',flow.error||'quality review timed out');
 assert.match(flow.quality.report,/质检报告/);
 assert.equal(received.length,5,'two style/layout vision, art director, image generation, quality review');
 assert.equal(received[0].body.messages[0].content.filter(p=>p.type==='image_url').length,1);
 assert.equal(received[1].body.messages[0].content.filter(p=>p.type==='image_url').length,1);
 assert.equal(received[4].body.messages[0].content.filter(p=>p.type==='image_url').length,3);
});


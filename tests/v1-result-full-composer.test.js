'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const composer=fs.readFileSync(path.join(root,'assets','result-floating-composer.js'),'utf8');
const host=fs.readFileSync(path.join(root,'studio-v2.js'),'utf8');
const css=fs.readFileSync(path.join(root,'assets','result-popup-controls.css'),'utf8');

test('result toolbar gives common actions priority and pins Download at far right',()=>{
  for(const action of ['edit','reference','reuse','reverse'])
    assert.match(composer,new RegExp("'"+action+"'"));
  assert.match(composer,/const menu=mk\('details','result-toolbar-more'\)/);
  assert.match(composer,/footer\.append\(download\);\s*toolbar\.append\(footer\)/);
  assert.match(css,/\.result-toolbar-download\{[^}]*margin-left:auto/);
  assert.match(css,/\.result-toolbar-primary\s*\{/);
});
test('floating composer contains working model, reference, ratio, resolution, count, output and optimizer controls',()=>{
  for(const term of ['图像模型','中转商','优化提示词','从图片反推','人物融入','完整复制','参考图片','画面比例','清晰度','生成数量','透明背景','加入生成队列','getProvider','/api/models?providerId='])
    assert.ok(composer.includes(term),'missing '+term);
  assert.match(composer,/new File|URL\.createObjectURL/);
  assert.match(composer,/RATIO_FALLBACK/);
  assert.doesNotMatch(composer,/透明精修/);
  assert.match(composer,/ctx\.onGenerate\(payload\)/);
  assert.match(host,/sourceId:hasCurrent\?h\.id:null/);
  assert.match(host,/图片反推需要调用视觉模型，可能产生费用/);
  assert.match(host,/const accepted=await api\('\/api\/jobs',payload\(request\)\)/);
  assert.doesNotMatch(host.slice(host.indexOf('async function submitFromResultComposer'),host.indexOf('function generatedCard')),/HamokiReferences\.clear/);
});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise((resolve,reject)=>{
  const sock=net.createServer();
  sock.once('error',reject);
  sock.listen(0,'127.0.0.1',()=>{
    const port=sock.address().port;
    sock.close(()=>resolve(port));
  });
});
test('isolated zero-cost backend accepts selected 2K 16:9 two-image popup request and source links', {timeout:30000}, async t=>{
  const port=await freePort();
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-result-composer-'));
  const server=spawn(process.execPath,['server.js'],{
    cwd:root,stdio:'ignore',windowsHide:true,
    env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dataDir,
      DEMO_MODE:'1',APP_PASSWORD:'isolated-qa-only',APP_BASE_PATH:'',APP_ALLOWED_HOST:''}
  });
  t.after(async()=>{
    if(server.exitCode===null){
      server.kill();
      await Promise.race([
        new Promise(resolve=>server.once('exit',resolve)),
        delay(1400)
      ]);
    }
    fs.rmSync(dataDir,{recursive:true,force:true});
  });
  const base='http://127.0.0.1:'+port;
  let ready=false;
  for(let i=0;i<80;i++){
    try{if((await fetch(base+'/api/status')).ok){ready=true;break;}}catch{}
    await delay(75);
  }
  assert.ok(ready,'demo server must boot');
  async function ask(route,method='GET',data){
    const res=await fetch(base+route,{
      method,headers:data===undefined?undefined:{'Content-Type':'application/json'},
      body:data===undefined?undefined:JSON.stringify(data)
    });
    const output=await res.json();
    assert.ok(res.ok,'API '+route+' HTTP '+res.status+': '+JSON.stringify(output).slice(0,150));
    return output;
  }
  const providers=(await ask('/api/providers')).providers;
  const p=providers.find(item=>item.mode==='openai')||providers[0];
  assert.ok(p);
  const projectId=(await ask('/api/projects')).defaultId;
  assert.ok(projectId);
  const jobsBefore=(await ask('/api/jobs')).jobs.length;
  async function waitDone(jobId){
    for(let i=0;i<85;i++){
      const job=(await ask('/api/jobs')).jobs.find(item=>item.id===jobId);
      if(job?.status==='done')return job;
      if(job?.status==='failed')throw Error(job.error);
      await delay(65);
    }
    throw Error('mock job did not finish');
  }
  const original=(await ask('/api/jobs','POST',{
    projectId,targets:[{providerId:p.id,model:p.imageModel}],
    prompt:'隔离图片来源',ratio:'1:1',resolution:'1K',quality:'auto',count:1,references:[]
  })).jobs[0];
  const doneOriginal=await waitDone(original.id);
  const nodes=(await ask('/api/projects/'+projectId)).project.nodes;
  const fromNode=nodes.find(node=>node.historyId===doneOriginal.resultId);
  assert.ok(fromNode,'source node should exist');
  const miniImage=fs.readFileSync(path.join(root,'assets','hamoki-avatar-128.webp'));
  // Equivalent to the popup submit shape: sourceId references the selected
  // image once, while extra upload is in references and not duplicated.
  const request={
    projectId,targets:[{providerId:p.id,model:p.imageModel}],
    prompt:'保持布局并改为绿色游戏UI',ratio:'16:9',resolution:'2K',
    count:2,quality:'auto',transparentBg:false,editMode:'new',
    sourceId:doneOriginal.resultId,sourceNodeId:fromNode.id,
    canvasX:fromNode.x+fromNode.w+36,canvasY:fromNode.y,
    references:['data:image/webp;base64,'+miniImage.toString('base64')]
  };
  const created=(await ask('/api/jobs','POST',request)).jobs;
  assert.equal(created.length,2);
  await Promise.all(created.map(j=>waitDone(j.id)));
  const final=(await ask('/api/jobs')).jobs.filter(j=>created.some(c=>c.id===j.id));
  assert.equal(final.length,2);
  for(const j of final){
    assert.equal(j.ratio,'16:9');
    assert.equal(j.resolution,'2K');
    assert.equal(j.sourceId,doneOriginal.resultId);
    assert.equal(j.status,'done');
  }
  const history=(await ask('/api/history')).history;
  for(const j of final){
    const h=history.find(x=>x.id===j.resultId);
    assert.equal(h.parentId,doneOriginal.resultId);
    assert.equal(h.referenceMedia.length,1,'additional reference present exactly once');
  }
  assert.equal((await ask('/api/jobs')).jobs.length,jobsBefore+3);
});

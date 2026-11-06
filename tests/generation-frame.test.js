'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const vm=require('node:vm');
const {spawn}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function freePort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.on('error',reject);
    server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});
  });
}
async function ask(base,route,method='GET',data){
  const response=await fetch(base+route,{method,headers:data===undefined?undefined:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const body=await response.json().catch(()=>({}));
  assert.ok(response.ok,`API ${route} returned ${response.status} ${JSON.stringify(body).slice(0,180)}`);
  return body;
}

test('submitted jobs reserve a canvas frame with name, slot and predicted pixel size',{timeout:40000},async t=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-frame-'));
  const port=await freePort();
  const base='http://127.0.0.1:'+port;
  const child=spawn(process.execPath,['server.js'],{
    cwd:root,stdio:'ignore',windowsHide:true,
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:dataDir,DEMO_MODE:'1',NODE_ENV:'test',
      APP_PASSWORD:'qa-only-local',APP_ENCRYPTION_KEY:'',APP_BASE_PATH:'',APP_ALLOWED_HOST:''}
  });
  t.after(async()=>{
    if(child.exitCode===null){
      const gone=new Promise(resolve=>child.once('exit',resolve));
      child.kill();
      await Promise.race([gone,new Promise(resolve=>setTimeout(resolve,1400))]);
    }
    fs.rmSync(dataDir,{recursive:true,force:true});
  });
  let ready=false;
  for(let i=0;i<80;i++){
    try{const response=await fetch(base+'/api/status');if(response.ok){ready=true;break}}catch{}
    await new Promise(resolve=>setTimeout(resolve,70));
  }
  assert.ok(ready,'local test server should start');

  const providers=(await ask(base,'/api/providers')).providers;
  assert.ok(providers.length,'demo providers should be seeded');
  const provider=providers[0];
  const projectId=(await ask(base,'/api/projects')).defaultId;
  await ask(base,'/api/queue','POST',{action:'pause'});

  const submit=async()=>ask(base,'/api/jobs','POST',{
    prompt:'canvas frame test',targets:[{providerId:provider.id,model:provider.imageModel}],
    projectId,ratio:'16:9',resolution:'1K',quality:'auto',count:1
  });

  const first=(await submit()).jobs[0];
  assert.equal(first.name,'图片生成1');
  assert.deepEqual(first.preview,{width:1536,height:864});
  assert.deepEqual(first.planned,{x:150,y:170,w:288,h:162});

  const second=(await submit()).jobs[0];
  assert.equal(second.name,'图片生成2');
  assert.deepEqual(second.planned,{x:150+288+36,y:170,w:288,h:162});

  const listed=(await ask(base,'/api/jobs')).jobs;
  assert.equal(listed.find(job=>job.id===first.id).status,'queued');
  assert.deepEqual(listed.find(job=>job.id===first.id).preview,{width:1536,height:864});

  await ask(base,'/api/queue','POST',{action:'resume'});
  let done=null;
  for(let i=0;i<120;i++){
    const jobs=(await ask(base,'/api/jobs')).jobs;
    const two=jobs.filter(job=>[first.id,second.id].includes(job.id));
    if(two.length===2&&two.every(job=>job.status==='done')){done=two;break}
    if(two.some(job=>job.status==='failed'))throw Error('mock generation failed: '+JSON.stringify(two.find(job=>job.status==='failed')));
    await new Promise(resolve=>setTimeout(resolve,60));
  }
  assert.ok(done,'demo generations should complete');

  const nodes=(await ask(base,'/api/projects/'+projectId)).project.nodes.filter(node=>node.kind==='generated');
  assert.equal(nodes.length,2);
  const byName=new Map(nodes.map(node=>[node.title,node]));
  assert.ok(byName.has('图片生成1'),'first job keeps its canvas name');
  assert.ok(byName.has('图片生成2'),'second job keeps its canvas name');
  assert.equal(byName.get('图片生成1').x,first.planned.x);
  assert.equal(byName.get('图片生成1').y,first.planned.y);
  assert.equal(byName.get('图片生成2').x,second.planned.x);
  for(const node of nodes)
    assert.ok(Number.isInteger(node.pixelWidth)&&Number.isInteger(node.pixelHeight),'finished node stores real pixel size');
});

test('canvas renders generation frames and a name/size caption for finished art',()=>{
  const html=read('index.html');
  const css=read('assets/generation-frame.css');
  const module=read('assets/generation-frame.js');
  const studio=read('studio-v2.js');
  const script=read('script.js');

  assert.match(html,/assets\/generation-frame\.css\?v=/);
  assert.match(html,/assets\/generation-frame\.js\?v=/);
  assert.ok(html.indexOf('assets/generation-frame.css')>html.indexOf('assets/interaction-system.css'),'frame css loads late');

  // Loading state: one transparent 6s monkey progress animation, no duplicate spinner/track.
  assert.match(css,/\.generation-frame-monkey\{/);
  assert.match(css,/\.generation-frame-monkey-img\{/);
  assert.doesNotMatch(css,/\.generation-frame-spinner/);
  assert.doesNotMatch(css,/\.generation-frame-track/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/\.canvas-node-caption/);

  // Failures are queue-only: no failed/interrupted styling ships for the canvas.
  assert.doesNotMatch(css,/\.generation-frame\.status-failed/);
  assert.doesNotMatch(css,/\.generation-frame\.status-interrupted/);
  assert.doesNotMatch(css,/\.generation-frame-error/);
  assert.doesNotMatch(css,/\.generation-frame-hint/);

  // Placeholder creation, job sync, and slot reservation from the server payload.
  assert.match(module,/window\.HamokiGenerationFrames\s*=\s*\{/);
  assert.match(module,/planned/);
  assert.match(module,/previewFor/);
  assert.match(module,/'16:9':'1536x864'/);
  assert.match(module,/hamoki-monkey-progress-6s-loop\.webp/);
  assert.match(module,/hamoki-monkey-progress-still\.webp/);
  assert.match(module,/generation-frame-monkey/);
  assert.doesNotMatch(module,/className = 'generation-frame-spinner'/);
  assert.doesNotMatch(module,/className = 'generation-frame-track'/);
  assert.match(module,/生成中/);
  assert.match(module,/scrollToVirtual/);

  // Only in-flight jobs are drawn on the canvas; failures never get a frame.
  assert.match(module,/const VISIBLE = new Set\(\['queued','running'\]\)/);
  assert.doesNotMatch(module,/status-failed/);
  assert.doesNotMatch(module,/生成失败/);

  // Finished art gets the same caption style with its real pixel size.
  assert.match(studio,/canvas-node-caption/);
  assert.match(studio,/node\.title\|\|\('图片生成'/);
  assert.match(studio,/node\.pixelWidth/);
  assert.match(studio,/image\.naturalWidth/);
  assert.match(studio,/HamokiGenerationFrames\?\.mount\(area\)/);

  // The bottom queue panel is the only place failures are reported.
  assert.match(script,/queue-error/);
  assert.match(script,/失败 \$\{failed\.length\}/);
  assert.match(script,/data-action="\$\{action\}"/);

  // Queue polling and submit both feed the canvas frames.
  assert.match(script,/HamokiGenerationFrames\?\.sync\(state\.jobs\)/);
  assert.match(script,/HamokiGenerationFrames\?\.sync\(createdJobs\.concat\(state\.jobs\)\)/);
  assert.match(script,/HamokiGenerationFrames\?\.reveal\(createdJobs\[0\]\)/);
  assert.match(script,/canvas\.querySelectorAll\('\.canvas-node, \.generation-frame'\)/);
});

test('failed or interrupted jobs leave no frame on the canvas',()=>{
  const dom=require('./helpers/ui-dom.cjs')();
  const window={};
  const context={document:dom.document,window,console};
  vm.runInNewContext(read('assets/generation-frame.js'),context);
  const frames=window.HamokiGenerationFrames;
  assert.ok(frames,'generation frames API is exposed');
  const canvas=dom.document.getElementById('canvas');
  assert.ok(canvas,'index.html provides the canvas element');
  frames.mount(canvas);

  const job={id:'job-1',name:'图片生成1',status:'queued',planned:{x:150,y:170,w:288,h:162}};
  frames.sync([job]);
  assert.equal(canvas.querySelectorAll('.generation-frame').length,1,'queued job reserves a frame');

  job.status='running';
  frames.sync([job]);
  assert.equal(canvas.querySelectorAll('.generation-frame').length,1,'running job keeps its frame');

  job.status='failed';
  job.error='上游 HTTP 524: 网关等待上游图片模型响应超时';
  frames.sync([job]);
  assert.equal(canvas.querySelectorAll('.generation-frame').length,0,'failed job removes its canvas frame');
  assert.doesNotMatch(canvas.textContent,/524|生成失败|可能已计费/,'failure copy stays off the canvas');

  job.status='interrupted';
  frames.sync([job]);
  assert.equal(canvas.querySelectorAll('.generation-frame').length,0,'interrupted job removes its canvas frame');

  const retry={id:'job-2',name:'图片生成2',status:'queued',retryOf:'job-1',planned:{x:150,y:170,w:288,h:162}};
  frames.sync([job,retry]);
  const framesAfterRetry=canvas.querySelectorAll('.generation-frame');
  assert.equal(framesAfterRetry.length,1,'a retry paints one fresh frame');
  assert.equal(framesAfterRetry[0].dataset.jobId,'job-2');
  const picture=framesAfterRetry[0].querySelector('.generation-frame-monkey');
  assert.ok(picture,'generation placeholder contains the monkey picture');
});

test('plush logo replays once per 60 seconds and pauses for reduced motion or hidden tabs',()=>{
  const html=read('index.html');
  const code=read('assets/logo-replay.js');
  assert.ok(html.includes('assets/logo-replay.js?v='));
  let time=1000;
  let ticker=null;
  let period=null;
  let intervalCount=0;
  const logo={src:'assets/hamoki-intro-once.webp'};
  const documentHandlers={};
  const windowHandlers={};
  const motionHandlers={};
  const motion={matches:false,addEventListener:(key,callback)=>{motionHandlers[key]=callback;}};
  const dom={
    baseURI:'http://127.0.0.1:8028/',
    hidden:false,
    querySelector:()=>logo,
    addEventListener:(key,callback)=>{documentHandlers[key]=callback;}
  };
  const win={
    matchMedia:()=>motion,
    addEventListener:(key,callback)=>{windowHandlers[key]=callback;},
    setInterval:(callback,ms)=>{ticker=callback;period=ms;return ++intervalCount;},
    clearInterval:()=>{ticker=null;}
  };
  vm.runInNewContext(code,{window:win,document:dom,Date:{now:()=>time},URL});
  assert.equal(period,60000);
  assert.equal(logo.src,'assets/hamoki-intro-once.webp','initial page opening uses the one-shot asset');

  time+=60000;
  ticker();
  const first=logo.src;
  assert.match(first,/replay=/,'one-minute timer restarts the animation');
  time+=60000;
  ticker();
  assert.notEqual(logo.src,first,'following minute starts a fresh animation');

  dom.hidden=true;
  const hiddenFrame=logo.src;
  time+=60000;
  ticker();
  assert.equal(logo.src,hiddenFrame,'background tabs should not replay');
  dom.hidden=false;
  documentHandlers.visibilitychange();
  assert.notEqual(logo.src,hiddenFrame,'returning after a minute restarts once');

  motion.matches=true;
  motionHandlers.change();
  assert.equal(ticker,null,'reduced motion stops the recurring timer');

  motion.matches=false;
  motionHandlers.change();
  assert.equal(period,60000,'animation timer is restored when motion is enabled');
  const beforeBfcache=logo.src;
  time+=500;
  windowHandlers.pageshow({persisted:true});
  assert.notEqual(logo.src,beforeBfcache,'back/forward cache restores a fresh animation');
});

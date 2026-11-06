'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..');

async function request(url, options, expected) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (expected !== undefined) assert.equal(res.status, expected, JSON.stringify(data));
  return {status:res.status, data};
}
const json = (body, method = 'POST') => ({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

test('V1 524 has clear uncertain status; retry requires JSON, explicit acknowledgement and is idempotent', {timeout:25000}, async t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(),'hamoki-v1-524-'));
  const fake = http.createServer((req,res) => {
    if (req.url === '/v1/images/generations' && req.method === 'POST') {
      res.writeHead(524, {'Content-Type':'text/html'});
      res.end('<html><body>Cloudflare simulated timeout</body></html>');
    } else {
      res.writeHead(404,{'Content-Type':'application/json'});
      res.end('{}');
    }
  });
  await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));
  const temp = http.createServer();
  await new Promise(resolve=>temp.listen(0,'127.0.0.1',resolve));
  const port = temp.address().port;
  await new Promise(resolve=>temp.close(resolve));
  const base='http://127.0.0.1:'+port, upstream='http://127.0.0.1:'+fake.address().port+'/v1';
  const child = spawn(process.execPath,['server.js'],{
    cwd:root,stdio:'ignore',windowsHide:true,
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:data,
      APP_PASSWORD:'test-only-not-a-real-key',APP_ENCRYPTION_KEY:'',DEMO_MODE:'0',
      APP_BASE_PATH:'',APP_ALLOWED_HOST:'',NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1'}
  });
  t.after(async()=>{
    if(child.exitCode===null) {
      const finished=new Promise(resolve=>child.once('exit',resolve));
      child.kill();
      await Promise.race([finished,new Promise(resolve=>setTimeout(resolve,1500))]);
    }
    fake.closeAllConnections();
    await new Promise(resolve=>fake.close(resolve));
    fs.rmSync(data,{force:true,recursive:true});
  });
  let online=false;
  for(let i=0;i<80;i++){
    try{const r=await fetch(base+'/api/status');if(r.ok){online=true;break;}}
    catch{}
    await new Promise(resolve=>setTimeout(resolve,65));
  }
  assert.equal(online,true,'test server started');

  const provider=(await request(base+'/api/providers',json({
    name:'Fake 524 upstream',url:upstream,mode:'openai',apiKey:'fake-token',
    imageMode:'images',imageModel:'qa-image',visionModel:'qa-vision'
  }),201)).data.provider;
  const created=await request(base+'/api/jobs',json({
    prompt:'安全测试，没有真实付费模型',targets:[{providerId:provider.id}],
    ratio:'1:1',resolution:'1K',quality:'auto',count:1
  }),201);
  const first=created.data.jobs[0].id;
  let failed;
  for(let i=0;i<90;i++){
    const data=(await request(base+'/api/jobs',undefined,200)).data.jobs;
    failed=data.find(job=>job.id===first);
    if(failed?.status==='failed')break;
    await new Promise(resolve=>setTimeout(resolve,55));
  }
  assert.equal(failed?.status,'failed');
  assert.equal(failed?.completionUncertain,true);
  assert.match(failed.error,/524/);
  assert.match(failed.error,/可能.*(?:扣费|计费)/);

  const notAcknowledged=await request(base+'/api/jobs/'+first+'/retry',json({}),400);
  assert.match(notAcknowledged.data.error,/已计费|重复扣费/);
  const still=(await request(base+'/api/jobs',undefined,200)).data.jobs;
  assert.equal(still.length,1,'no retry without explicit charge confirmation');

  const retry=await request(base+'/api/jobs/'+first+'/retry',json({acknowledgePotentialCharge:true}),201);
  assert.equal(retry.data.job.retryOf,first);
  const duplicate=await request(base+'/api/jobs/'+first+'/retry',json({acknowledgePotentialCharge:true}),400);
  assert.match(duplicate.data.error,/已经提交过重试/);
  assert.equal((await request(base+'/api/jobs',undefined,200)).data.jobs.length,2);

  await request(base+'/api/queue',json({action:'pause'}),200);
  const queued=(await request(base+'/api/jobs',json({
    prompt:'cancellable test',targets:[{providerId:provider.id}],count:1
  }),201)).data.jobs[0];
  assert.equal(queued.status,'queued');
  const cancelled=await request(base+'/api/jobs/'+queued.id+'/cancel',json({}),200);
  assert.equal(cancelled.data.job.status,'cancelled');

  const ui=fs.readFileSync(path.join(root,'script.js'),'utf8');
  assert.match(ui,/acknowledgePotentialCharge:\s*true/);
  assert.match(ui,/Content-Type':\s*'application\/json'/);
});

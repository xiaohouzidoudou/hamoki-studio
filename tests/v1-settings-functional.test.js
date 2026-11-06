'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const {spawn} = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
async function read(base, route, opts = {}, expected = 200) {
  const response = await fetch(base + route, opts);
  const value = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, route + ' returned ' + JSON.stringify(value));
  return value;
}
const body = value => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});

test('V1 settings: no temporary provider, save/edit retains key, models and canvas persist', {timeout:40000}, async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hamoki-v1-qa-'));
  const modelIds = ['qa-image-model', 'qa-vision-model'];
  const upstream = http.createServer((req, res) => {
    if (req.url !== '/v1/models' || req.method !== 'GET') {res.writeHead(404);return res.end();}
    if (req.headers.authorization !== 'Bearer fake-test-token') {res.writeHead(401);return res.end('{}');}
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({data:modelIds.map(id => ({id}))}));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const providerURL = 'http://127.0.0.1:' + upstream.address().port + '/v1';
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  let child;

  const startApp = () => {
    child = spawn(process.execPath, ['server.js'], {
      cwd:ROOT, stdio:'ignore', windowsHide:true,
      env:{...process.env, PORT:String(port), HOST:'127.0.0.1', DATA_DIR:dataDir,
        APP_PASSWORD:'qa-only-local-password',APP_ENCRYPTION_KEY:'',
        DEMO_MODE:'0', NODE_ENV:'test',ALLOW_PRIVATE_UPSTREAMS:'1',
        APP_BASE_PATH:'', APP_ALLOWED_HOST:''}
    });
  };
  const stopApp = async () => {
    if (!child || child.exitCode !== null) return;
    const exiting = new Promise(resolve => child.once('exit',resolve));
    child.kill();
    await Promise.race([exiting,new Promise(resolve=>setTimeout(resolve,1600))]);
  };
  const ready = async () => {
    for (let i=0;i<100;i++) {
      if (child?.exitCode !== null) throw Error('Test server stopped before ready');
      try {
        const res = await fetch(base + '/api/status');
        if (res.ok) return;
      } catch {}
      await new Promise(resolve=>setTimeout(resolve,90));
    }
    throw Error('Test server did not become ready');
  };
  t.after(async () => {
    await stopApp();
    await new Promise(resolve => upstream.close(resolve));
    fs.rmSync(dataDir, {recursive:true, force:true});
  });
  startApp();
  await ready();
  const html = await fetch(base + '/');
  assert.equal(html.status, 200);
  assert.match(await html.text(), /settings-v2\.js/);
  assert.equal((await fetch(base + '/studio-v2.js')).status, 200);
  const legacySettings = await fetch(base + '/settings.html',{redirect:'manual'});
  assert.equal(legacySettings.status,302);
  assert.equal(legacySettings.headers.get('location'),'/?settings=1');

  assert.equal((await read(base, '/api/providers')).providers.length,0);
  const listed = await read(base,'/api/providers/discover-models',
      body({url:providerURL,mode:'openai',apiKey:'fake-test-token'}));
  assert.deepEqual(listed.models,modelIds);
  assert.equal((await read(base,'/api/providers')).providers.length,0,'model lookup must not save temporary providers');

  const created = await read(base,'/api/providers',body({
    name:'Test upstream',url:providerURL,apiKey:'fake-test-token',
    mode:'openai',imageMode:'images',imageModel:modelIds[0],visionModel:modelIds[1]
  }),201);
  const providerId = created.provider.id;
  assert.equal(created.provider.hasKey,true);
  assert.equal(created.provider.apiKey,undefined,'API keys must never appear in list responses');

  const updated = await read(base, '/api/providers/' + providerId, {
    method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:'Edited upstream',url:providerURL,mode:'openai',
      imageMode:'images',imageModel:modelIds[0],visionModel:modelIds[1]})
  });
  assert.equal(updated.provider.hasKey,true,'editing without a new key must preserve the original');
  const providers = await read(base,'/api/providers');
  assert.equal(providers.providers.length,1,'editing must not create another provider');
  assert.equal(providers.providers[0].name,'Edited upstream');
  assert.equal(providers.providers[0].hasKey,true);
  assert.deepEqual((await read(base,'/api/models?providerId='+providerId)).models,modelIds);

  // Activation is an empty-body action but still must send application/json.
  const second = await read(base,'/api/providers',body({
    name:'Second test upstream',url:providerURL,apiKey:'another-fake-test-token',
    mode:'openai',imageMode:'images',imageModel:modelIds[0],visionModel:modelIds[1]
  }),201);
  assert.equal((await read(base,'/api/providers')).activeId,providerId);
  const activation = await read(base,
    '/api/providers/' + second.provider.id + '/activate',body({}));
  assert.equal(activation.activeId,second.provider.id);
  assert.equal((await read(base,'/api/providers')).activeId,second.provider.id,
    'switching providers must be stored');
  await read(base,'/api/providers/' + providerId + '/activate',body({}));
  assert.equal((await read(base,'/api/providers')).activeId,providerId);

  const projectId = (await read(base,'/api/projects')).defaultId;
  assert.ok(projectId);
  const note = await read(base,'/api/projects/'+projectId+'/notes',body({text:'Persisted note',x:150,y:170}),201);
  assert.equal(note.node.kind,'note');
  assert.equal((await read(base,'/api/projects/'+projectId)).project.nodes.length,1);
  const clear = await read(base,'/api/projects/'+projectId+'/nodes',{method:'DELETE'});
  assert.equal(clear.removed,1);
  assert.equal(clear.historyPreserved,true);
  assert.equal((await read(base,'/api/projects/'+projectId)).project.nodes.length,0);

  await stopApp();
  startApp();await ready();
  const afterRestart = await read(base,'/api/providers');
  assert.equal(afterRestart.providers.length,2,'encrypted providers persist across a full restart');
  assert.equal(afterRestart.activeId,providerId,'selected provider persists across a full restart');
  assert.equal(afterRestart.providers[0].hasKey,true);
  assert.equal(afterRestart.providers[0].name,'Edited upstream');
});

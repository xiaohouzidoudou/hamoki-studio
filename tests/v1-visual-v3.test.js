'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const read = f => fs.readFileSync(path.join(root,f),'utf8');

test('visual V3 is a real three-column app with a queue inside the canvas workspace',() => {
  const html=read('index.html');
  const start=html.indexOf('<div class="canvas-area">');
  const queue=html.indexOf('id="queue-panel"');
  const panel=html.indexOf('id="params-panel"');
  assert.ok(start>=0 && queue>start && panel>queue);
  assert.ok(html.indexOf('</main>')>panel);
  assert.match(html,/studio-v3\.css/);
  assert.match(html,/id="canvas-viewport"/);
  assert.match(html,/data-view="game-ui"/);
  const css=read('studio-v3.css');
  assert.match(css,/\.sidebar\.expanded/);
  assert.match(css,/\.model-provider-card/);
  assert.match(css,/#queue-panel\.expanded/);
  assert.match(css,/@media\(max-width:760px\)/);
});
test('one AI image-generation entrance auto-selects text/image generation by reference presence',() => {
  const code=read('script.js');
  const html=read('index.html');
  assert.match(html,/data-view="image-generate"/);
  assert.doesNotMatch(html,/data-view="text2img"|data-view="img2img"/);
  assert.match(code,/function activeCompositionMode/);
  assert.match(code,/getReferenceFiles\(\)\.length \? 'img2img' : 'text2img'/);
  assert.match(code,/function initImageClipboard/);
  assert.match(code,/addEventListener\('paste'/);
  assert.match(code,/dragenter/);
  assert.match(code,/appendReferenceImages/);
  assert.match(code,/multiple aria-label="添加参考图/);
  assert.match(code,/const referenceFiles = getReferenceFiles\(\)/);
  assert.match(code,/Promise\.all\(referenceFiles\.map/);
  assert.match(code,/id="reference-grid"/);
  assert.match(code,/input id="reference-input"[^>]*multiple/);
  assert.match(code,/targets: \[\{ providerId, model \}\]/);
  assert.match(code,/headers: \{ 'Content-Type': 'application\/json' \}/);
});
test('selection handles and undo redo save changes through the backend',() => {
  const code=read('studio-v2.js');
  assert.match(code,/canvas-selection-handle/);
  assert.match(code,/rememberGeometry/);
  assert.match(code,/stepHistory/);
  assert.match(code,/revealHistory/);
  assert.match(code,/method:'PATCH'/);
  assert.match(code,/window\.HamokiCanvas=\{refresh,findHistory,revealHistory,undo:/);
});
test('production server serves new stylesheet',() => {
  const code=read('server.js');
  assert.match(code,/studio-v3\\\.css/);
});

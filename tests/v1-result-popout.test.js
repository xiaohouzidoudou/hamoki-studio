'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(root,'script.js'),'utf8');
const view=fs.readFileSync(path.join(root,'studio-v2.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'assets','generated-result-card.css'),'utf8');
test('fresh V1 opens AI image generation rather than game UI tools',()=>{
  assert.match(script,/currentView:\s*'image-generate'/);
  assert.match(html,/class="nav-icon-btn active" data-view="image-generate"/);
  assert.doesNotMatch(html,/class="nav-icon-btn active" data-view="game-ui"/);
});
test('generated images stay plain nodes; result controls are separate floating siblings',()=>{
  assert.match(view,/card\.append\(image\)/);
  assert.match(view,/document\.body\.appendChild\(layer\)/);
  assert.match(view,/ensureCanvasFloatLayer\(document\.getElementById\('canvas-viewport'\)\)\.append\(toolbar,editor\)/);
  assert.match(view,/renderResultPopovers\(true\)/);
  assert.match(view,/const toolbar=parts\.querySelector\('\.generated-result-toolbar'\)/);
  assert.match(css,/\.result-floating-toolbar\s*,\s*\.result-floating-editor\{position:fixed/);
  assert.doesNotMatch(view,/card\.append\(generatedCard\(/);
});
test('floating tools appear only on selection and track canvas interactions',()=>{
  assert.match(view,/const node=projectNodes\.find\(n=>n\.id===selectedId && n\.kind==='generated'\)/);
  assert.match(view,/function focusNode\(id\)[\s\S]*?renderResultPopovers\(\);/);
  assert.match(view,/boardViewport\?\.addEventListener\('scroll',noteViewportMotion/);
  assert.match(view,/renderSourceLinks\(area\);scheduleResultPosition\(\)/);
  assert.match(view,/resultPopovers\?\.toolbar\?\.remove\(\)/);
});

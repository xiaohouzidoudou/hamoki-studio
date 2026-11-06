'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const dialog=read('assets/ai-outpaint-dialog.js');
const css=read('assets/ai-outpaint-dialog.css');
const trace=read('assets/global-border-trace.js');
const traceCss=read('assets/global-border-trace.css');

test('outpainting defaults to source model but permits explicit model override',()=>{
  assert.match(dialog,/modelSelect\.add\(new Option\('跟随原图/);
  assert.match(dialog,/const FOLLOW='__follow__',MANUAL='__manual__'/);
  assert.match(dialog,/const model=modelNow\(\)/);
  assert.match(dialog,/providerId:p\.id,model,ratio:/);
  assert.match(dialog,/\u002fapi\u002fmodels\?providerId=/);
  assert.doesNotMatch(dialog,/haop-provider|haop-resolution|haop-quality|haop-count|haop-ratio/);
});
test('percentage fields use custom green stepper and no native WebKit spinner',()=>{
  assert.match(dialog,/haop-step-up/);
  assert.match(dialog,/margins\[key\]\+delta/);
  assert.match(css,/input\[type="number"\]::-webkit-inner-spin-button/);
  assert.match(css,/\.haop-stepper/);
  assert.match(css,/\.haop-side-value:focus-within/);
});
test('modal immediately stops global border trace and hides underlying animation',()=>{
  assert.match(dialog,/HamokiGlobalBorderTrace\?\.pause\?\.\(\)/);
  assert.match(dialog,/HamokiGlobalBorderTrace\?\.resume\?\.\(\)/);
  assert.match(trace,/function pause\(\)/);
  assert.match(trace,/activate\(null\)/);
  assert.match(trace,/overlay\.style\.display = 'none'/);
  assert.ok(traceCss.includes('body:has(.modal-back:not(.hidden)'));
  assert.ok(traceCss.includes('body:has(.rie-backdrop'));
  assert.ok(!traceCss.includes('body:has([role="dialog"][aria-modal="true"])'));
  assert.match(traceCss,/\.canvas-border-trace > rect/);
});

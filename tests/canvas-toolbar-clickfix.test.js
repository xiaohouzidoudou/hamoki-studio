'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../assets/style.css'),'utf8');

test('canvas double-click is detected on stable pointer-up gesture rather than replaced image DOM',()=>{
 assert.match(app,/function openCanvasTap\(e,gesture,candidate\)/)
 assert.match(app,/canvasPreviewCandidate=e\.target\.closest\('\.node-image-box'\)/)
 assert.match(app,/if\(g\.type==='move-multi'\)openCanvasTap\(e,g,candidate\)/)
 assert.doesNotMatch(app,/im\.addEventListener\('click'/)
})
test('single-click only selects; double-click opens full original without a timer',()=>{
 assert.match(app,/previous\?\.id===n\.id&&now-previous\.at<=500/)
 assert.match(app,/openCanvasOriginal\(n\)/)
 assert.doesNotMatch(app,/canvasPreviewTimer/)
 assert.match(app,/function startNodeDrag\(e,n\)/)
})
test('compact toolbar places actions outside selected art with actual measured height',()=>{
 assert.match(app,/toolbar\.offsetHeight/);
 assert.match(app,/const above=y-height-gap,below=y\+n\.h\*cam\.scale\+gap/);
 assert.match(app,/selection-more-menu/);
 assert.match(app,/new Set\(\['图片对话','一键切图','查看原图'\]\)/);
 assert.match(css,/\.selection-toolbar:not\(\.bulk-selection-toolbar\)\{flex-wrap:nowrap/);
});

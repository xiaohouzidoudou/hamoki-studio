'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const js=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../assets/style.css'),'utf8');
const currentJs=fs.readFileSync(path.join(__dirname,'../assets/canvas-original-preview.js'),'utf8');
const currentCss=fs.readFileSync(path.join(__dirname,'../assets/canvas-original-preview.css'),'utf8');
test('single tap image opens original media, not the small thumbnail',()=>{
 assert.match(js,/function openCanvasOriginal\(n\)/);
 assert.match(js,/const original=nodeImage\(n\)/);
 assert.match(js,/canvasPreviewCandidate\.dragged/);
 assert.match(js,/g\.type==='move-multi'/);
});
test('full-screen modal has close, escape, backdrop and actual size',()=>{
 assert.match(html,/assets\/canvas-original-preview\.js\?v=/);
 assert.match(html,/assets\/canvas-original-preview\.css\?v=/);
 assert.match(currentJs,/dialog = element\('dialog', 'hm-original-preview'\)/);
 assert.match(currentJs,/dialog\.showModal\(\)/);
 assert.match(currentJs,/if \(dialog\?\.open\) dialog\.close\(\)/);
 assert.match(currentJs,/image\.naturalWidth && image\.naturalHeight/);
 assert.match(currentCss,/dialog\.hm-original-preview::backdrop/);
 assert.match(currentCss,/\.hm-original-preview \.hm-original-close/);
});
test('existing double-click detail and drag are preserved',()=>{
 assert.match(js,/function openCanvasTap\(e,gesture,candidate\)/);
 assert.match(js,/openViewer\(n\.historyId\)/);
 assert.match(js,/function startNodeDrag\(e,n\)/);
 assert.match(js,/pointerMove\(e\)/);
});

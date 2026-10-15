'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const js=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../assets/style.css'),'utf8');
test('single tap image opens original media, not the small thumbnail',()=>{
 assert.match(js,/function openCanvasOriginal\(n\)/);
 assert.match(js,/const original=nodeImage\(n\)/);
 assert.match(js,/canvasPreviewCandidate\.dragged/);
 assert.match(js,/g\.type==='move-multi'/);
});
test('full-screen modal has close, escape, backdrop and actual size',()=>{
 for(const id of ['canvasOriginalModal','canvasOriginalImage','canvasOriginalClose','canvasOriginalFit'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(js,/closeCanvasOriginal\(\)/);
 assert.match(js,/e\.key==='Escape'/);
 assert.match(css,/\.canvas-original-stage img\.actual-size/);
});
test('existing double-click detail and drag are preserved',()=>{
 assert.match(js,/card\.ondblclick=e=>\{e\.stopPropagation\(\);if\(h\)openViewer\(h\.id\)/);
 assert.match(js,/function startNodeDrag\(e,n\)/);
 assert.match(js,/pointerMove\(e\)/);
});

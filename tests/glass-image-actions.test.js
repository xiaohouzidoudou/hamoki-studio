'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const src=file=>fs.readFileSync(path.join(base,file),'utf8');
const studio=src('studio-v2.js');
const composer=src('assets/result-floating-composer.js');
const layer=src('assets/glass-ui-layer.js');
const index=src('index.html');
const server=src('server.js');

test('all image action menus use site-owned glass UI instead of native confirms',()=>{
  assert.match(index,/assets\/glass-ui-layer\.js\?v=/);
  assert.match(index,/assets\/glass-ui-layer\.css\?v=/);
  assert.match(layer,/dialog\.showModal\(\)/);
  assert.match(layer,/dialog\.addEventListener\('cancel'/);
  assert.match(layer,/function showMenu\(/);
  assert.match(studio,/addEventListener\('contextmenu'/);
  assert.match(studio,/label:'下载原图'/);
  assert.match(studio,/label:'从画布删除'/);
  assert.match(studio,/HamokiGlassUI\.confirm\(/);
});

test('fake HD and local outpainting are disabled, AI outpainting keeps the source image',()=>{
  assert.doesNotMatch(composer,/menuAction\('hd'/);
  assert.match(composer,/\['expand','扩图','outpaint'\]/);
  assert.doesNotMatch(composer,/menuAction\('expand'/);
  assert.match(composer,/function prepareAiOutpaint\(\)/);
  assert.match(composer,/if\(action==='expand'\)\{prepareAiOutpaint\(\);return;\}/);
  assert.match(composer,/includeSource:!!ctx\.nodeId/);
  assert.match(studio,/sourceId:hasCurrent\?h\.id:null/);
  assert.match(server,/if\(job\.sourceId\)/);
  assert.match(server,/media\.push\(fetchMedia\(original\.file\)\)/);
  assert.doesNotMatch(studio,/saveCanvasBlob\(node,blob,'高清 '/);
});

test('image references never replace the drafted prompt or append unwanted chips',()=>{
  assert.match(studio,/const preservedPrompt=document\.getElementById\('prompt-input'\)\?\.value/);
  assert.match(studio,/if\(mode!=='reference'\)\{/);
  assert.match(studio,/__addCanvasReference\(item,\{appendChip:false\}\)/);
  assert.match(studio,/参考图；提示词保持不变/);
  assert.doesNotMatch(composer,/canvasRefTop/);
  assert.doesNotMatch(composer,/poseTop/);
});

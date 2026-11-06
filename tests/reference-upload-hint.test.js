'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'script.js'),'utf8');
const css=fs.readFileSync(path.join(root,'studio-v4.css'),'utf8');

test('reference picker shows one concise message inside the upload zone',()=>{
  assert.match(js,/<span id="reference-file-name">最多 5 张；Ctrl\+V 可追加图片。<\/span>/);
  assert.doesNotMatch(js,/没有参考图即文生图/);
  assert.match(js,/entries\.length \? '继续添加参考图' : '最多 5 张；Ctrl\+V 可追加图片。'/);
  assert.doesNotMatch(js,/点击、多选或拖入图片|每行 3 张|reference-mode-indicator/);
  assert.match(js,/<div class="reference-dimensions" id="reference-dimensions" hidden><\/div>/);
});
test('reference count and multiple attachment behavior are preserved',()=>{
  assert.match(js,/<span class="reference-count" id="reference-count"/);
  assert.match(js,/id="reference-input" type="file"[^>]* multiple/);
  assert.match(js,/function renderReferenceGallery\(\)/);
  assert.match(js,/details\.hidden = entries\.length === 0/);
  assert.match(js,/entries\.length \+ '\/' \+ MAX_REFERENCE_IMAGES/);
});
test('helper text uses muted colors while keeping upload hint readable',()=>{
  assert.match(css,/\.params-panel \.upload-dropzone #reference-file-name\s*\{[^}]*white-space:normal/);
  assert.match(css,/\.params-panel \.upload-dropzone #reference-file-name\s*\{[^}]*overflow:visible/);
  assert.match(css,/\.params-panel \.upload-dropzone #reference-file-name\s*\{[^}]*color:#84919E/);
  assert.match(css,/\.params-panel #prompt-input::placeholder\s*\{[^}]*color:#798695/);
});

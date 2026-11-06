'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('multiple references have a three-column gallery, individual remove and 5-image cap',()=>{
 const js=read('script.js'),css=read('studio-v4.css');
 assert.match(js,/MAX_REFERENCE_IMAGES\s*=\s*5/);
 assert.match(js,/type="file"[^>]+multiple/);
 assert.match(js,/id="reference-grid"/);
 assert.match(js,/function appendReferenceImages\(files\)/);
 assert.match(js,/function removeReferenceImage\(id\)/);
 assert.match(js,/className = 'reference-thumb-remove'/);
 assert.match(js,/removeReferenceImage\(entry\.id\)/);
 assert.match(js,/URL\.revokeObjectURL/);
 assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(css,/\.reference-thumb-remove/);
});
test('all remaining references are submitted without changing text-generation fallback',()=>{
 const js=read('script.js');
 assert.match(js,/getReferenceFiles\(\)\.length \? 'img2img' : 'text2img'/);
 assert.match(js,/const referenceFiles = getReferenceFiles\(\)/);
 assert.match(js,/Promise\.all\(referenceFiles\.map/);
 assert.match(js,/references,\s*editMode: 'new'/);
 assert.match(js,/clearReferenceImages\(\)/);
 assert.match(js,/appendReferenceImages\(event\.dataTransfer\?\.files \|\| \[\]\)/);
 assert.match(js,/appendReferenceImages\(\[imageFile\]\)/);
});

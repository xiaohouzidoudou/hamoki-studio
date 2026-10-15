'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('a single canvas generated image can enter cutting through toolbar and context menu',()=>{
 const canvas=read('assets/app.js');
 assert.match(canvas,/function openSelectedImageCut\(/);
 assert.match(canvas,/selected\.length!==1/);
 assert.match(canvas,/hamoki:open-delivery/);
 assert.match(canvas,/一键切图/);
});
test('delivery entry carries single selected historyId and preselects matching image',()=>{
 const src=read('assets/game-ui-delivery.js');
 assert.match(src,/hamoki:open-delivery/);
 assert.match(src,/preferredImageId=typeof historyId/);
 assert.match(src,/src\.id===preferredImageId/);
 assert.match(src,/selected\.length===1/);
});
test('review workflow uses selectable thumbnails, retaining hidden historyId for quality API',()=>{
 const html=read('index.html'),workflow=read('assets/creative-workflow-v2.js');
 assert.match(html,/id="creativeQualityGallery"/);
 assert.match(html,/class="field hidden" id="creativeGeneratedSelect"/);
 assert.match(workflow,/creative-quality-card/);
 assert.match(workflow,/image\.src=h\.previewUrl\|\|h\.url/);
 assert.match(workflow,/\$\('creativeGeneratedSelect'\)\.value=h\.id/);
 assert.match(workflow,/projects\/'\+projectId\+'\/creative\/quality/);
});

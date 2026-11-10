'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const load=f=>fs.readFileSync(path.resolve(__dirname,'..',f),'utf8');
const toolbar=load('assets/result-floating-composer.js');
const outpaint=load('assets/ai-outpaint-dialog.js');
const html=load('index.html');
const css=load('assets/ai-outpaint-dialog.css');

test('outpaint is a visible primary action, not nested in the more menu',()=>{
 assert.match(toolbar,/\['edit','编辑','edit'\],\['expand','扩图','outpaint'\]/);
 assert.doesNotMatch(toolbar,/menuAction\('expand'/);
 assert.match(toolbar,/if\(action==='expand'\)\{prepareAiOutpaint\(\);return;\}/);
});
test('modal submits a real transparent-region mask and the padded source',()=>{
 assert.match(outpaint,/sourceCanvas\.toDataURL\('image\/png'\)/);
 assert.match(outpaint,/maskCanvas\.toDataURL\('image\/png'\)/);
 assert.match(outpaint,/maskContext\.fillRect\(rect\.x,rect\.y,rect\.w,rect\.h\)/);
 assert.match(outpaint,/mask,maskSourceImage/);
 assert.match(outpaint,/outpaintRect:/);
 assert.doesNotMatch(css,/object-fit:fill/);
});
test('planner is loaded before the modal script and all assets are cache-busted',()=>{
 assert.ok(html.indexOf('assets/ai-outpaint-plan.js')<html.indexOf('assets/ai-outpaint-dialog.js'));
 assert.match(html,/preserve-20261106/);
});

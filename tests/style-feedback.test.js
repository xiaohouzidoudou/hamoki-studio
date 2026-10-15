'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const memory=require('../lib/assistant-memory');
const upstream=require('../lib/creative-upstream');
const {styleOutput}=require('./fixtures/ai-asset-style.fixture');

test('Chinese directional feedback remains intact while assistant supplies bounded English visual terms',()=>{
 const input={action:'image',mode:'edit',reply:'',rule:'',edit:{
  target:'当前奖励框',change:'框太平了，增加立体层次和倒角，不要改颜色',
  preserve:'保持项目配色、按钮位置和其他画面不动',
  englishVisualTerms:'add subtle dimensional highlights and beveled edges, keep existing colors'
 }};
 const plan=memory.parsePlan(JSON.stringify(input));
 assert.equal(plan.action,'image');
 assert.equal(plan.mode,'edit');
 assert.equal(plan.edit.target,input.edit.target);
 const yaml=upstream.validateGuide(styleOutput).yaml;
 const guidance=upstream.styleFeedbackGuide(yaml,plan.edit);
 assert.match(guidance,/框太平了，增加立体层次和倒角，不要改颜色/);
 assert.match(guidance,/add subtle dimensional highlights and beveled edges/);
 assert.match(guidance,/已确认的 ai_asset 官方风格术语/);
 assert.match(guidance,/chunky rectangular UI panels/);
 assert.match(guidance,/不更新 Style DNA/);
 assert.doesNotMatch(guidance,/\$\{input/);
});
test('only image edit gets transient edit instructions, never global memory or new-image request',()=>{
 const create=memory.parsePlan(JSON.stringify({action:'image',mode:'new',edit:{change:'swap to futuristic anime'}}));
 assert.equal(create.edit,null);
 const chat=memory.parsePlan(JSON.stringify({action:'chat',mode:'edit',edit:{change:'change everything'}}));
 assert.equal(chat.edit,null);
 const imageEdit=memory.parsePlan(JSON.stringify({action:'image',mode:'edit',edit:{change:'只让按钮薄一点',englishVisualTerms:'make the existing button thinner'}}));
 assert.equal(imageEdit.edit.change,'只让按钮薄一点');
 const invalid=upstream.styleFeedbackGuide('older freeform style',imageEdit.edit);
 assert.match(invalid,/只让按钮薄一点/);
 assert.match(invalid,/make the existing button thinner/);
 assert.match(invalid,/原图及保存的 Style DNA/);
 assert.equal(upstream.styleFeedbackGuide('older freeform style',null),'');
});
test('guidance refuses untrusted shape objects and keeps the original locked style data',()=>{
 const guide=upstream.validateGuide(styleOutput).yaml;
 const before=guide;
 assert.doesNotMatch(upstream.styleFeedbackGuide(guide,{change:1234}),/1234/);
 const terms=upstream.styleFeedbackGuide(guide,{target:'边框',change:'只加一点高光'});
 assert.match(terms,/只加一点高光/);
 assert.equal(guide,before);
});

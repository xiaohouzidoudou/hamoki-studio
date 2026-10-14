'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const a=require('../lib/creative-upstream');
const {styleOutput}=require('./fixtures/ai-asset-style.fixture');
const base=path.join(__dirname,'..','vendor');
test('pinned upstream ai_asset and game-ui workflow are vendored with original legal notices',()=>{
 assert.match(fs.readFileSync(path.join(base,'ai_asset','LICENSE'),'utf8'),/Copyright \(c\) 2026 Bao Tran/);
 assert.match(fs.readFileSync(path.join(base,'game-ui-design-workflow','LICENSE'),'utf8'),/MIT License/);
 assert.match(fs.readFileSync(path.join(base,'ai_asset','studio_primer.md'),'utf8'),/TOOLKIT v2\.3\.0/);
 assert.equal(a.version.ai_asset,'006a796da817d742b0308a9326c9254a8e875b7b');
 assert.equal(a.version.game_ui_workflow,'1ec604638dd1a27198576206eb3e47632725a078');
});
test('STYLE actually loads official §3 analyzer and upstream schema rather than a local imitation',()=>{
 const prompt=a.stylePrompt('游戏周年庆');
 assert.match(prompt,/OUTPUT SKELETON/);
 assert.match(prompt,/confidence/);
 assert.match(prompt,/ui_panel_geometry/);
 assert.match(prompt,/color_map/);
 assert.match(prompt,/STYLE\/ANALYZER|STYLE \/ ANALYZER/);
 assert.ok(prompt.length>20000);
});
test('STYLE parser enforces official typed enum, HEX and scoped color rules',()=>{
 const guide=a.validateGuide(styleOutput);
 assert.match(guide.yaml,/version: 1.0/);
 assert.equal(guide.parsed.style.rendering,'semi_painted');
 assert.match(guide.review,/CONSISTENCY/);
 assert.throws(()=>a.validateGuide(styleOutput.replace('semi_painted','invented_render_style')),/official schema|官方|枚举/i);
 assert.throws(()=>a.validateGuide(styleOutput.replace('primary: ["#182E46"]','primary: [not-a-color]')),/palette|HEX|颜色/i);
 assert.throws(()=>a.validateGuide(styleOutput.replace('  rendering: 0.85','  something_fake: 0.85')),/official schema|官方/i);
});
test('ASSET synthesizer uses upstream §4, page skill, asset/layout schemas and actual style token dictionary',()=>{
 const guide=a.validateGuide(styleOutput);
 const phrases=a.tokenPhrases(guide.yaml);
 assert.ok(phrases.some(s=>s.includes('semi-painted render')));
 assert.ok(phrases.some(s=>s.includes('polished metallic surface')));
 const prompt=a.directorPrompt('周年庆签到 UI',guide.yaml,'布局原型与奖励格','需要一张正式页面');
 assert.match(prompt,/SYNTHESIZER/);
 assert.match(prompt,/ASSET:/);
 assert.match(prompt,/panel/);
 assert.match(prompt,/game-ui-page-generator/);
 assert.match(prompt,/semi-painted render/);
 assert.match(prompt,/周年庆签到/);
});
test('page discovery loads original upstream workflow and extension skills rather than inventing missing pages',()=>{
 const prompt=a.screenPrompt('Word pages: 登录奖励、4 倍钻石');
 assert.match(prompt,/game-ui-extension/);
 assert.match(prompt,/game-ui-workflow/);
 assert.match(prompt,/Word pages: 登录奖励/);
 assert.match(prompt,/不允许新增不存在的页|不.*补造.*不存在/);
 assert.ok(prompt.length<2800,'screen inventory must not include full artwork/slicing workflow');
 assert.doesNotMatch(prompt,/### 8\. Sprite-sheet splitting|### 9\. Atlas and engine handoff/);
});
test('CHECK role uses original §5 and quality gate of upstream UI page skill',()=>{
 const prompt=a.qualityPrompt('奖励活动','风格','界面原型');
 assert.match(prompt,/CHECKER/);
 assert.match(prompt,/REVIEW NOTES|CHECK/);
 assert.match(prompt,/game UI|游戏 UI|页面/);
});

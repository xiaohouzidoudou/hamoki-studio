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

test('two original game UI skills are included with their own licenses',()=>{
 const ux=fs.readFileSync(path.join(base,'game-ui-ux/SKILL.md'),'utf8');
 const three=fs.readFileSync(path.join(base,'threejs-game-ui-designer/SKILL.md'),'utf8');
 assert.match(ux,/anchors \+ containers/);
 assert.match(three,/premium Three\.js game UI/i);
 assert.match(fs.readFileSync(path.join(base,'game-ui-ux/LICENSE'),'utf8'),/Apache License/);
 assert.match(fs.readFileSync(path.join(base,'threejs-game-ui-designer/LICENSE'),'utf8'),/MIT License/);
 assert.equal(a.version.game_ui_ux,'0a70cfc64672d512c5b5b6006b5dcb5cf90dbdbd');
 assert.equal(a.version.threejs_game_ui_designer,'8286774b22a2566bf894dbc825825c16921866af');
});
test('layout respects safe areas, text fit, and original prototype boundaries',()=>{
 const p=a.layoutPrompt('签到奖励格和领取按钮','保留原型控件');
 assert.match(p,/Safe-area math/);
 assert.match(p,/Localization-ready layout/);
 assert.match(p,/Responsive constraints/);
 assert.match(p,/原型图仅提供功能元件和布局，不提供美术风格/);
 assert.ok(p.length<18000);
});
test('art direction follows premium game UI hierarchy without changing Style DNA',()=>{
 const p=a.directorPrompt('周年庆签到 UI',styleOutput,'原型奖励格','保持游戏原有画风');
 assert.match(p,/SYNTHESIZER/);
 assert.match(p,/Hierarchy and states/);
 assert.match(p,/Menus and overlays/);
 assert.match(p,/Style and cohesion/);
 assert.match(p,/严格服从已分析的游戏 Style DNA/);
 assert.match(p,/保持游戏原有画风/);
 assert.ok(p.length<76000);
});
test('QA evaluates visually observed issues, not imaginary game-engine code',()=>{
 const p=a.qualityPrompt('签到','风格指南','原型');
 assert.match(p,/CHECKER/);
 assert.match(p,/Recurring failures/);
 assert.match(p,/Accessibility/);
 assert.match(p,/不得声称已测试不可见的按钮事件/);
 assert.ok(p.length<38000);
});

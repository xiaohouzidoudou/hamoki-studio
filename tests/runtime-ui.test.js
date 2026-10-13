'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),js=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8'),server=fs.readFileSync(path.join(__dirname,'../workspace.js'),'utf8'),css=fs.readFileSync(path.join(__dirname,'../assets/style.css'),'utf8');
test('settings keeps only API fields, and runtime text/vision controls exist outside settings',()=>{
 assert.doesNotMatch(html,/id="capabilityRoutePanel"|id="saveBindings"|id="capabilityBindings"/);
 assert.match(html,/id="settingsModal"/);assert.match(html,/<h2>中转站管理<\/h2>/);
 for(const id of ['textProviderSelect','textModelInput','textFetchModels','visionProviderSelect','visionModelInput','visionFetchModels','skillsToggle','skillsMenu']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.ok(html.indexOf('id="visionProviderSelect"')>html.indexOf('id="reverseModal"'));
 assert.ok(html.indexOf('id="textProviderSelect"')<html.indexOf('id="settingsModal"'));
});
test('skills menu defaults hidden and preserves all four original actions',()=>{
 assert.match(html,/<div class="skill-grid hidden" id="skillsMenu">/);
 for(const type of ['views','style','bg','detail'])assert.match(html,new RegExp('data-skill="'+type+'"'));
 assert.match(js,/function applySkill\(s\)\{closeSkillsMenu\(\)/);
 assert.match(css,/\.studio-skill-cards\.hidden,.skill-grid\.hidden\{display:none!important\}/);
});
test('text/vision choice is sent with each request and no default-route UI saving remains',()=>{
 assert.match(js,/providerId:binding.providerId,model:binding.model/);
 assert.match(js,/binding=runtimeSelection\('text'\)/);
 assert.match(js,/const route=runtimeSelection\('vision'\)/);
 assert.match(js,/providerId:route.providerId,image:reverseImage/);
 assert.match(server,/provider\(b\.providerId\|\|state\.activeId\),'text'/);
 assert.doesNotMatch(js,/\\$\\('saveBindings'\\)\.onclick/);
 assert.match(js,/function setComposerMode\(mode\)/);
 assert.match(js,/\$\('textRouteBox'\)\.classList\.toggle\('hidden',composerMode!=='text'\)/);
});

test('legacy global binding behavior fully removed from client and server',()=>{
 for(const token of ['abilityBindings','renderCapabilityBindings','saveCapabilityBindings','routeBinding('])assert.equal(js.includes(token),false,token);
 assert.equal(server.includes('getBinding('),false);
 assert.equal(server.includes('publicBindings('),false);
 assert.equal(server.includes("route==='/api/bindings'"),false);
 assert.match(server,/delete state\.bindings;encrypt\(state\)/);
});

test('provider settings have one model source and model choice is optional on save',()=>{
 for(const field of ['id="pfImage"','id="pfVision"','legacyModelFields'])assert.doesNotMatch(html,new RegExp(field));
 assert.doesNotMatch(js,/bindModelPickers|MODEL_PICKER_FIELDS/);
 assert.doesNotMatch(js,/请填写图片生成模型 ID|请填写图片反推模型 ID/);
 assert.match(js,/建议模型（可选；操作台实际选择优先）/);
 assert.match(server,/imageModel:b\.imageModel\?assertModel\(b\.imageModel\):''/);
 assert.match(server,/visionModel:b\.visionModel\?assertModel\(b\.visionModel\):''/);
 assert.doesNotMatch(server,/GET'&&pm\[2\]==='check'/);
 assert.doesNotMatch(server,/route==='\/api\/bindings'/);
});

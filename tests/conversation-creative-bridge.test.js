'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
const flow=fs.readFileSync(path.join(root,'assets/creative-workflow-v2.js'),'utf8');
const server=fs.readFileSync(path.join(root,'workspace.js'),'utf8');
test('chat creation delegates to existing Word prototype and Style DNA workflow, not a second planner',()=>{
 assert.match(app,/window\.HamokiCreative\.prepareFromChat\(prompt\)/);
 assert.match(flow,/window\.HamokiCreative=\{prepareFromChat\}/);
 assert.ok(flow.includes("creative/auto"),'chat calls server coordinator');
 assert.ok(flow.includes('if(!proto?.nodeId)return'),'prototype must be real');
 assert.ok(server.includes('async function creativeAutoExecute('));
 assert.ok(server.includes('await creativeAnalyze(p,'));
 assert.ok(server.includes('await creativeQuality(p,'));
 assert.ok(server.includes("creativeAutoStart(p,await readJSON(req))"));
  assert.match(flow,/role:'style'/);
 assert.match(flow,/role:'shape'/);
 assert.match(server,/creativePagePicture\(workflow,currentPage\)/);
});
test('simple mode hides manual feedback tools while conversation can target last image',()=>{
 const css=fs.readFileSync(path.join(root,'assets/style.css'),'utf8');
 assert.match(css,/\.simple-studio \.memory-actions #rememberRuleBtn/);
 assert.match(app,/reverse\(\)\.find\(x=>x\.kind==='generated'\)/);
 assert.match(app,/renderMemoryContext\(\)/);
});

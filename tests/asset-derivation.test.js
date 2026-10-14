'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const asset=require('../lib/asset-derivation');
const {styleOutput}=require('./fixtures/ai-asset-style.fixture');
const entries=[
 {kind:'screen',description:'主界面入口'},{kind:'kit',description:'按钮与面板'},
 {kind:'icons',description:'金币宝箱道具图标'},{kind:'background',description:'活动背景'},
 {kind:'character',description:'游戏角色立绘'}
];
test('one reference drives five distinct original ai_asset branch prompts',()=>{
 const prompt=asset.buildPlanPrompt(entries,styleOutput);
 for(const t of ['asset_spec','background_spec','character_spec','object_spec'])assert.ok(prompt.includes(t+'.schema.yaml'),t);
 for(const t of entries)assert.ok(prompt.includes('"kind":"'+t.kind+'"'));
 assert.match(prompt,/ai_asset/);
 assert.match(prompt,/Style DNA/);
 assert.ok(prompt.length<58000,'source rules must fit existing 58K model prompt guard');
});
test('draft parser checks count, type, index and complete output',()=>{
 const texts=entries.map((x,i)=>({index:i+1,kind:x.kind,prompt:'设计游戏界面符合统一 Style DNA 规则。'.repeat(9)}));
 const ok=asset.parsePlan(JSON.stringify({items:texts}),entries);
 assert.equal(ok.length,5);
 assert.deepEqual(ok.map(x=>x.ratio),['9:16','3:2','1:1','9:16','2:3']);
 assert.throws(()=>asset.parsePlan('{}',entries),/数量不匹配/);
 assert.throws(()=>asset.parsePlan(JSON.stringify({items:[{...texts[0],kind:'icons'},...texts.slice(1)]}),entries),/格式有误/);
 assert.throws(()=>asset.validateItems([...entries,...entries]),/1 至 8/);
});
test('paid calls require explicit confirmation and batches validate before enqueuing',()=>{
 const server=fs.readFileSync(path.join(__dirname,'..','workspace.js'),'utf8');
 assert.match(server,/action==='style'&&req.method==='POST'/);
 assert.match(server,/action==='prepare'&&req.method==='POST'/);
 assert.match(server,/action==='submit'&&req.method==='POST'/);
 assert.match(server,/body.confirmCost!==true/);
 assert.match(server,/const valid=drafts.map/);
 assert.match(server,/jobs.unshift\(\.\.\.created\);saveJobs\(\)/);
 assert.match(server,/draft.status!=='draft'/);
});

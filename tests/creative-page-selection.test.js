'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../assets/creative-workflow-v2.js'),'utf8');
const match=src.match(/const specific=p=>([^;]+);/);
assert.ok(match,'real browser page matching predicate is present');
const specific=new Function('p','return '+match[1]);
test('generic Word headings do not compete with named UI pages',()=>{
 const pages=[{name:'签到'},{name:'UI'},{name:'周年庆入口'},{name:'页面'}];
 const text='按原型制作周年庆签到UI，保持所有奖励';
 const matched=pages.filter(p=>specific(p)&&text.includes(p.name));
 assert.deepEqual(matched.map(p=>p.name),['签到']);
 assert.equal(specific({name:'周年庆入口'}),true);
 assert.equal(specific({name:'UI'}),false);
});

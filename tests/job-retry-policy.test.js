'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {retryPlan}=require('../lib/job-retry-policy');
const job={id:'root',status:'interrupted',attempts:1,startedAt:'2026-10-16T01:00:00Z',providerId:'p',model:'m',upstreamId:'remote-001'};
test('Grsai with saved original ID resumes without new upstream generation',()=>{
 const p=retryPlan(job,[],{providerId:'p',model:'m',mode:'grsai'});
 assert.equal(p.resumeOriginal,true);assert.equal(p.upstreamId,'remote-001');
});
test('interrupted image task cannot silently create a second paid task',()=>{
 assert.throws(()=>retryPlan(job,[],{providerId:'p',model:'m',mode:'openai'}),/可能已计费/);
 const r=retryPlan(job,[],{providerId:'p',model:'m',mode:'openai',acknowledgePotentialCharge:true});
 assert.equal(r.resumeOriginal,false);assert.equal(r.upstreamId,null);
});
test('switching Grsai model requires explicit acknowledgement',()=>{
 assert.throws(()=>retryPlan(job,[],{providerId:'p',model:'other',mode:'grsai'}),/切换模型/);
 const p=retryPlan(job,[],{providerId:'p',model:'other',mode:'grsai',acknowledgePotentialCharge:true});
 assert.equal(p.upstreamId,null);
});
test('retrying the same older job a second time is rejected',()=>{
 assert.throws(()=>retryPlan(job,[{id:'newer',retryOf:'root',status:'failed'}],{providerId:'p',model:'m',mode:'grsai'}),/已有后续尝试/);
});
test('queued, running, successful jobs cannot be restarted',()=>{
 for(const status of ['queued','running','done'])assert.throws(()=>retryPlan({...job,status},[],{providerId:'p',model:'m',mode:'grsai'}));
});
test('failure before upstream start can retry without charged acknowledgement',()=>{
 const j={id:'a',status:'failed',attempts:0,providerId:'p',model:'m'};
 assert.equal(retryPlan(j,[],{providerId:'p',model:'m',mode:'openai'}).resumeOriginal,false);
});

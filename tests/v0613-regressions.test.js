'use strict';
const {test}=require('node:test');
const a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const front=read('assets/app.js'),back=read('workspace.js'),html=read('index.html'),gateway=read('gateway.js');
test('reference ratio conversion and validation',()=>{
 const start=front.indexOf('function nearestSupportedAspectRatio(');
 const end=front.indexOf('async function referenceRatioValue()',start);
 a.ok(start>=0&&end>start);
 const fn=vm.runInNewContext(front.slice(start,end)+';nearestSupportedAspectRatio');
 a.equal(fn(1200,1600),'3:4');a.equal(fn(1920,1080),'16:9');
 a.equal(fn(4000,3000),'4:3');a.equal(fn(1024,1024),'1:1');
 a.throws(()=>fn(0,100),/尺寸无效/);
});
test('generation quantity options agree with server',()=>{
 const start=html.indexOf('<select id="amount">');
 const end=html.indexOf('</select>',start);
 a.ok(start>0&&end>start);
 const options=[...html.slice(start,end).matchAll(/<option[^>]*>([0-9]+)<\/option>/g)].map(m=>Number(m[1]));
 a.deepEqual(options,[1,2,4,6,8]);
 a.ok(back.includes('count>8'));
 a.ok(back.includes('targets.length>2||targets.length*count>12'));
 a.ok(front.includes('compareSelection.size>2'));
});
test('reference cap checks uploads plus canvas references',()=>{
 a.ok(front.includes('else if(referenceInputs.length+referenceNodeRoles.length>=8)'));
 a.ok(front.includes('if(referenceInputs.length+referenceNodeRoles.length>=8)'));
 a.ok(back.includes('refs.length+referenceNodes.length>8'));
});
test('editing requests use dedicated provider on validation and execution',()=>{
 a.ok(front.includes("checkProvider(sourceId||maskData?'edit':'image')"));
 a.ok(front.includes('config?.inheritApiKey===false?!!config.hasKey'));
 a.ok(back.includes('return {capability,prompt,editInstruction'));
 a.ok(back.includes('effectiveProvider(provider(t.providerId),valid.capability)'));
 a.ok(back.includes("capability:b.capability||'image'"));
});
test('paused queue label and elapsed timer avoid misleading generation',()=>{
 a.ok(front.includes("if(paused){clock.textContent='队列已暂停"));
 a.ok(front.includes("textContent=paused?'队列已暂停"));
});
test('version and pending jobs recovery checks',()=>{
 a.equal((gateway.match(/version:'0.6.27'/g)||[]).length,3);
 a.ok(gateway.includes('restoreQueuedJobsOnStartup()'));
 a.ok(back.includes("!paused&&jobs.some(j=>j.status==='queued')"));
});

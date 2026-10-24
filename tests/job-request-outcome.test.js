const test=require('node:test');
const assert=require('node:assert/strict');
const {requestOutcome,failedOutcome,resetQueuedRetryEvidence}=require('../lib/job-request-outcome');
test('落盘前只清理未启动重试的旧证据，不改源任务或运行尝试',()=>{
 const original={id:'original',status:'failed',attempts:1,requestOutcome:'http_rejected',upstreamHttpStatus:400};
 const retry={...original,id:'retry',retryOf:'original',status:'queued',attempts:0,startedAt:null};
 const active={...retry,id:'active',status:'running',attempts:1,startedAt:'now'};
 const resume={...retry,id:'resume',upstreamId:'accepted'};
 resetQueuedRetryEvidence([original,retry,active,resume]);
 assert.equal(original.upstreamHttpStatus,400);assert.equal(active.upstreamHttpStatus,400);
 assert.equal(retry.upstreamHttpStatus,null);assert.equal(requestOutcome(retry),'not_sent');
 assert.equal(requestOutcome(resume),'unknown');
});
test('区分未调用、明确 HTTP 拒绝与未知，不把网关超时当作免费失败',()=>{
 assert.equal(requestOutcome({status:'queued',attempts:0}),'not_sent');
 assert.equal(requestOutcome({status:'cancelled',attempts:1}),'unknown');
 assert.equal(requestOutcome({status:'failed'}),'unknown','旧任务缺少证据时不能推断未调用');
 assert.equal(failedOutcome({},Error('local validation')),'not_sent');
 assert.equal(failedOutcome({upstreamAttemptedAt:'now'},{upstreamStatus:403}),'http_rejected');
 for(const upstreamStatus of [408,500,502,503,504])assert.equal(failedOutcome({upstreamAttemptedAt:'now'},{upstreamStatus}),'unknown');
 assert.equal(failedOutcome({upstreamAttemptedAt:'now',upstreamId:'accepted'},{upstreamStatus:404}),'unknown','已接受的异步任务查询失败不能认定提交被拒');
 assert.equal(failedOutcome({requestOutcome:'result_received'},Error('disk full')),'result_received');
 assert.equal(requestOutcome({status:'interrupted',requestOutcome:'unknown'}),'unknown');
});
test('用户提示不把 HTTP 拒绝或取消等同退款，并保留本地保存失败提示',async()=>{
 const {jobOutcomeNotice}=await import('../cowart/src/lib/jobOutcome.js');
 assert.match(jobOutcomeNotice({requestOutcome:'http_rejected',upstreamHttpStatus:429}),/429.*不等于退款/);
 assert.match(jobOutcomeNotice({requestOutcome:'unknown'}),/不能保证.*退款/);
 assert.match(jobOutcomeNotice({requestOutcome:'not_sent'}),/不包含.*文字或视觉/);
 assert.match(jobOutcomeNotice({requestOutcome:'result_received',status:'failed'}),/保存未完成/);
});

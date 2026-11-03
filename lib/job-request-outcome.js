'use strict';
const REJECTED=new Set([400,401,403,404,405,409,413,415,422,429]);
function requestOutcome(job){
 if(job.status==='done'||job.requestOutcome==='result_received')return 'result_received';
 if(job.upstreamId)return 'unknown';
 if(['not_sent','http_rejected','unknown'].includes(job.requestOutcome))return job.requestOutcome;
 if(!job.startedAt&&!job.upstreamAttemptedAt&&!job.attempts&&['queued','cancelled'].includes(job.status))return 'not_sent';
 return 'unknown';
}
function failedOutcome(job,error){
 if(job.requestOutcome==='result_received')return 'result_received';
 if(job.upstreamId)return 'unknown';
 if(!job.upstreamAttemptedAt)return 'not_sent';
 return REJECTED.has(error?.upstreamStatus)?'http_rejected':'unknown';
}
// Retry copies may come from an older process/version. Normalize only fresh,
// unstarted attempts before persistence, never the source job or active work.
function resetQueuedRetryEvidence(jobs){
 for(const job of jobs)if(job.retryOf&&job.status==='queued'&&!job.startedAt&&job.attempts===0){
  job.requestOutcome=null;job.upstreamHttpStatus=null;job.upstreamAttemptedAt=null;
 }
}
module.exports={requestOutcome,failedOutcome,resetQueuedRetryEvidence};

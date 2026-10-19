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
module.exports={requestOutcome,failedOutcome};

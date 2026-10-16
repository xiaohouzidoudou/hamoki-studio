'use strict';
function retryPlan(job, allJobs, choice={}){
 if(!job||!['failed','cancelled','interrupted'].includes(job.status))throw Object.assign(Error('当前任务不支持重新提交'),{status:409});
 if(allJobs.some(other=>other.retryOf===job.id))throw Object.assign(Error('此任务已有后续尝试，请打开最新任务，不能重复重试旧任务'),{status:409});
 const sameRoute=choice.providerId===job.providerId&&choice.model===job.model;
 const resumeOriginal=choice.mode==='grsai'&&sameRoute&&!!job.upstreamId;
 if(job.upstreamId&&choice.mode==='grsai'&&!sameRoute&&!choice.acknowledgePotentialCharge){
  throw Object.assign(Error('原上游任务仍可查询；切换模型会新建可能重复扣费的任务，请确认原任务后再操作'),{status:409});
 }
 const chargedPossibly=!!(job.startedAt||job.attempts>0||job.upstreamId||['interrupted','cancelled'].includes(job.status));
 if(!resumeOriginal&&chargedPossibly&&choice.acknowledgePotentialCharge!==true){
  throw Object.assign(Error('上游可能已计费，须先检查记录并明确确认再次付费后才可重新提交'),{status:409});
 }
 return {resumeOriginal,upstreamId:resumeOriginal?job.upstreamId:null};
}
module.exports={retryPlan};

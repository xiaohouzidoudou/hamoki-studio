'use strict';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function normalizeCowartJob(value,requestId){
 if(value===undefined)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||!uuid.test(String(requestId||'')))throw Error('Cowart 任务需要有效的请求编号');
 if(typeof value.pageId!=='string'||!/^page:[a-zA-Z0-9_-]{1,128}$/.test(value.pageId))throw Error('Cowart 页面编号无效');
 if(value.anchorId!=null&&(typeof value.anchorId!=='string'||!/^shape:[a-zA-Z0-9_-]{1,128}$/.test(value.anchorId)))throw Error('Cowart 图片锚点无效');
 return {version:1,requestId,pageId:value.pageId,anchorId:value.anchorId||null,acknowledgedAt:null};
}
function pendingCowartJobs(jobs,projectId){
 return jobs.filter(job=>job.projectId===projectId&&job.cowart&&!job.cowart.acknowledgedAt);
}
function acknowledgeCowartSnapshot(jobs,projectId,snapshot,now){
 const saved=new Set(Object.values(snapshot?.store||{}).filter(record=>record.typeName==='shape'&&record.meta?.studioProjectId===projectId).map(record=>record.meta?.studioHistoryId));
 let changed=false;
 for(const job of pendingCowartJobs(jobs,projectId)){
  if(job.status==='done'&&job.resultId&&saved.has(job.resultId)){
   job.cowart.acknowledgedAt=now;changed=true;
  }
 }
 return changed;
}
module.exports={normalizeCowartJob,pendingCowartJobs,acknowledgeCowartSnapshot};

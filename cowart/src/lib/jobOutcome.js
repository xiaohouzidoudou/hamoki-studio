export function jobOutcomeNotice(job) {
  if (!job) return ''
  if (job.requestOutcome === 'not_sent') return '本任务尚未调用图片上游；这不包含此前可能发生的文字或视觉分析费用。'
  if (job.requestOutcome === 'http_rejected') return '图片上游返回 HTTP ' + (job.upstreamHttpStatus || '拒绝') + '。请求被拒绝不等于退款，费用请核对中转站记录。'
  if (job.requestOutcome === 'result_received') return job.status === 'done' ? '图片结果已保存。' : '上游已返回图片，但本地保存未完成，可能已经计费，请先核对任务记录。'
  return '上游处理和收费结果尚未确认；取消只停止本地等待，不能保证上游停止或退款。'
}

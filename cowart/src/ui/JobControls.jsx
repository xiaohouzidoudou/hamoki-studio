import { useEffect, useState } from 'react'
import { studioJSON } from '../lib/studioBridge.js'
import { jobOutcomeNotice } from '../lib/jobOutcome.js'

export default function JobControls({ jobId, phase, job, onBusyChange, onRefresh }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (job?.status === 'cancelled') setNotice('服务器已记录取消。' + jobOutcomeNotice(job))
    if (job?.status === 'done') setNotice('原任务已经完成，请以保存的图片结果为准。')
  }, [job?.status, job?.requestOutcome])
  const canCancel = ['queued', 'running', 'interrupted', 'uncertain'].includes(job?.status || phase)
  async function cancel() {
    if (busy || !window.confirm('取消会停止本地等待。上游可能仍在处理或已计费，不能保证退款。确认取消此任务？')) return
    setBusy(true); onBusyChange(true); setNotice('正在请求取消原任务…')
    try {
      const response = await studioJSON('/api/jobs/' + encodeURIComponent(jobId) + '/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      })
      if (response.job?.id !== jobId || response.job.status !== 'cancelled') throw new Error('取消结果尚未确认')
      setNotice('服务器已记录取消。' + jobOutcomeNotice(response.job))
    } catch (error) {
      setNotice('取消未确认：' + error.message + '。正在查询原任务，请勿重新提交生图。')
    } finally {
      setBusy(false); onBusyChange(false); onRefresh()
    }
  }
  return <div className="hamoki-job-controls" aria-live="polite">
    {job && !notice && <p className="hamoki-studio-note">{jobOutcomeNotice(job)}</p>}
    {canCancel && <button className="hamoki-studio-next" type="button" disabled={busy} onClick={cancel}>
      {busy ? '正在取消…' : '取消此任务'}
    </button>}
    {notice && <p className="hamoki-studio-message">{notice}</p>}
  </div>
}

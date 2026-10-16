import { useEffect, useRef, useState } from 'react'
import { buildImageShapeRecords } from '../lib/placement.js'
import { exportSelectionToDataUrl } from '../lib/selectionExport.js'
import { getStudioContext, studioJSON } from '../lib/studioBridge.js'
import { importLegacyStudioNodes } from '../lib/legacyImport.js'

const RATIOS = [[1, 1], [3, 2], [2, 3], [16, 9], [9, 16], [4, 3], [3, 4]]
const RATIO_NAMES = RATIOS.map(([a, b]) => a + ':' + b)

function ratioForSelection(editor) {
  const shape = editor?.getSelectedShapes()?.[0]
  const w = Number(shape?.props?.w), h = Number(shape?.props?.h)
  if (!(w > 0 && h > 0)) return '1:1'
  return RATIO_NAMES.reduce((best, ratio) => {
    const [a, b] = ratio.split(':').map(Number)
    const [c, d] = best.split(':').map(Number)
    return Math.abs(a / b - w / h) < Math.abs(c / d - w / h) ? ratio : best
  }, '1:1')
}
function imageDimensions(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth || 1024, height: image.naturalHeight || 1024 })
    image.onerror = () => reject(new Error('生成成功，但无法读取图片；请在 Studio 历史记录中查看'))
    image.src = url
  })
}
function insertStudioResult(editor, image, anchorId, ratio) {
  if (!editor) throw new Error('画布尚未就绪，图片保留在 Studio 历史记录中')
  const snapshot = editor.store.getStoreSnapshot()
  if (Object.values(snapshot.store).some((record) => record.typeName === 'shape' && record.meta?.studioHistoryId === image.id)) return false
  const anchor = anchorId ? editor.getShape(anchorId) : null
  const pageId = editor.getCurrentPageId()
  const [rx, ry] = ratio.split(':').map(Number)
  const displayWidth = anchor?.props?.w || 512
  const displayHeight = anchor?.props?.h || Math.round(displayWidth * ry / rx)
  const records = buildImageShapeRecords({
    store: snapshot.store, pageId, parentId: pageId, anchorShapeId: anchor?.id,
    anchorShape: anchor, imageSize: image.dimensions, displayWidth, displayHeight,
    matchAnchor: false, dataUrl: image.url,
    mimeType: /\.webp(?:$|\?)/.test(image.url) ? 'image/webp' : /\.jpe?g(?:$|\?)/.test(image.url) ? 'image/jpeg' : 'image/png',
    altText: 'Hamoki Studio · ' + (image.prompt || '生成图片'),
    shapeMeta: { studioHistoryId: image.id, studioProjectId: image.projectId, studioOrigin: 'image-job' }
  })
  // Server-owned same-origin media URL; do not embed large base64 images in the canvas snapshot.
  records.assetRecord.props.fileSize = 0
  records.assetRecord.props.name = 'hamoki-' + image.id + '.png'
  editor.store.put([records.assetRecord, records.shapeRecord])
  editor.select(records.shapeId)
  return true
}

export default function StudioPanel({ open, onClose, getEditor }) {
  const [context, setContext] = useState(null)
  const [providers, setProviders] = useState([])
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState('1:1')
  const [resolution, setResolution] = useState('1K')
  const [jobId, setJobId] = useState(null)
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importNotice, setImportNotice] = useState('')
  const [message, setMessage] = useState('')
  const active = useRef(null)
  const jobIdRef = useRef(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.all([getStudioContext(), studioJSON('/api/providers')])
      .then(([c, p]) => {
        if (cancelled) return
        setContext(c)
        setProviders(p.providers || [])
        setProviderId((old) => old || p.activeId || p.providers?.[0]?.id || '')
      })
      .catch((e) => { if (!cancelled) setError(e.message) })
    const editor = getEditor()
    if (editor) setRatio(ratioForSelection(editor))
    return () => { cancelled = true }
  }, [open, getEditor])

  const provider = providers.find(p => p.id === providerId)
  const candidates = Array.from(new Set([
    provider?.capabilities?.image?.defaultModel,
    ...(provider?.capabilities?.image?.models || []),
    provider?.imageModel
  ].filter(Boolean)))

  useEffect(() => {
    if (!provider) return
    setModel(provider.capabilities?.image?.defaultModel || provider.imageModel || candidates[0] || '')
  }, [providerId, providers])

  // Job identity is fixed once submitted. Never silently send a second paid request.
  useEffect(() => {
    if (!jobId || !context?.projectId) return
    let cancelled = false
    let timer
    async function check() {
      if (cancelled) return
      try {
        const result = await studioJSON('/api/jobs?projectId=' + context.projectId)
        const job = (result.jobs || []).find(j => j.id === jobId)
        if (!job) throw new Error('任务暂时无法查询。请在 Studio 任务队列按任务 ID 核对，不要重新扣费')
        if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'interrupted') {
          setPhase('failed')
          setError(job.error || '任务' + job.status + '，请在 Studio 队列核查费用后决定是否重试')
          return
        }
        if (job.status !== 'done') {
          setPhase(job.status)
          setMessage(job.status === 'queued' ? '排队中…' : '正在生成图片…')
          timer = window.setTimeout(check, 2500)
          return
        }
        const history = await studioJSON('/api/history?projectId=' + context.projectId)
        const found = (history.history || []).find(h => h.id === job.resultId)
        if (!found) throw new Error('图片已生成，但历史记录暂未同步；请前往 Studio 历史记录查看')
        const dimensions = await imageDimensions(found.url)
        if (cancelled) return
        const added = insertStudioResult(getEditor(), { ...found, dimensions }, active.current?.anchorId, active.current?.ratio || '1:1')
        setPhase('done')
        setMessage(added ? '已完成，并放置在所选图片旁边' : '已完成，画布已存在此图片，无须重复插入')
      } catch (e) {
        if (!cancelled) {
          setPhase('uncertain')
          setError(e.message + '。任务可能已扣费，请先核对历史记录，不要直接重复提交')
        }
      }
    }
    check()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [jobId, context, getEditor])

  async function importOldCanvas() {
    if (!context || importing) return
    setImporting(true)
    setImportNotice('')
    try {
      const result = await importLegacyStudioNodes(getEditor(), context.projectId)
      setImportNotice(result.imported + ' 个旧素材已导入当前画布，跳过 ' + result.skipped + ' 个。' + (result.more ? '项目较大，点击再次导入下一批。' : '已检查全部旧素材。'))
    } catch (e) {
      setImportNotice('导入失败：' + e.message + '。原有 Studio 作品未被修改。')
    } finally {
      setImporting(false)
    }
  }

  async function submit(event) {
    event.preventDefault()
    if (!context || !prompt.trim() || !model.trim() || !providerId || ['submitting','queued','running'].includes(phase)) return
    const editor = getEditor()
    const selected = editor?.getSelectedShapes() || []
    const anchor = selected[0]
    const source = selected.length === 1 ? anchor?.meta?.studioHistoryId : null
    const referenceIds = selected.filter(shape => !shape.meta?.cowartAiImageHolder).map(shape => shape.id)
    setPhase('submitting'); setError(''); setMessage('正在提交到 Studio 任务队列…')
    const requestId = crypto.randomUUID()
    active.current = { anchorId: anchor?.id || null, ratio, requestId }
    try {
      const refs = []
      // Existing generated images use server-side sourceId; other canvas artwork can be rasterized.
      if (!source && referenceIds.length) {
        const exported = await exportSelectionToDataUrl(editor, referenceIds)
        if (exported.dataUrl.length > 10*1024*1024) throw new Error('选区参考图超过 10MB，请缩小选区或先压缩素材')
        refs.push(exported.dataUrl)
      }
      const answer = await studioJSON('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: context.projectId, prompt: prompt.trim(), providerId, model: model.trim(),
          references: refs, sourceId: source || undefined, ratio, resolution, quality: 'auto',
          count: 1, idempotencyKey: requestId
        })
      })
      if (!answer.jobs?.[0]?.id) throw new Error('上游没有返回任务标识')
      jobIdRef.current = answer.jobs[0].id
      setJobId(answer.jobs[0].id)
      setPhase(answer.jobs[0].status || 'queued')
      setMessage('任务已提交，开始追踪状态')
    } catch(e) {
      setError(e.message + '。若是网络中断，请先到 Studio 任务队列核对，不要直接重试，以免重复扣费')
      setPhase('uncertain')
    }
  }

  if (!open) return null
  return <section className="hamoki-studio-panel" role="dialog" aria-label="Hamoki Studio AI 生图">
    <header><strong>🐵 Hamoki Studio</strong><button type="button" onClick={onClose} aria-label="关闭">×</button></header>
    {context && <label className="hamoki-studio-field">当前项目
      <select value={context.projectId} disabled={!!jobId && !['done','failed','uncertain'].includes(phase)} onChange={event => {
        const url = new URL(window.location.href)
        url.searchParams.set('projectId', event.target.value)
        window.location.assign(url.href)
      }}>
        {context.projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>
    </label>}
    <p className="hamoki-studio-note">选中图片或 AI 占位框后输入要求。生成结果放在原图旁，使用已有 Studio 账号和中转站。</p>
    {context && <div className="hamoki-legacy-tools">
      <button type="button" disabled={importing} onClick={importOldCanvas}>
        {importing ? '正在导入旧素材…' : '↳ 导入旧 Studio 画布素材'}
      </button>
      {importNotice && <small aria-live="polite">{importNotice}</small>}
    </div>}

    <form onSubmit={submit}>
      <label className="hamoki-studio-field">图片中转站
        <select value={providerId} onChange={e => setProviderId(e.target.value)}>
          <option value="">请选择中转站</option>
          {providers.filter(p => p.hasKey || p.capabilities?.image?.hasKey).map(p =>
            <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="hamoki-studio-field">模型 ID
        <input value={model} onChange={e => setModel(e.target.value)} list="hamoki-model-options" placeholder="填写中转站实际模型 ID" />
        <datalist id="hamoki-model-options">{candidates.map(m => <option key={m} value={m} />)}</datalist>
      </label>
      <div className="hamoki-studio-row">
        <label className="hamoki-studio-field">比例
          <select value={ratio} onChange={e => setRatio(e.target.value)}>
            {RATIO_NAMES.map(r => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="hamoki-studio-field">清晰度
          <select value={resolution} onChange={e => setResolution(e.target.value)}>
            <option>1K</option><option>2K</option><option>4K</option>
          </select>
        </label>
      </div>
      <label className="hamoki-studio-field">创作 / 修改要求
        <textarea rows={5} value={prompt} onChange={e => setPrompt(e.target.value)}
          placeholder="例如：保持所选游戏 UI 布局，把按钮改为亮黄色，背景压暗，不增加前景装饰" />
      </label>
      <button className="hamoki-studio-submit" disabled={['submitting','queued','running'].includes(phase) || !prompt.trim() || !model.trim() || !providerId} type="submit">
        {['submitting','queued','running'].includes(phase) ? '任务进行中…' : '生成 1 张'}
      </button>
    </form>
    {message && <div className="hamoki-studio-message" aria-live="polite">{message}</div>}
    {error && <div className="hamoki-studio-error" role="alert">{error}</div>}
    {jobId && <small>任务 ID：{jobId} · {phase}</small>}
    {['done','failed','uncertain','cancelled','interrupted'].includes(phase) && <button className="hamoki-studio-next" type="button" onClick={() => { setJobId(null); setPhase('idle'); setError(''); setMessage('') }}>新建下一项任务</button>}
    <p className="hamoki-studio-note">模型设置仍在 <a href="/" target="_blank" rel="noopener noreferrer">Studio 中转站管理</a>。密钥只存储在服务器。</p>
  </section>
}

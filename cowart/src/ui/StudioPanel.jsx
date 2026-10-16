import { useEffect, useRef, useState } from 'react'
import { buildImageShapeRecords } from '../lib/placement.js'
import { exportSelectionToDataUrl } from '../lib/selectionExport.js'
import { getStudioContext, studioJSON } from '../lib/studioBridge.js'
import { importLegacyStudioNodes } from '../lib/legacyImport.js'
import { summarizeCanvasSelection } from '../lib/selectionContext.js'

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
  const [textProviderId, setTextProviderId] = useState('')
  const [textModel, setTextModel] = useState('')
  const [visionProviderId, setVisionProviderId] = useState('')
  const [visionModel, setVisionModel] = useState('')
  const [visualEnabled, setVisualEnabled] = useState(true)
  const [visualNotice, setVisualNotice] = useState('')
  const [intentMode, setIntentMode] = useState('smart')
  const [planNotice, setPlanNotice] = useState('')
  const [turns, setTurns] = useState([])
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState('1:1')
  const [resolution, setResolution] = useState('1K')
  const [jobId, setJobId] = useState(null)
  const [phase, setPhase] = useState('idle')
  const [retryTick, setRetryTick] = useState(0)
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
        const textSource=(p.providers||[]).find(item=>item.capabilities?.text?.enabled!==false && (item.capabilities?.text?.hasKey||item.hasKey) && (item.capabilities?.text?.defaultModel||item.textModel))
        setTextProviderId(old=>old||textSource?.id||'')
        const visualSource=(p.providers||[]).find(item=>item.capabilities?.vision?.enabled!==false && (item.capabilities?.vision?.hasKey||item.hasKey) && (item.capabilities?.vision?.defaultModel||item.visionModel))
        setVisionProviderId(old=>old||visualSource?.id||'')
        if(!textSource)setIntentMode('direct')
      })
      .catch((e) => { if (!cancelled) setError(e.message) })
    const editor = getEditor()
    if (editor) setRatio(ratioForSelection(editor))
    return () => { cancelled = true }
  }, [open, getEditor])

  useEffect(() => {
    if (!context?.projectId) return
    let cancelled=false
    studioJSON('/api/cowart/messages?projectId='+encodeURIComponent(context.projectId))
      .then(data=>{if(!cancelled)setTurns(data.messages||[])})
      .catch(e=>{if(!cancelled)console.warn('Cowart conversation not loaded:',e.message)})
    return ()=>{cancelled=true}
  }, [context?.projectId])

  const provider = providers.find(p => p.id === providerId)
  const textProvider = providers.find(p=>p.id===textProviderId)
  const visionProvider = providers.find(p=>p.id===visionProviderId)
  const visionCandidates = Array.from(new Set([
    visionProvider?.capabilities?.vision?.defaultModel,
    ...(visionProvider?.capabilities?.vision?.models||[]),
    visionProvider?.visionModel
  ].filter(Boolean)))
  const textCandidates = Array.from(new Set([
    textProvider?.capabilities?.text?.defaultModel,
    ...(textProvider?.capabilities?.text?.models || []),
    textProvider?.textModel
  ].filter(Boolean)))
  const candidates = Array.from(new Set([
    provider?.capabilities?.image?.defaultModel,
    ...(provider?.capabilities?.image?.models || []),
    provider?.imageModel
  ].filter(Boolean)))

  useEffect(() => {
    if (!provider) return
    setModel(provider.capabilities?.image?.defaultModel || provider.imageModel || candidates[0] || '')
  }, [providerId, providers])

  useEffect(() => {
    if(textProvider) setTextModel(textProvider.capabilities?.text?.defaultModel || textProvider.textModel || textCandidates[0] || '')
  }, [textProviderId, providers])

  useEffect(()=>{
    if(visionProvider)setVisionModel(visionProvider.capabilities?.vision?.defaultModel||visionProvider.visionModel||visionCandidates[0]||'')
  },[visionProviderId,providers])

  // A refresh must never lose the identity of a possibly paid job.
  useEffect(() => {
    if(!context?.projectId)return
    const key=context.projectId
    try {
      const activeJob=JSON.parse(sessionStorage.getItem('hamoki-cowart-active:'+key)||'null')
      if(activeJob?.jobId && /^[a-f0-9-]{36}$/i.test(activeJob.jobId)) {
        active.current={anchorId:activeJob.anchorId||null,ratio:activeJob.ratio||'1:1'}
        setJobId(activeJob.jobId)
        setPhase('queued')
        setMessage('已恢复上次任务编号，正在核对任务队列…')
        return
      }
      const unknown=JSON.parse(sessionStorage.getItem('hamoki-cowart-last-request:'+key)||'null')
      if(unknown?.requestId && Date.now()-unknown.at<24*3600*1000) {
        setPhase('uncertain')
        setError('上次图片请求的结果尚未确认（请求编号 '+unknown.requestId+'）。请到 Studio 队列核对后再新建任务，防止重复扣费。')
      }
    }catch(e){console.warn('Could not restore previous job:',e)}
  }, [context?.projectId])

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
          setMessage(job.status === 'queued' ? '排队中…' : '正在生成图片…'+(Number.isFinite(Number(job.progress))?' '+Math.round(Number(job.progress))+'%':''))
          timer = window.setTimeout(check, 2500)
          return
        }
        const history = await studioJSON('/api/history?projectId=' + context.projectId)
        const found = (history.history || []).find(h => h.id === job.resultId)
        if (!found) throw new Error('图片已生成，但历史记录暂未同步；请前往 Studio 历史记录查看')
        const dimensions = await imageDimensions(found.url)
        if (cancelled) return
        const added = insertStudioResult(getEditor(), { ...found, dimensions }, active.current?.anchorId, active.current?.ratio || '1:1')
        sessionStorage.removeItem('hamoki-cowart-active:'+context.projectId)
        sessionStorage.removeItem('hamoki-cowart-last-request:'+context.projectId)
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
  }, [jobId, context, getEditor, retryTick])

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
    if (!context || !prompt.trim() || ['analyzing','submitting','queued','running'].includes(phase)) return
    if (phase==='uncertain') {
      setError('上一条请求结果未确认，请先通过任务队列核对，再明确开启下一条任务。')
      return
    }
    const editor = getEditor()
    const selected = editor?.getSelectedShapes() || []
    const selectedImage = selected.filter(s=>s.type==='image' && s.meta?.studioHistoryId)
    if (selectedImage.length > 1) {
      setError('一次只能编辑一张原图，请只选择一张主图，其余素材可以作为参考')
      return
    }
    const source = selectedImage[0]?.meta?.studioHistoryId || null
    const anchor = selected.find(s=>s.meta?.cowartAiImageHolder) || selectedImage[0] || selected[0]
    const referenceIds = selected.filter(s=>!s.meta?.cowartAiImageHolder && s.id!==selectedImage[0]?.id).map(s=>s.id)
    let instruction = prompt.trim()
    let editSpec = null
    const selection = summarizeCanvasSelection(editor)
    setError('');setPlanNotice('');setMessage('')
    let action='generate'
    try {
      if(intentMode==='smart') {
        if(!textProviderId||!textModel)throw Error('请先配置 Studio 文字模型，或选择「直接生图」')
        let visual
        setVisualNotice('')
        const imageForVision = selected.find(s=>s.type==='image')
        if(visualEnabled && imageForVision) {
          if(!visionProviderId||!visionModel)throw Error('已启用看图分析，但尚未配置视觉模型。请选择视觉模型或关闭看图分析')
          setPhase('analyzing')
          setMessage('准备当前选中的真实图片，交给 Studio 的视觉模型观察布局、颜色和具体元素…')
          if(imageForVision.meta?.studioHistoryId) {
            visual={sourceId:imageForVision.meta.studioHistoryId}
          }else {
            const exported=await exportSelectionToDataUrl(editor,[imageForVision.id])
            if(exported.dataUrl.length>10*1024*1024)throw Error('选中的原图超过视觉识别限制（约 8MB），请压缩素材')
            visual={image:exported.dataUrl}
          }
        }else if(visualEnabled && selected.some(s=>s.meta?.cowartAiImageHolder)){
          setVisualNotice('选中的是空图片占位框，目前还没有真实像素可分析；将仅使用文字标注和 Style DNA')
        }else if(imageForVision) {
          setVisualNotice('这次未启用视觉模型，仅使用文字描述和画布标注')
        }
        setPhase('analyzing');setMessage(visual?'视觉模型正在看图，之后再由文字模型判断操作…':'正在读取选区、标注与项目美术规范，由文字模型判断操作…')
        const response = await studioJSON('/api/cowart/plan',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({projectId:context.projectId,prompt:instruction,
            providerId:textProviderId,model:textModel,selection,
            ...(visual?{visual,visionProviderId,visionModel}: {})})
        })
        const plan=response.plan || {}
        if(response.visionUsed)setVisualNotice('视觉模型 '+(response.visionModel||'')+' 已观察所选原图，图片内容已纳入 AI 规划（不修改原图）')
        setTurns(old=>[...old,
          {id:crypto.randomUUID(),role:'user',content:prompt.trim(),createdAt:new Date().toISOString()},
          {id:crypto.randomUUID(),role:'assistant',content:plan.reply||'已分析你的要求',action:plan.action,createdAt:new Date().toISOString()}
        ].slice(-60))
        setPlanNotice(plan.reply || '')
        if(plan.action==='chat') {
          setPhase('answered')
          setMessage(plan.reply || '这是一条讨论，不需要扣费生图')
          return
        }
        action=plan.action
        editSpec=plan.editSpec || null
        if(plan.instructions)instruction+='\n【画布修改计划】'+plan.instructions
      }
      if(!model.trim()||!providerId)throw Error('请先选择图片中转站和模型')
      if(action==='edit'&&!source&&!selected.some(x=>x.type==='image'))
        throw Error('请先选中需要修改的图片。编辑未提交，也没有产生图片费用')
      setPhase('preparing');setMessage('正在准备画布参考素材…')
      const refs=[]
      if(!source && referenceIds.length) {
        const exported=await exportSelectionToDataUrl(editor,referenceIds)
        if(exported.dataUrl.length>10*1024*1024)throw Error('选区参考图超过 10MB，请缩小选区或压缩素材')
        refs.push(exported.dataUrl)
      } else if(!source && selected.some(x=>x.type==='image')) {
        const exported=await exportSelectionToDataUrl(editor,selected.filter(x=>x.type==='image').map(x=>x.id))
        if(exported.dataUrl.length>10*1024*1024)throw Error('源图片超过 10MB，请先压缩')
        refs.push(exported.dataUrl)
      }
      // Non-generated reference items selected alongside a generated original are exported separately.
      if(source && referenceIds.length) {
        const exported=await exportSelectionToDataUrl(editor,referenceIds)
        if(exported.dataUrl.length>10*1024*1024)throw Error('附加参考素材超过 10MB')
        refs.push(exported.dataUrl)
      }
      setPhase('submitting');setMessage('准备完成，正在提交恰好一张图片到 Studio 原有任务队列…')
      const requestId=crypto.randomUUID()
      active.current={anchorId:anchor?.id||null,ratio,requestId}
      const payload={
        projectId:context.projectId,prompt:instruction,providerId,model:model.trim(),
        references:refs,sourceId:source||undefined,
        editSpec:editSpec||undefined,
        ratio,resolution,quality:'auto',count:1,idempotencyKey:requestId
      }
      // Keep the same payload and idempotency key available for uncertain-submission diagnosis.
      sessionStorage.setItem('hamoki-cowart-last-request:'+context.projectId,
        JSON.stringify({requestId,at:Date.now(),providerId,model:model.trim(),prompt:instruction}))
      const answer=await studioJSON('/api/jobs',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
      })
      if(!answer.jobs?.[0]?.id)throw Error('任务已提交但未返回编号；请到 Studio 任务队列核对')
      jobIdRef.current=answer.jobs[0].id
      sessionStorage.setItem('hamoki-cowart-active:'+context.projectId,JSON.stringify({jobId:answer.jobs[0].id,anchorId:anchor?.id||null,ratio}))
      sessionStorage.removeItem('hamoki-cowart-last-request:'+context.projectId)
      setJobId(answer.jobs[0].id)
      setPhase(answer.jobs[0].status||'queued')
      setMessage('任务已提交，开始追踪进度')
    } catch(e) {
      setError(e.message + '。如果已经提交过付费任务，请先检查 Studio 的队列与历史，不要直接重复扣费')
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
    <div className="hamoki-conversation" aria-label="当前项目 AI 对话记录">
      {!turns.length && <div className="hamoki-conversation-empty">在画布选一张图片，写下你的要求。我会分析标注和已确认的项目美术规范。</div>}
      {turns.map((turn,index)=><div key={turn.id||index} className={'hamoki-bubble '+(turn.role==='user'?'is-user':'is-assistant')}>
        <small>{turn.role==='user'?'你':'🐵 AI 助手'}{turn.action==='edit'?' · 编辑计划':turn.action==='generate'?' · 生图计划':''}</small>
        <span>{turn.content}</span>
      </div>)}
    </div>
    {context && <div className="hamoki-legacy-tools">
      <button type="button" disabled={importing} onClick={importOldCanvas}>
        {importing ? '正在导入旧素材…' : '↳ 导入旧 Studio 画布素材'}
      </button>
      {importNotice && <small aria-live="polite">{importNotice}</small>}
    </div>}

    <div className="hamoki-studio-row">
      <label className="hamoki-studio-field">执行方式
        <select value={intentMode} onChange={e=>setIntentMode(e.target.value)}>
          <option value="smart">智能理解 · 按意图操作</option>
          <option value="direct">直接生图 · 不分析</option>
        </select>
      </label>
      {intentMode==='smart' && <label className="hamoki-studio-field">文字分析模型
        <select value={textProviderId} onChange={e=>setTextProviderId(e.target.value)}>
          <option value="">请选择文字中转站</option>
          {providers.filter(p=>p.capabilities?.text?.enabled!==false&&(p.capabilities?.text?.hasKey||p.hasKey)).map(p=>
            <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>}
    </div>
    {intentMode==='smart' && <label className="hamoki-studio-field">文字模型 ID
      <input value={textModel} onChange={e=>setTextModel(e.target.value)} list="hamoki-text-model-options" placeholder="例如 DeepSeek / GPT / Claude 兼容模型" />
      <datalist id="hamoki-text-model-options">{textCandidates.map(m=><option key={m} value={m} />)}</datalist>
    </label>}
    {intentMode==='smart' && <div className="hamoki-vision-settings">
      <label className="hamoki-vision-switch">
        <input type="checkbox" checked={visualEnabled} onChange={e=>setVisualEnabled(e.target.checked)} />
        <span>有选中图片时先让视觉模型看图（单独消耗视觉模型额度）</span>
      </label>
      {visualEnabled && <div className="hamoki-studio-row">
        <label className="hamoki-studio-field">视觉中转站
          <select value={visionProviderId} onChange={e=>setVisionProviderId(e.target.value)}>
            <option value="">请选择视觉中转站</option>
            {providers.filter(p=>p.capabilities?.vision?.enabled!==false&&(p.capabilities?.vision?.hasKey||p.hasKey)).map(p=>
              <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="hamoki-studio-field">视觉模型
          <input value={visionModel} onChange={e=>setVisionModel(e.target.value)}
            list="hamoki-vision-model-options" placeholder="选择支持图片理解的模型" />
          <datalist id="hamoki-vision-model-options">{visionCandidates.map(m=><option key={m} value={m} />)}</datalist>
        </label>
      </div>}
    </div>}
    <p className="hamoki-studio-note">智能模式只在选中真实图片时调用视觉模型；随后文字模型理解图片与标注。讨论不会自动创建图片任务。</p>
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
      <button className="hamoki-studio-submit" disabled={['analyzing','preparing','submitting','queued','running','uncertain'].includes(phase) || !prompt.trim() || (intentMode==='smart' ? (!textModel.trim()||!textProviderId) : (!model.trim()||!providerId))} type="submit">
        {['analyzing','preparing','submitting','queued','running'].includes(phase) ? 'AI 正在处理…' : intentMode==='smart'?'智能理解并执行':'直接生成 1 张'}
      </button>
    </form>
    {visualNotice && <div className="hamoki-studio-message" aria-live="polite">{visualNotice}</div>}
    {planNotice && <div className="hamoki-studio-message" aria-live="polite">AI 理解：{planNotice}</div>}
    {message && <div className="hamoki-studio-message" aria-live="polite">{message}</div>}
    {error && <div className="hamoki-studio-error" role="alert">{error}</div>}
    {jobId && <small>任务 ID：{jobId} · {phase}</small>}
    {phase==='uncertain' && jobId && <button className="hamoki-studio-next" type="button"
      onClick={()=>{setError('');setMessage('正在重新查询原任务，不会提交新生图…');setRetryTick(x=>x+1)}}>重新查询原任务（不扣新费用）</button>}
    {['done','failed','uncertain','answered','cancelled','interrupted'].includes(phase) && <button className="hamoki-studio-next" type="button" onClick={() => {
      if(phase==='uncertain'&&!window.confirm('确认已经核对 Studio 任务队列和历史记录？未确认的请求可能已计费，切换到新任务会产生重复费用风险。'))return
      if(context?.projectId){
        sessionStorage.removeItem('hamoki-cowart-active:'+context.projectId)
        sessionStorage.removeItem('hamoki-cowart-last-request:'+context.projectId)
      }
      setJobId(null); setPhase('idle'); setError(''); setMessage(''); setPlanNotice('')
    }}>开启下一轮</button>}
    <p className="hamoki-studio-note">模型设置仍在 <a href="/" target="_blank" rel="noopener noreferrer">Studio 中转站管理</a>。密钥只存储在服务器。</p>
  </section>
}

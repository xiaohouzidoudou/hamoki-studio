import { originalSourceMatches } from '../canvas/export.js'
import { useEffect, useRef, useState } from 'react'
import { buildImageShapeRecords, findPageIdForShape } from '../lib/placement.js'
import { exportSelectionToDataUrl } from '../lib/selectionExport.js'
import { getStudioContext, studioJSON } from '../lib/studioBridge.js'
import JobControls from './JobControls.jsx'
import { importLegacyStudioNodes } from '../lib/legacyImport.js'
import { summarizeCanvasSelection } from '../lib/selectionContext.js'
import { acknowledgeSavedResult, hasUnsavedResult } from '../lib/jobRecovery.js'
import { canvasInputSelection, isEmptyImageHolder, IMAGE_REFERENCE_ROLES } from '../lib/canvasInputs.js'

const RATIOS = [[1, 1], [3, 2], [2, 3], [16, 9], [9, 16], [4, 3], [3, 4]]
const RATIO_NAMES = RATIOS.map(([a, b]) => a + ':' + b)

function ratioForShape(shape) {
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
function insertStudioResult(editor, image, anchorId, ratio, submittedPageId) {
  if (!editor) throw new Error('画布尚未就绪，图片保留在 Studio 历史记录中')
  const snapshot = editor.store.getStoreSnapshot()
  if (Object.values(snapshot.store).some((record) => record.typeName === 'shape' && record.meta?.studioHistoryId === image.id)) return false
  const anchor = anchorId ? editor.getShape(anchorId) : null
  const pageId = (anchor && findPageIdForShape(snapshot.store,anchor.id)) ||
    (snapshot.store[submittedPageId]?.typeName==='page' ? submittedPageId : editor.getCurrentPageId())
  const [rx, ry] = ratio.split(':').map(Number)
  const fillHolder = isEmptyImageHolder(snapshot.store,anchor)
  const fitScale = fillHolder ? Math.min(anchor.props.w/image.dimensions.width,anchor.props.h/image.dimensions.height) : null
  const displayWidth = fillHolder ? image.dimensions.width*fitScale : anchor?.props?.w || 512
  const displayHeight = fillHolder ? image.dimensions.height*fitScale : Math.round(displayWidth*(image.dimensions.height/image.dimensions.width||ry/rx))
  const records = buildImageShapeRecords({
    store: snapshot.store, pageId, parentId: fillHolder ? anchor.id : pageId, anchorShapeId: anchor?.id,
    anchorShape: anchor, imageSize: image.dimensions, displayWidth, displayHeight,
    matchAnchor: false, dataUrl: image.url,
    mimeType: /\.webp(?:$|\?)/.test(image.url) ? 'image/webp' : /\.jpe?g(?:$|\?)/.test(image.url) ? 'image/jpeg' : 'image/png',
    altText: 'Hamoki Studio · ' + (image.prompt || '生成图片'),
    shapeMeta: { studioHistoryId: image.id, studioProjectId: image.projectId, studioOrigin: 'image-job' }
  })
  // Server-owned same-origin media URL; do not embed large base64 images in the canvas snapshot.
  // tldraw requires a positive size when present; a remote URL has no known byte size.
  delete records.assetRecord.props.fileSize
  records.assetRecord.props.name = 'hamoki-' + image.id + '.png'
  if(fillHolder){records.shapeRecord.x=(anchor.props.w-displayWidth)/2;records.shapeRecord.y=(anchor.props.h-displayHeight)/2}
  editor.store.put([records.assetRecord, records.shapeRecord])
  if(editor.getCurrentPageId()!==pageId)editor.setCurrentPage(pageId)
  editor.select(records.shapeId)
  return fillHolder ? 'holder' : 'beside'
}

export default function StudioPanel({ open, onClose, getEditor, canvasEditor }) {
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
  const [canvasSelection, setCanvasSelection] = useState([])
  const [primaryChoice, setPrimaryChoice] = useState('auto')
  const [referenceRoles, setReferenceRoles] = useState({})
  const [inputsExpanded, setInputsExpanded] = useState(false)
  const [resolution, setResolution] = useState('1K')
  const [jobId, setJobId] = useState(null)
  const [phase, setPhase] = useState('idle')
  const [retryTick, setRetryTick] = useState(0)
  const [recoveryTick, setRecoveryTick] = useState(0)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importNotice, setImportNotice] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [jobEvidence, setJobEvidence] = useState(null)
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
    return () => { cancelled = true }
  }, [open, getEditor])

  useEffect(()=>{
    if(!open)return
    const editor=canvasEditor||getEditor()
    if(!editor)return
    let selectionKey='',ratioKey=''
    const sync=()=>{
      const selected=editor.getSelectedShapes()
      const inputs=canvasInputSelection(selected,primaryChoice)
      const key=JSON.stringify(selected.map(s=>[s.id,s.props?.w,s.props?.h,s.props?.altText,s.meta?.studioHistoryId]))
      if(key!==selectionKey){
        selectionKey=key
        setCanvasSelection([...inputs.images.slice(0,9),...(inputs.holder?[inputs.holder]:[])])
        if(primaryChoice!=='auto'&&primaryChoice&&!inputs.images.some(s=>s.id===primaryChoice))setPrimaryChoice('auto')
      }
      const target=inputs.anchor
      const size=target ? target.id+':'+target.props?.w+':'+target.props?.h : ''
      if(size!==ratioKey){ratioKey=size;if(target)setRatio(ratioForShape(target))}
    }
    sync()
    return editor.store.listen(sync,{source:'all',scope:'all'})
  },[open,getEditor,primaryChoice,canvasEditor])

  useEffect(()=>{
    const editor=canvasEditor||getEditor();if(!editor)return
    const reference=()=>{setInputsExpanded(true);setPrimaryChoice('');setPlanNotice('所选图片将作为参考生成新图，原图保持不变')}
    editor.getContainer().addEventListener('cowart:reference-selection',reference)
    return()=>editor.getContainer().removeEventListener('cowart:reference-selection',reference)
  },[canvasEditor,getEditor])

  const selectedInputs=canvasInputSelection(canvasSelection,primaryChoice)

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

  // Server-owned job metadata survives closing the tab, losing a response and
  // signing in on another device. Session storage remains a legacy fallback.
  useEffect(() => {
    if(!context?.projectId)return
    const key=context.projectId
    let cancelled=false
    setPhase('recovering')
    async function restore(){
     try {
      const response=await studioJSON('/api/cowart/jobs?projectId='+encodeURIComponent(key))
      if(cancelled)return
      const serverJob=response.jobs?.[0]
      const activeJob=serverJob ? {
        jobId:serverJob.id,anchorId:serverJob.cowart.anchorId,pageId:serverJob.cowart.pageId,
        ratio:serverJob.ratio||'1:1',durable:true
      } : JSON.parse(sessionStorage.getItem('hamoki-cowart-active:'+key)||'null')
      if(activeJob?.jobId && /^[a-f0-9-]{36}$/i.test(activeJob.jobId)) {
        active.current=activeJob
        sessionStorage.setItem('hamoki-cowart-active:'+key,JSON.stringify(activeJob))
        setJobId(activeJob.jobId)
        setPhase('queued')
        setError('')
        setMessage('已恢复服务器原任务，正在核对任务队列，不会重新生图…')
        return
      }
      const unknown=JSON.parse(sessionStorage.getItem('hamoki-cowart-last-request:'+key)||'null')
      if(unknown?.requestId && Date.now()-unknown.at<24*3600*1000) {
        setPhase('uncertain')
        setError('上次图片请求的结果尚未确认（请求编号 '+unknown.requestId+'）。请到 Studio 队列核对后再新建任务，防止重复扣费。')
        return
      }
      setPhase('idle');setError('')
     }catch(e){
      if(!cancelled){setPhase('uncertain');setError('无法核对服务器原任务：'+e.message+'。请重新查询，暂不提交新的生图。')}
     }
    }
    restore()
    return ()=>{cancelled=true}
  }, [context?.projectId,recoveryTick])

  // Job identity is fixed once submitted. Never silently send a second paid request.
  useEffect(() => {
    if (!jobId || !context?.projectId || !getEditor()) return
    let cancelled = false
    let timer
    async function check() {
      if (cancelled) return
      try {
        const result = await studioJSON((active.current?.durable ? '/api/cowart/jobs' : '/api/jobs')+'?projectId=' + context.projectId)
        const job = (result.jobs || []).find(j => j.id === jobId)
        if (job) setJobEvidence(job)
        if (!job) throw new Error('任务暂时无法查询。请在 Studio 任务队列按任务 ID 核对，不要重新扣费')
        if(job.cowart)active.current={...active.current,...job.cowart,ratio:job.ratio||'1:1',durable:true}
        if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'interrupted') {
          // Terminal failures must not be restored as queued after a browser refresh.
          sessionStorage.removeItem('hamoki-cowart-active:'+context.projectId)
          sessionStorage.removeItem('hamoki-cowart-last-request:'+context.projectId)
          setPhase(job.status)
          setMessage(job.status === 'cancelled' ? '任务已取消；取消不保证上游停止或退款' : '原任务已结束，请核对请求结果和中转站记录')
          setError(job.status === 'cancelled' ? '' : (job.error || '任务已失败或中断，请在 Studio 队列核查费用后决定是否重试'))
          return
        }
        if (job.status !== 'done') {
          setPhase(job.status)
          const progress = job.progress == null || job.progress === '' ? null : Number(job.progress)
          const progressText = progress !== null && Number.isFinite(progress) ? ' '+Math.max(0,Math.min(100,Math.round(progress)))+'%' : ''
          setMessage(job.status === 'queued' ? '排队中…' : '正在生成图片…'+progressText)
          timer = window.setTimeout(check, 2500)
          return
        }
        const history = await studioJSON('/api/history?projectId=' + context.projectId)
        const found = (history.history || []).find(h => h.id === job.resultId)
        if (!found) throw new Error('图片已生成，但历史记录暂未同步；请前往 Studio 历史记录查看')
        const dimensions = await imageDimensions(found.url)
        if (cancelled) return
        // Persist identity before insertion triggers the debounced snapshot save.
        sessionStorage.setItem('hamoki-cowart-active:'+context.projectId,
          JSON.stringify({...active.current,jobId,resultId:found.id}))
        const added = insertStudioResult(getEditor(), { ...found, dimensions }, active.current?.anchorId, active.current?.ratio || '1:1',active.current?.pageId)
        if (!added) {
          const saved = await studioJSON('/api/cowart/snapshot?projectId='+encodeURIComponent(context.projectId))
          if (cancelled) return
          acknowledgeSavedResult(context.projectId, saved.snapshot)
        }
        setPhase('done')
        if(!added)setMessage('已完成，画布已存在此图片，无须重复插入')
        else if(added==='holder')setMessage('已完成，已放入所选空占位框')
        else setMessage(active.current?.anchorId?'已完成，已排列在原图或占位框旁':'已完成，已放入画布')
      } catch (e) {
        if (!cancelled) {
          setPhase('uncertain')
          setError(e.message + '。任务可能已扣费，请先核对历史记录，不要直接重复提交')
        }
      }
    }
    check()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [jobId, context, getEditor, retryTick, canvasEditor])

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

  function changeOutputRatio(value){
    setRatio(value)
    const editor=getEditor()
    if(!editor)return
    const {holder}=canvasInputSelection(editor.getSelectedShapes(),primaryChoice)
    if(!isEmptyImageHolder(editor.store.getStoreSnapshot().store,holder))return
    const [a,b]=value.split(':').map(Number)
    let w=Math.max(16,Math.min(8192,holder.props.w)),h=w*b/a
    if(h>8192){h=8192;w=h*a/b}
    if(h<16){h=16;w=h*a/b}
    w=Math.round(w);h=Math.round(h)
    editor.markHistoryStoppingPoint('change-cowart-output-ratio')
    editor.updateShape({id:holder.id,type:holder.type,meta:{...holder.meta,cowartAiAspectRatio:w/h},props:{w,h}})
  }

  async function submit(event) {
    event.preventDefault()
    if (!context || !prompt.trim() || ['recovering','analyzing','preparing','submitting','queued','running'].includes(phase)) return
    if (hasUnsavedResult(context.projectId)) {
      setError('上一张图片尚未保存到服务器，请先解决「画布尚未同步」提示并等待保存成功；刷新会恢复原任务，不会重新生图。')
      return
    }
    if (phase==='uncertain') {
      setError('上一条请求结果未确认，请先通过任务队列核对，再明确开启下一条任务。')
      return
    }
    const editor = getEditor()
    if (cancelling) return
    if (jobId && ['failed','cancelled','interrupted'].includes(phase)) {
      setError('请先核对原任务及可能产生的费用，再点击「开启下一轮」。')
      return
    }
    const selected = editor?.getSelectedShapes() || []
    const inputs = canvasInputSelection(selected,primaryChoice)
    if (inputs.images.length > 8) {
      setError('最多同时使用 8 张图片，请减少选区中的参考图')
      return
    }
    let primary = inputs.primary
    let source = null
    const anchor = inputs.anchor
    let instruction = prompt.trim()
    let editSpec = null
    const selection = summarizeCanvasSelection(editor,{primaryId:primary?.id,roles:referenceRoles})
    setError('');setPlanNotice('');setMessage('')
    let action=intentMode==='direct'&&primary?'edit':'generate'
    // Only an ambiguous network response after a paid POST can enter uncertain state.
    // Validation, planning and reference export failures never submit an image job.
    let paidRequestStarted = false
    try {
      if(intentMode==='smart') {
        if(!textProviderId||!textModel)throw Error('请先配置 Studio 文字模型，或选择「直接生图」')
        let visual
        setVisualNotice('')
        const imageForVision = primary || inputs.images[0]
        if(visualEnabled && imageForVision) {
          if(!visionProviderId||!visionModel)throw Error('已启用看图分析，但尚未配置视觉模型。请选择视觉模型或关闭看图分析')
          setPhase('analyzing')
          setMessage('准备当前选中的真实图片，交给 Studio 的视觉模型观察布局、颜色和具体元素…')
          if(imageForVision.meta?.studioHistoryId && originalSourceMatches(imageForVision,editor)) {
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
      const editing=action==='edit'
      if(editing&&!primary&&primaryChoice==='auto'&&inputs.images.length===1)primary=inputs.images[0]
      if(editing&&!primary)throw Error('请在「修改主图」中指定一张图片；其余图片可以分别作为参考')
      source=editing ? (originalSourceMatches(primary,editor)?primary.meta?.studioHistoryId:null)||null : null
      setPhase('preparing');setMessage('正在准备画布参考素材…')
      const refs=[],uploadRoles=[],referenceHistory=[],referenceOrder=[]
      const exportReference=async(shapeIds,role)=>{
        const exported=await exportSelectionToDataUrl(editor,shapeIds)
        if(exported.dataUrl.length>10*1024*1024)throw Error('参考图片超过 10MB，请先压缩')
        refs.push(exported.dataUrl);uploadRoles.push(role);referenceOrder.push({kind:'upload',index:refs.length-1})
      }
      if(editing&&!source)await exportReference([primary.id],'general')
      for(const image of inputs.images){
        if(editing&&image.id===primary.id)continue
        const role=referenceRoles[image.id]||'general'
        if(image.meta?.studioHistoryId && originalSourceMatches(image,editor)){referenceHistory.push({sourceId:image.meta.studioHistoryId,role});referenceOrder.push({kind:'history',index:referenceHistory.length-1})}
        else await exportReference([image.id],role)
      }
      const annotationIds=selected.filter(s=>s.type!=='image'&&!s.meta?.cowartAiImageHolder).map(s=>s.id)
      if(annotationIds.length)await exportReference(annotationIds,'general')
      if(refs.length+referenceHistory.length>8)throw Error('图片与标注合计最多 8 张参考，请减少选区')
      if(inputs.images.length>1){
        const ordered=editing?[primary,...inputs.images.filter(s=>s.id!==primary.id)]:inputs.images
        instruction+='\n【本轮画布图片编号与模型输入对应】'+ordered.map((image,index)=>
          '输入'+(index+1)+' = 画布图片'+(inputs.images.indexOf(image)+1)+(editing&&index===0?'（修改主图）':
            '（'+(IMAGE_REFERENCE_ROLES.find(([role])=>role===(referenceRoles[image.id]||'general'))?.[1]||'综合参考')+'）')).join('；')
      }
      setPhase('submitting');setMessage('准备完成，正在提交恰好一张图片到 Studio 原有任务队列…')
      const requestId=crypto.randomUUID()
      active.current={anchorId:anchor?.id||null,pageId:editor.getCurrentPageId(),ratio,requestId,durable:true}
      const payload={
        autoRetry:false,
        projectId:context.projectId,prompt:instruction,providerId,model:model.trim(),
        references:refs,referenceRoles:uploadRoles,referenceHistory,referenceOrder,editMode:editing?'edit':'new',sourceId:source||undefined,
        editSpec:editSpec||undefined,
        ratio,resolution,quality:'auto',count:1,idempotencyKey:requestId,
        cowart:{anchorId:active.current.anchorId,pageId:active.current.pageId}
      }
      // Keep the same payload and idempotency key available for uncertain-submission diagnosis.
      sessionStorage.setItem('hamoki-cowart-last-request:'+context.projectId,
        JSON.stringify({requestId,at:Date.now(),providerId,model:model.trim(),prompt:instruction}))
      paidRequestStarted = true
      const answer=await studioJSON('/api/jobs',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
      })
      if(!answer.jobs?.[0]?.id)throw Error('任务已提交但未返回编号；请到 Studio 任务队列核对')
      jobIdRef.current=answer.jobs[0].id
      sessionStorage.setItem('hamoki-cowart-active:'+context.projectId,JSON.stringify({...active.current,jobId:answer.jobs[0].id}))
      sessionStorage.removeItem('hamoki-cowart-last-request:'+context.projectId)
      setJobId(answer.jobs[0].id)
      setPhase(answer.jobs[0].status||'queued')
      setMessage('任务已提交，开始追踪进度')
    } catch(e) {
      if (paidRequestStarted) {
        setError(e.message + '。付费请求结果未确认，请先检查 Studio 的队列与历史，不要直接重复扣费')
        setPhase('uncertain')
      } else {
        setError(e.message + '。图片任务尚未提交，没有产生本次生图费用；修正后可以重新发送')
        setPhase('failed')
      }
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
    <p className="hamoki-studio-note">选中图片或 AI 占位框后输入要求。结果进入空占位框或排列在原图旁，使用已有 Studio 账号和中转站。</p>
    {!!selectedInputs.images.length && <details className="hamoki-canvas-inputs" open={inputsExpanded||selectedInputs.images.length>1}>
      <summary>参考图与修改主图 · {selectedInputs.images.length} 张</summary>
      <label className="hamoki-studio-field">修改主图
        <select aria-label="修改主图" value={primaryChoice} onChange={e=>setPrimaryChoice(e.target.value)}>
          <option value="auto">自动：单图修改，占位框/多图参考</option>
          <option value="">无主图：根据参考生成新图</option>
          {selectedInputs.images.map((image,index)=><option key={image.id} value={image.id}>图片 {index+1} · {image.props.altText?.slice(0,36)||'所选图片'}</option>)}
        </select>
      </label>
      {selectedInputs.images.filter(image=>image.id!==selectedInputs.primary?.id).map(image=><label key={image.id} className="hamoki-studio-field">参考图 {selectedInputs.images.indexOf(image)+1} 用途
        <select aria-label={'参考图 '+(selectedInputs.images.indexOf(image)+1)+' 用途'} value={referenceRoles[image.id]||'general'} onChange={e=>setReferenceRoles(old=>({...old,[image.id]:e.target.value}))}>
          {IMAGE_REFERENCE_ROLES.map(([role,label])=><option key={role} value={role}>{label}</option>)}
        </select>
      </label>)}
      <small>参考图分别交给图片模型，默认综合参考；空占位框决定输出位置与比例。已有作品无需重复上传。</small>
    </details>}
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
    <fieldset disabled={cancelling || (!!jobId && ['failed','cancelled','interrupted'].includes(phase))} style={{display:'contents'}}>
    <p className="hamoki-studio-note">智能模式只在选中真实图片时调用视觉模型；随后文字模型理解图片与标注。讨论不会自动创建图片任务。</p>
    {intentMode==='smart'&&selectedInputs.images.length>1&&<p className="hamoki-studio-note">看图分析只观察主图或首张参考；文字模型接收逐图用途，图片模型接收全部参考。</p>}
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
          <select data-testid="cowart-output-ratio" value={ratio} onChange={e => changeOutputRatio(e.target.value)}>
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
      <button className="hamoki-studio-submit" disabled={['recovering','analyzing','preparing','submitting','queued','running','uncertain'].includes(phase) || !prompt.trim() || (intentMode==='smart' ? (!textModel.trim()||!textProviderId) : (!model.trim()||!providerId))} type="submit">
        {['recovering','analyzing','preparing','submitting','queued','running'].includes(phase) ? 'AI 正在处理…' : intentMode==='smart'?'智能理解并执行':'直接生成 1 张'}
      </button>
    </form>
    </fieldset>
    {jobId && <JobControls key={jobId} jobId={jobId} phase={phase}
      job={jobEvidence?.id === jobId ? jobEvidence : null} onBusyChange={setCancelling}
      onRefresh={()=>setRetryTick(x=>x+1)} />}
    {visualNotice && <div className="hamoki-studio-message" aria-live="polite">{visualNotice}</div>}
    {planNotice && <div className="hamoki-studio-message" aria-live="polite">AI 理解：{planNotice}</div>}
    {message && <div className="hamoki-studio-message" aria-live="polite">{message}</div>}
    {error && <div className="hamoki-studio-error" role="alert">{error}</div>}
    {jobId && <small>任务 ID：{jobId} · {phase}</small>}
    {phase==='uncertain' && <button className="hamoki-studio-next" type="button"
      onClick={()=>{setError('');setMessage('正在重新查询原任务，不会提交新生图…');jobId?setRetryTick(x=>x+1):setRecoveryTick(x=>x+1)}}>重新查询原任务（不扣新费用）</button>}
    {['done','failed','uncertain','answered','cancelled','interrupted'].includes(phase) && <button className="hamoki-studio-next" type="button" onClick={async () => {
      if(phase==='uncertain'&&!window.confirm('确认已经核对 Studio 任务队列和历史记录？未确认的请求可能已计费，切换到新任务会产生重复费用风险。'))return
      if(cancelling)return
      if(['cancelled','interrupted'].includes(phase) && jobEvidence?.requestOutcome!=='not_sent' && !window.confirm('确认已核对原任务及中转站记录？上游可能已计费，开启下一轮会创建新的付费请求。'))return
      if(context?.projectId && hasUnsavedResult(context.projectId)) {
        setError('上一张图片尚未保存到服务器，暂不能开启下一轮；请先保存画布，或刷新恢复原任务。')
        return
      }
      if(active.current?.durable&&jobId){
        if(phase==='failed'&&!window.confirm('确认已核对原任务的失败或中断状态及可能产生的费用？开启下一轮可能产生新费用。'))return
        try{
          await studioJSON('/api/cowart/jobs/'+jobId+'/ack',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({projectId:context.projectId,confirmed:true})})
        }catch(e){setError(e.message);return}
      }
      if(context?.projectId){
        sessionStorage.removeItem('hamoki-cowart-active:'+context.projectId)
        sessionStorage.removeItem('hamoki-cowart-last-request:'+context.projectId)
      }
      setJobId(null); setPhase('idle'); setError(''); setMessage(''); setPlanNotice('')
    }}>开启下一轮</button>}
    <p className="hamoki-studio-note">模型设置仍在 <a href="/" target="_blank" rel="noopener noreferrer">Studio 中转站管理</a>。密钥只存储在服务器。</p>
  </section>
}

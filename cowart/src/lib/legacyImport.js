// Imports legacy Studio project nodes without deleting, moving, or altering their server records.
// This is deliberately user-triggered and idempotent via studioNodeId metadata.
import { createShapeId, toRichText } from 'tldraw'
import { buildImageShapeRecords } from './placement.js'
import { studioJSON } from './studioBridge.js'

function loadSize(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth || 512, height: image.naturalHeight || 512 })
    image.onerror = () => reject(Error('无法读取原图'))
    image.src = url
  })
}

export async function importLegacyStudioNodes(editor, projectId) {
  if (!editor) throw new Error('画布尚未就绪')
  const [data, historyData] = await Promise.all([
    studioJSON('/api/projects/' + encodeURIComponent(projectId)),
    studioJSON('/api/history?projectId=' + encodeURIComponent(projectId))
  ])
  const project = data.project
  if (project?.id !== projectId || !Array.isArray(project.nodes)) throw Error('无法读取当前项目旧画布')
  const history = new Map((historyData.history || []).map(h => [h.id, h]))
  const existing = new Set(Object.values(editor.store.getStoreSnapshot().store)
    .filter(x => x.typeName === 'shape' && x.meta?.studioNodeId)
    .map(x => x.meta.studioNodeId))
  const pageId = editor.getCurrentPageId()
  let imported = 0
  let skipped = 0
  const LIMIT = 250
  const processed = new Set()
  for (const node of project.nodes) {
    if (existing.has(node.id)) continue
    if (processed.size >= LIMIT) break
    processed.add(node.id)
    try {
      if (node.kind === 'note') {
        editor.createShape({
          id: createShapeId(), type: 'text',
          x: Number(node.x) || 0, y: Number(node.y) || 0,
          meta: { studioNodeId: node.id, studioProjectId: projectId, studioOrigin: 'legacy-note' },
          props: { richText: toRichText(String(node.text || '').slice(0, 1500)),
            color: 'black', size: 'm', font: 'sans', textAlign: 'start',
            w: Math.max(160, Math.min(900, Number(node.w) || 250)), autoSize: true, scale: 1 }
        })
        imported++
        continue
      }
      const generated = node.kind === 'generated' ? history.get(node.historyId) : null
      const url = node.kind === 'reference' ? node.url : generated?.url
      if (!url || !/^\/api\/media\/[a-f0-9-]{36}\.(?:png|jpg|webp)$/.test(url)) {
        skipped++
        continue
      }
      const dimensions = await loadSize(url)
      const existingStore = editor.store.getStoreSnapshot().store
      const displayWidth = Math.max(90, Math.min(1400, Number(node.w) || 288))
      const displayHeight = Math.max(90, Math.min(1400, Number(node.h) || Math.round(displayWidth * dimensions.height / dimensions.width)))
      const records = buildImageShapeRecords({
        store: existingStore, pageId, parentId: pageId,
        imageSize: dimensions, displayWidth, displayHeight,
        matchAnchor: false, dataUrl: url,
        mimeType: url.endsWith('.webp') ? 'image/webp' : url.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
        altText: node.title || generated?.prompt || 'Studio 历史素材',
        shapeMeta: { studioNodeId: node.id, studioHistoryId: node.historyId || null,
          studioProjectId: projectId, studioOrigin: 'legacy-project' }
      })
      delete records.assetRecord.props.fileSize
      records.shapeRecord.x = Number(node.x) || 0
      records.shapeRecord.y = Number(node.y) || 0
      editor.store.put([records.assetRecord, records.shapeRecord])
      imported++
    } catch (error) {
      console.warn('[Hamoki legacy import]', node.id, String(error))
      skipped++
    }
  }
  return { imported, skipped, more: project.nodes.some(node => !existing.has(node.id) && !processed.has(node.id)), total: project.nodes.length }
}

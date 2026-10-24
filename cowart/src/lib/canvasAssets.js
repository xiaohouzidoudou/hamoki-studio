import { getStudioContext, studioJSON } from './studioBridge.js'

export async function uploadCanvasAssets(snapshot) {
  const { projectId } = await getStudioContext()
  const store = { ...snapshot.store }
  const replacements = []
  const uploads = new Map()
  for (const [id, asset] of Object.entries(store)) {
    const src = asset?.props?.src
    if (asset?.typeName !== 'asset' || asset.type !== 'image' ||
        typeof src !== 'string' || !/^(?:blob:|data:)/.test(src)) continue
    if (!uploads.has(src)) {
      const response = await fetch(src)
      if (!response.ok) throw new Error('无法读取导入图片，当前画布尚未保存')
      const blob = await response.blob()
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type))
        throw new Error('保存图片仅支持 PNG、JPG、WebP')
      if (blob.size > 12 * 1024 * 1024) throw new Error('单张图片需小于 12MB，请压缩后重试')
      const result = await studioJSON('/api/cowart/assets?projectId=' + encodeURIComponent(projectId), {
        method: 'POST', headers: { 'Content-Type': blob.type }, body: blob
      })
      if (!/^\/api\/media\/[a-f0-9-]{36}\.(?:png|jpg|webp)$/.test(result.url))
        throw new Error('服务器返回了无效的图片地址，当前画布尚未保存')
      uploads.set(src, result.url)
    }
    const url = uploads.get(src)
    store[id] = { ...asset, props: { ...asset.props, src: url } }
    replacements.push({ id, src, url })
  }
  return { snapshot: { ...snapshot, store }, replacements }
}

// Commit URLs only after the snapshot save succeeds, and never overwrite an
// asset replaced/deleted while upload was in flight. Remote changes don't start
// another user-save loop; server and live asset now describe the same image.
export function applySavedAssetSources(editor, replacements = []) {
  editor.store.mergeRemoteChanges(() => {
    for (const { id, src, url } of replacements) {
      const asset = editor.getAsset(id)
      if (asset?.props?.src === src) editor.updateAssets([{ id, type: asset.type, props: { ...asset.props, src: url } }])
    }
  })
}

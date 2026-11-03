// A small uncompressed ZIP writer for user-selected original images.
// UTF-8 filenames, standard CRC32, bounded downloads; no server credentials.
import { safeImageSource } from './model.js'
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
export function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
export function zipFiles(files) {
  const locals = [],
    central = []
  let offset = 0,
    total = 0
  for (const file of files) {
    const bytes = file.bytes,
      name = new TextEncoder().encode(file.name),
      crc = crc32(bytes),
      local = new Uint8Array(30 + name.length),
      v = new DataView(local.buffer)
    v.setUint32(0, 0x04034b50, true)
    v.setUint16(4, 20, true)
    v.setUint16(6, 0x800, true)
    v.setUint16(12, 33, true)
    v.setUint32(14, crc, true)
    v.setUint32(18, bytes.length, true)
    v.setUint32(22, bytes.length, true)
    v.setUint16(26, name.length, true)
    local.set(name, 30)
    locals.push(local, bytes)
    const entry = new Uint8Array(46 + name.length),
      c = new DataView(entry.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x800, true)
    c.setUint16(14, 33, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, bytes.length, true)
    c.setUint32(24, bytes.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    entry.set(name, 46)
    central.push(entry)
    total += entry.length
    offset += local.length + bytes.length
  }
  const end = new Uint8Array(22),
    v = new DataView(end.buffer)
  v.setUint32(0, 0x06054b50, true)
  v.setUint16(8, files.length, true)
  v.setUint16(10, files.length, true)
  v.setUint32(12, total, true)
  v.setUint32(16, offset, true)
  return new Blob([...locals, ...central, end], { type: 'application/zip' })
}
export async function originalImagesZip(editor) {
  const selected = new Set(editor.getSelectedShapeIds())
  let changed = true
  while (changed) {
    changed = false
    for (const s of editor.getCurrentPageShapes())
      if (selected.has(s.parentId) && !selected.has(s.id)) {
        selected.add(s.id)
        changed = true
      }
  }
  const images = editor
    .getCurrentPageShapes()
    .filter((s) => selected.has(s.id) && s.type === 'image')
  if (!images.length) return null
  if (images.length > 20) throw Error('每次最多下载 20 张原图')
  const files = []
  let bytes = 0
  for (const [index, shape] of images.entries()) {
    const asset = editor.getAsset(shape.props.assetId)
    const src = safeImageSource(asset?.props?.src)
    if (!src) throw Error('原图地址无法读取')
    const response = await fetch(src)
    if (!response.ok) throw Error('原图下载失败，请重试')
    const data = new Uint8Array(await response.arrayBuffer())
    bytes += data.length
    if (bytes > 100 * 1024 * 1024) throw Error('所选原图超过 100MB，请分批下载')
    const name = (asset.props.name || 'hamoki.png')
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .slice(-100)
    files.push({
      name: String(index + 1).padStart(2, '0') + '-' + name,
      bytes: data,
    })
  }
  return images.length === 1
    ? {
        blob: new Blob([files[0].bytes], {
          type:
            editor.getAsset(images[0].props.assetId).props.mimeType ||
            'image/png',
        }),
        name: files[0].name,
      }
    : { blob: zipFiles(files), name: 'hamoki-originals.zip' }
}

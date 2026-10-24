// Export the same SVG content that is visible in the editor. All image bytes
// are embedded before serialization, so exported files do not depend on cookies.
export async function exportSvg(editor, ids, options = {}) {
  const include = new Set(ids),
    all = editor.getCurrentPageShapes()
  let changed = true
  while (changed) {
    changed = false
    for (const s of all)
      if (include.has(s.parentId) && !include.has(s.id)) {
        include.add(s.id)
        changed = true
      }
  }
  const selected = all.filter((s) => include.has(s.id)),
    boxes = selected.map((s) => editor.getShapePageBounds(s)).filter(Boolean)
  if (!boxes.length) throw Error('没有可导出的元素')
  const padding = options.padding ?? 16,
    x = Math.min(...boxes.map((b) => b.x)) - padding,
    y = Math.min(...boxes.map((b) => b.y)) - padding,
    w = Math.max(...boxes.map((b) => b.x + b.w)) - x + padding,
    h = Math.max(...boxes.map((b) => b.y + b.h)) - y + padding
  if (!Number.isFinite(w + h) || w <= 0 || h <= 0) throw Error('导出范围无效')
  const ns = 'http://www.w3.org/2000/svg',
    svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('xmlns', ns)
  svg.setAttribute('width', String(w))
  svg.setAttribute('height', String(h))
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`)
  const board = editor.getContainer().querySelector('.hamoki-board'),
    defs = board?.querySelector('defs')
  if (!board) throw Error('画布尚未渲染，请稍后重试')
  if (defs) svg.append(defs.cloneNode(true))
  if (options.background !== false) {
    const rect = document.createElementNS(ns, 'rect')
    for (const [key, value] of Object.entries({
      x,
      y,
      width: w,
      height: h,
      fill: '#101a17',
    }))
      rect.setAttribute(key, value)
    svg.append(rect)
  }
  for (const s of selected) {
    const group = [...board.querySelectorAll('[data-shape-id]')]
      .find((g) => g.dataset.shapeId === s.id)
      ?.cloneNode(true)
    if (!group) continue
    group.querySelectorAll('foreignObject').forEach((el) => el.remove())
    group
      .querySelectorAll('[data-selection-decoration]')
      .forEach((el) => el.remove())
    svg.append(group)
  }
  let embedded = 0
  for (const image of svg.querySelectorAll('image')) {
    const src = image.getAttribute('href')
    if (!src) continue
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(src)) {
      const response = await fetch(src, { credentials: 'same-origin' })
      if (!response.ok) throw Error('导出时原图读取失败')
      const blob = await response.blob()
      embedded += blob.size
      if (embedded > 100 * 1024 * 1024)
        throw Error('导出图片合计超过 100MB，请分批导出')
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      image.setAttribute('href', data)
    }
  }
  return {
    text: new XMLSerializer().serializeToString(svg),
    width: w,
    height: h,
  }
}
export async function rasterSvg(editor, ids, options = {}) {
  const result = await exportSvg(editor, ids, options),
    scale = Math.min(
      options.pixelRatio || 1,
      4096 / Math.max(result.width, result.height),
    ),
    canvas = document.createElement('canvas'),
    image = new Image(),
    url = URL.createObjectURL(
      new Blob([result.text], { type: 'image/svg+xml;charset=utf-8' }),
    )
  canvas.width = Math.max(1, Math.ceil(result.width * scale))
  canvas.height = Math.max(1, Math.ceil(result.height * scale))
  try {
    image.src = url
    await image.decode()
    const ctx = canvas.getContext('2d')
    if (!ctx) throw Error('浏览器无法导出图片')
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return {
      url: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}
export function downloadFile(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
export function originalSourceMatches(shape, editor) {
  const p = shape?.props || {},
    crop = p.crop
  let current = shape
  const seen = new Set()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (
      current.rotation ||
      current.skewX ||
      (current.scaleX ?? 1) !== 1 ||
      (current.scaleY ?? 1) !== 1
    )
      return false
    current = editor?.getShape(current.parentId)
  }
  return (
    !p.flipX &&
    !p.flipY &&
    !shape.rotation &&
    (!crop ||
      (crop.topLeft?.x === 0 &&
        crop.topLeft?.y === 0 &&
        crop.bottomRight?.x === 1 &&
        crop.bottomRight?.y === 1))
  )
}

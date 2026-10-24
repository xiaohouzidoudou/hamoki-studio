// Hamoki's independent canvas document engine. No third-party editor code.
// The record envelope is retained solely to read existing Studio documents.
import { generateKeyBetween } from 'fractional-indexing'
export const createShapeId = () => 'shape:' + crypto.randomUUID()
export const toRichText = (text) => ({
  type: 'doc',
  content: String(text)
    .split('\n')
    .map((text) => ({
      type: 'paragraph',
      content: text ? [{ type: 'text', text }] : [],
    })),
})
export function plainText(value, depth = 0) {
  if (depth > 16) return ''
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  if (value.type === 'text') return String(value.text || '')
  return (Array.isArray(value.content) ? value.content : [])
    .map((item) => plainText(item, depth + 1))
    .join(value.type === 'doc' ? '\n' : '')
}
const clone = (value) => structuredClone(value)
const finite = (n, fallback = 0) => (Number.isFinite(n) ? n : fallback)
const identity = [1, 0, 0, 1, 0, 0]
export function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}
export function transform(m, p) {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  }
}
export function inverse(m) {
  const d = m[0] * m[3] - m[1] * m[2]
  if (!d) throw Error('无效的元素变换')
  return [
    m[3] / d,
    -m[1] / d,
    -m[2] / d,
    m[0] / d,
    (m[2] * m[5] - m[3] * m[4]) / d,
    (m[1] * m[4] - m[0] * m[5]) / d,
  ]
}
export function shapeMatrix(store, shape, seen = new Set()) {
  if (!shape || seen.has(shape.id)) return identity
  seen.add(shape.id)
  const r = finite(shape.rotation),
    c = Math.cos(r),
    s = Math.sin(r)
  const sx = finite(shape.scaleX, 1),
    sy = finite(shape.scaleY, 1)
  const local = [
    c * sx,
    s * sx,
    -s * sy,
    c * sy,
    finite(shape.x),
    finite(shape.y),
  ]
  const parent = store[shape.parentId]
  return parent?.typeName === 'shape'
    ? multiply(shapeMatrix(store, parent, seen), local)
    : local
}
export function localBounds(shape) {
  const p = shape.props || {}
  if (shape.type === 'arrow') {
    const a = p.start || { x: 0, y: 0 },
      b = p.end || { x: 160, y: 0 }
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.max(1, Math.abs(a.x - b.x)),
      h: Math.max(1, Math.abs(a.y - b.y)),
    }
  }
  return {
    x: 0,
    y: 0,
    w: Math.max(1, finite(p.w, shape.type === 'text' ? 240 : 160)),
    h: Math.max(
      1,
      finite(
        p.h,
        shape.type === 'text'
          ? Math.max(
              40,
              plainText(p.richText || p.text).split('\n').length * 28,
            )
          : 120,
      ),
    ),
  }
}
export function shapeBounds(store, shape) {
  if (!shape) return null
  if (shape.type === 'group') {
    const children = Object.values(store).filter(
      (s) => s.typeName === 'shape' && s.parentId === shape.id,
    )
    if (children.length)
      return union(children.map((s) => shapeBounds(store, s)).filter(Boolean))
  }
  const b = localBounds(shape),
    m = shapeMatrix(store, shape),
    points = [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x, b.y + b.h],
      [b.x + b.w, b.y + b.h],
    ].map(([x, y]) => transform(m, { x, y }))
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y))
  return {
    x,
    y,
    w: Math.max(...points.map((p) => p.x)) - x,
    h: Math.max(...points.map((p) => p.y)) - y,
  }
}
export function union(bounds) {
  if (!bounds.length) return null
  const x = Math.min(...bounds.map((b) => b.x)),
    y = Math.min(...bounds.map((b) => b.y))
  const w = Math.max(...bounds.map((b) => b.x + b.w)) - x,
    h = Math.max(...bounds.map((b) => b.y + b.h)) - y
  return { x, y, w, h, center: { x: x + w / 2, y: y + h / 2 } }
}
export function intersects(a, b) {
  return (
    !!a &&
    !!b &&
    a.x <= b.x + b.w &&
    b.x <= a.x + a.w &&
    a.y <= b.y + b.h &&
    b.y <= a.y + a.h
  )
}
export function safeImageSource(src) {
  if (typeof src !== 'string') return null
  if (
    /^data:image\/(png|jpeg|webp);base64,/.test(src) ||
    src.startsWith('blob:')
  )
    return src
  if (/^\/api\/media\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(src)) return src
  return null
}
export const colors = {
  black: '#dae8e0',
  grey: '#9aaea5',
  green: '#55b58a',
  red: '#f28280',
  yellow: '#edcf76',
  blue: '#79aee8',
  violet: '#b8a3dd',
  white: '#f3faf6',
  orange: '#e9a16a',
}
export function shapeColor(shape) {
  return (
    colors[shape.props?.color] ||
    (/^#[a-f0-9]{3,8}$/i.test(shape.props?.color || '')
      ? shape.props.color
      : colors.green)
  )
}
export class CanvasDocument {
  constructor(snapshot, container) {
    this.schema = { ...(snapshot?.schema || {}), hamokiCanvas: 1 }
    this.records = { ...(snapshot?.store || {}) }
    this.container = container
    this.listeners = new Set()
    this.selected = []
    this.camera = { x: 0, y: 0, z: 1 }
    this.tool = 'select'
    this.pageId =
      Object.values(this.records).find((r) => r.typeName === 'page')?.id ||
      'page:main'
    this.history = []
    this.future = []
    this.remote = false
    this.gesture = null
    this.revision = 0
    this.disposed = false
    if (!this.records[this.pageId])
      this.records[this.pageId] = {
        id: this.pageId,
        typeName: 'page',
        name: '画布 1',
        index: 'a1',
        meta: {},
      }
    this.store = {
      getStoreSnapshot: () => ({
        schema: clone(this.schema),
        store: { ...this.records },
      }),
      get: (id) => this.records[id],
      put: (records) => this.put(records),
      listen: (fn, filter = {}) => {
        const item = { fn, filter }
        this.listeners.add(item)
        return () => this.listeners.delete(item)
      },
      mergeRemoteChanges: (fn) => {
        const prev = this.remote
        this.remote = true
        try {
          fn()
        } finally {
          this.remote = prev
        }
      },
    }
    this.user = { getIsDarkMode: () => true, updateUserPreferences: () => {} }
    this.timers = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      requestAnimationFrame: (fn) => requestAnimationFrame(fn),
    }
  }
  notify(scope = 'document') {
    this.revision++
    const event = { source: this.remote ? 'remote' : 'user', scope }
    for (const { fn, filter } of this.listeners) {
      if (
        filter.source &&
        filter.source !== 'all' &&
        filter.source !== event.source
      )
        continue
      if (filter.scope && filter.scope !== 'all' && filter.scope !== scope)
        continue
      fn(event)
    }
  }
  checkpoint() {
    if (!this.remote && !this.gesture) {
      this.history.push({ ...this.records })
      if (this.history.length > 60) this.history.shift()
      this.future = []
    }
  }
  beginGesture() {
    if (!this.gesture) this.gesture = { ...this.records }
  }
  endGesture() {
    if (this.gesture) {
      if (
        Object.keys(this.records).some(
          (id) => this.records[id] !== this.gesture[id],
        ) ||
        Object.keys(this.records).length !== Object.keys(this.gesture).length
      ) {
        this.history.push(this.gesture)
        if (this.history.length > 60) this.history.shift()
        this.future = []
      }
      this.gesture = null
      this.notify('session')
    }
  }
  undo() {
    this.endGesture()
    if (!this.history.length) return
    this.future.push({ ...this.records })
    this.records = this.history.pop()
    this.selected = this.selected.filter((id) => this.records[id])
    this.notify()
  }
  redo() {
    if (!this.future.length) return
    this.history.push({ ...this.records })
    this.records = this.future.pop()
    this.selected = this.selected.filter((id) => this.records[id])
    this.notify()
  }
  put(records) {
    if (!records.length) return
    this.checkpoint()
    for (const r of records) {
      if (!r || typeof r.id !== 'string') throw Error('无效的画布记录')
      this.records[r.id] = clone(r)
    }
    this.notify()
  }
  getContainer() {
    return this.container
  }
  getCurrentPageId() {
    return this.pageId
  }
  getPages() {
    return Object.values(this.records).filter((r) => r.typeName === 'page')
  }
  createPage(page = {}) {
    const p = {
      id: page.id || 'page:' + crypto.randomUUID(),
      typeName: 'page',
      index: 'a1',
      name: '新画布',
      meta: {},
      ...page,
    }
    this.put([p])
    return this
  }
  setCurrentPage(id) {
    if (this.records[id]?.typeName !== 'page') return this
    this.pageId = id
    this.selected = []
    this.notify('session')
    return this
  }
  getCurrentPageShapes() {
    const list = Object.values(this.records)
      .filter((s) => {
        if (s.typeName !== 'shape') return false
        const visited = new Set()
        let p = s
        while (p && !visited.has(p.id)) {
          if (p.parentId === this.pageId) return true
          visited.add(p.id)
          p = this.records[p.parentId]
        }
        return false
      })
      .sort((a, b) => String(a.index).localeCompare(String(b.index)))
    const ordered = []
    const visit = (parent) => {
      for (const s of list.filter((s) => s.parentId === parent)) {
        ordered.push(s)
        visit(s.id)
      }
    }
    visit(this.pageId)
    return ordered
  }
  getCurrentPageShapeIds() {
    return new Set(this.getCurrentPageShapes().map((s) => s.id))
  }
  getShape(id) {
    return this.records[typeof id === 'string' ? id : id?.id]
  }
  getAsset(id) {
    return this.records[id]
  }
  getSelectedShapeIds() {
    return [...this.selected]
  }
  getSelectedShapes() {
    return this.selected.map((id) => this.getShape(id)).filter(Boolean)
  }
  select(...ids) {
    this.selected = [...new Set(ids.flat())].filter(
      (id) => this.records[id]?.typeName === 'shape',
    )
    this.notify('session')
    return this
  }
  selectNone() {
    return this.select()
  }
  selectAll() {
    return this.select(
      ...this.getCurrentPageShapes()
        .filter((s) => s.parentId === this.pageId)
        .map((s) => s.id),
    )
  }
  nextIndex(parentId = this.pageId, previous = null) {
    const keys = Object.values(this.records)
      .filter((s) => s.typeName === 'shape' && s.parentId === parentId)
      .map((s) => s.index)
      .filter((k) => {
        try {
          generateKeyBetween(k, null)
          return true
        } catch {
          return false
        }
      })
      .sort()
    return generateKeyBetween(previous || keys.at(-1) || null, null)
  }
  bringToFront() {
    let index = this.nextIndex()
    this.updateShapes(
      this.getSelectedShapes().map((s) => {
        const next = { id: s.id, index }
        index = generateKeyBetween(index, null)
        return next
      }),
    )
  }
  createAssets(items) {
    this.put(items.map((a) => ({ typeName: 'asset', meta: {}, ...a })))
    return this
  }
  createShape(input) {
    return this.createShapes([input])
  }
  createShapes(inputs) {
    const records = inputs.map((input) => {
      const siblings = Object.values(this.records)
        .filter(
          (s) =>
            s.typeName === 'shape' &&
            s.parentId === (input.parentId || this.pageId),
        )
        .map((s) => s.index)
        .filter(Boolean)
        .sort()
      return {
        id: createShapeId(),
        typeName: 'shape',
        x: 0,
        y: 0,
        rotation: 0,
        isLocked: false,
        opacity: 1,
        parentId: this.pageId,
        index: this.nextIndex(input.parentId || this.pageId),
        meta: {},
        ...input,
        props: {
          w: input.type === 'text' ? 240 : 180,
          h: input.type === 'text' ? 60 : 120,
          ...input.props,
        },
      }
    })
    this.put(records)
    return this
  }
  updateShape(input) {
    return this.updateShapes([input])
  }
  updateShapes(items) {
    const records = items
      .map((next) => {
        const old = this.records[next.id]
        return old
          ? {
              ...old,
              ...next,
              props: { ...old.props, ...next.props },
              meta: { ...old.meta, ...next.meta },
            }
          : null
      })
      .filter(Boolean)
    this.put(records)
    return this
  }
  updateAssets(items) {
    return this.updateShapes(items)
  }
  deleteShapes(ids) {
    const remove = new Set(ids)
    let changed = true
    while (changed) {
      changed = false
      for (const s of Object.values(this.records)) {
        if (remove.has(s.parentId) && !remove.has(s.id)) {
          remove.add(s.id)
          changed = true
        }
      }
    }
    if (!remove.size) return
    this.checkpoint()
    for (const id of remove) delete this.records[id]
    this.selected = this.selected.filter((id) => !remove.has(id))
    this.notify()
  }
  deleteAssets(ids) {
    this.checkpoint()
    for (const id of ids) delete this.records[id]
    this.notify()
  }
  markHistoryStoppingPoint() {
    return this
  }
  getShapePageBounds(shape) {
    return shapeBounds(this.records, this.getShape(shape))
  }
  hitTest(point) {
    for (const shape of this.getCurrentPageShapes().slice().reverse()) {
      if (shape.type === 'group') continue
      const local = transform(inverse(shapeMatrix(this.records, shape)), point),
        b = localBounds(shape)
      if (
        local.x >= b.x &&
        local.x <= b.x + b.w &&
        local.y >= b.y - 12 &&
        local.y <= b.y + b.h
      )
        return shape
    }
    return null
  }
  getSelectionPageBounds() {
    return union(
      this.getSelectedShapes()
        .map((s) => this.getShapePageBounds(s))
        .filter(Boolean),
    )
  }
  getShapeUtil(shape) {
    return { isAspectRatioLocked: () => !!shape.meta?.cowartAiAspectLocked }
  }
  getResizeScaleFactor() {
    return 1 / this.camera.z
  }
  getCamera() {
    return { ...this.camera }
  }
  setCamera(camera) {
    this.camera = {
      x: finite(camera.x),
      y: finite(camera.y),
      z: Math.max(0.08, Math.min(8, finite(camera.z, 1))),
    }
    this.notify('session')
    return this
  }
  pageToScreen(point) {
    const r = this.container.getBoundingClientRect(),
      c = this.camera
    return {
      x: r.left + (point.x + c.x) * c.z,
      y: r.top + (point.y + c.y) * c.z,
    }
  }
  screenToPage(point) {
    const r = this.container.getBoundingClientRect(),
      c = this.camera
    return {
      x: (point.x - r.left) / c.z - c.x,
      y: (point.y - r.top) / c.z - c.y,
    }
  }
  getViewportPageBounds() {
    const r = this.container.getBoundingClientRect(),
      c = this.camera
    const b = { x: -c.x, y: -c.y, w: r.width / c.z, h: r.height / c.z }
    return { ...b, center: { x: b.x + b.w / 2, y: b.y + b.h / 2 } }
  }
  zoomAt(point, factor) {
    const p = this.screenToPage(point),
      r = this.container.getBoundingClientRect(),
      z = Math.max(0.08, Math.min(8, this.camera.z * factor))
    return this.setCamera({
      z,
      x: (point.x - r.left) / z - p.x,
      y: (point.y - r.top) / z - p.y,
    })
  }
  zoomToFit() {
    const b = union(
      this.getCurrentPageShapes()
        .map((s) => this.getShapePageBounds(s))
        .filter(Boolean),
    )
    if (!b) return
    const r = this.container.getBoundingClientRect(),
      z = Math.max(
        0.08,
        Math.min(
          1.5,
          (r.width - 120) / Math.max(1, b.w),
          (r.height - 170) / Math.max(1, b.h),
        ),
      )
    this.setCamera({
      z,
      x: (r.width / z - b.w) / 2 - b.x,
      y: (r.height / z - b.h) / 2 - b.y,
    })
  }
  setCurrentTool(tool) {
    this.tool = tool.split('.')[0]
    this.notify('session')
    return this
  }
  isIn(tool) {
    return this.tool === tool.split('.')[0] && !tool.includes('crop')
  }
  canEditShape(shape) {
    return !shape.isLocked
  }
  duplicateSelected() {
    const originals = this.getSelectedShapes(),
      map = new Map()
    const visit = (s) => {
      if (map.has(s.id)) return
      map.set(s.id, createShapeId())
      for (const c of Object.values(this.records).filter(
        (c) => c.typeName === 'shape' && c.parentId === s.id,
      ))
        visit(c)
    }
    originals.forEach(visit)
    const roots = new Set(originals.map((s) => s.id))
    this.put(
      [...map].map(([id, newId]) => {
        const s = clone(this.records[id])
        return {
          ...s,
          id: newId,
          parentId: map.get(s.parentId) || s.parentId,
          x: s.x + (roots.has(id) ? 30 : 0),
          y: s.y + (roots.has(id) ? 30 : 0),
        }
      }),
    )
    this.select(...originals.map((s) => map.get(s.id)))
  }
  groupSelected() {
    const roots = this.getSelectedShapes().filter(
      (s) => !this.selected.includes(s.parentId),
    )
    if (roots.length < 2 || new Set(roots.map((s) => s.parentId)).size !== 1)
      throw Error('请选择同一层级的至少两个元素')
    const parentId = roots[0].parentId,
      b = this.getSelectionPageBounds(),
      parent = this.records[parentId],
      origin =
        parent?.typeName === 'shape'
          ? transform(inverse(shapeMatrix(this.records, parent)), b)
          : b
    const id = createShapeId()
    this.beginGesture()
    this.createShape({
      id,
      type: 'group',
      parentId,
      x: origin.x,
      y: origin.y,
      props: { w: b.w, h: b.h },
    })
    this.updateShapes(
      roots.map((s) => ({
        id: s.id,
        x: s.x - origin.x,
        y: s.y - origin.y,
        parentId: id,
      })),
    )
    this.endGesture()
    this.select(id)
  }
  ungroupSelected() {
    this.beginGesture()
    const ids = []
    for (const group of this.getSelectedShapes().filter(
      (s) => s.type === 'group',
    )) {
      const m = shapeMatrix(this.records, group),
        parent = this.records[group.parentId],
        pm =
          parent?.typeName === 'shape'
            ? inverse(shapeMatrix(this.records, parent))
            : identity
      for (const s of Object.values(this.records).filter(
        (s) => s.parentId === group.id && s.typeName === 'shape',
      )) {
        const t = multiply(
          pm,
          multiply(m, [
            Math.cos(s.rotation || 0),
            Math.sin(s.rotation || 0),
            -Math.sin(s.rotation || 0),
            Math.cos(s.rotation || 0),
            s.x,
            s.y,
          ]),
        )
        this.updateShape({
          id: s.id,
          parentId: group.parentId,
          x: t[4],
          y: t[5],
          rotation: Math.atan2(t[1], t[0]),
          scaleX: Math.hypot(t[0], t[1]),
          scaleY: Math.hypot(t[2], t[3]),
        })
        ids.push(s.id)
      }
      this.deleteShapes([group.id])
    }
    this.endGesture()
    this.select(...ids)
  }
  async toImageDataUrl(ids, options = {}) {
    const selected = ids.map((id) => this.getShape(id)).filter(Boolean),
      all = new Set(ids)
    let changed = true
    while (changed) {
      changed = false
      for (const s of this.getCurrentPageShapes())
        if (all.has(s.parentId) && !all.has(s.id)) {
          all.add(s.id)
          changed = true
        }
    }
    const shapes = this.getCurrentPageShapes().filter((s) => all.has(s.id)),
      bounds = union(
        selected.map((s) => this.getShapePageBounds(s)).filter(Boolean),
      )
    if (!bounds) throw Error('没有可导出的元素')
    const scale = Math.min(
        options.pixelRatio || 1,
        4096 / Math.max(bounds.w, bounds.h),
      ),
      canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(bounds.w * scale))
    canvas.height = Math.max(1, Math.ceil(bounds.h * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw Error('浏览器无法导出图片')
    ctx.scale(scale, scale)
    ctx.translate(-bounds.x, -bounds.y)
    if (options.background !== false) {
      ctx.fillStyle = '#101a17'
      ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h)
    }
    for (const s of shapes) {
      const p = s.props || {},
        b = localBounds(s),
        m = shapeMatrix(this.records, s)
      ctx.save()
      ctx.transform(...m)
      ctx.globalAlpha = finite(s.opacity, 1)
      ctx.strokeStyle = shapeColor(s)
      ctx.fillStyle = shapeColor(s)
      ctx.lineWidth = 2
      if (s.type === 'image') {
        const src = safeImageSource(this.getAsset(p.assetId)?.props?.src)
        if (!src) throw Error('原图地址不可读取')
        const image = new Image()
        image.src = src
        await image.decode()
        const crop = p.crop
        if (crop?.topLeft && crop?.bottomRight) {
          const tl = crop.topLeft,
            br = crop.bottomRight
          ctx.drawImage(
            image,
            tl.x * image.width,
            tl.y * image.height,
            (br.x - tl.x) * image.width,
            (br.y - tl.y) * image.height,
            0,
            0,
            b.w,
            b.h,
          )
        } else ctx.drawImage(image, 0, 0, b.w, b.h)
      } else if (s.type === 'text' || s.type === 'note') {
        ctx.font =
          (p.fontSize || { s: 16, m: 22, l: 30, xl: 40 }[p.size] || 22) +
          'px sans-serif'
        ctx.textBaseline = 'top'
        const lines = plainText(p.richText || p.text).split('\n')
        lines.forEach((line, i) => ctx.fillText(line, 0, i * 28, b.w))
      } else if (s.type === 'arrow') {
        const a = p.start || { x: 0, y: 0 },
          e = p.end || { x: b.w, y: b.h }
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(e.x, e.y)
        ctx.stroke()
        const r = Math.atan2(e.y - a.y, e.x - a.x)
        ctx.beginPath()
        ctx.moveTo(e.x, e.y)
        ctx.lineTo(e.x - 14 * Math.cos(r - 0.45), e.y - 14 * Math.sin(r - 0.45))
        ctx.lineTo(e.x - 14 * Math.cos(r + 0.45), e.y - 14 * Math.sin(r + 0.45))
        ctx.closePath()
        ctx.fill()
        const text = plainText(p.richText || p.text)
        if (text) {
          ctx.font = '18px sans-serif'
          ctx.fillText(text, (a.x + e.x) / 2, (a.y + e.y) / 2 - 12)
        }
      } else if (s.type !== 'group') {
        if (p.geo === 'ellipse') {
          ctx.beginPath()
          ctx.ellipse(b.w / 2, b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2)
          if (p.fill !== 'none') ctx.fill()
          ctx.stroke()
        } else {
          if (p.fill !== 'none' && s.type !== 'frame') {
            ctx.globalAlpha *= 0.2
            ctx.fillRect(0, 0, b.w, b.h)
            ctx.globalAlpha = finite(s.opacity, 1)
          }
          ctx.strokeRect(0, 0, b.w, b.h)
        }
      }
      ctx.restore()
    }
    return {
      url: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    }
  }
}

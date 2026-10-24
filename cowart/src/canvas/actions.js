import { sanitizeCanvasSnapshot } from '../canvasSnapshot.js'
import { generateKeyBetween } from 'fractional-indexing'
// Install document actions without coupling the geometry engine to browser UI.
export function installCanvasActions(
  Document,
  {
    shapeMatrix,
    inverse,
    transform,
    union,
    createShapeId,
    arrowEndpoints,
    multiply,
    decompose,
  },
) {
  const p = Document.prototype
  p.transaction = function (fn) {
    const outer = !!this.gesture
    if (!outer) this.beginGesture()
    try {
      return fn()
    } finally {
      if (!outer) this.endGesture()
    }
  }
  p.frameSelection = function () {
    const roots = this.roots(),
      b = union(roots.map((s) => this.getShapePageBounds(s)))
    if (!b) return
    const id = createShapeId()
    this.transaction(() => {
      this.createShape({
        id,
        type: 'frame',
        x: b.x - 24,
        y: b.y - 24,
        props: {
          w: b.w + 48,
          h: b.h + 48,
          name: '框架',
          color: 'grey',
          fill: 'none',
        },
      })
      this.updateShapes(
        roots.map((s) => {
          const m = shapeMatrix(this.records, s)
          return {
            id: s.id,
            parentId: id,
            x: m[4] - b.x + 24,
            y: m[5] - b.y + 24,
            ...decompose([
              m[0],
              m[1],
              m[2],
              m[3],
              m[4] - b.x + 24,
              m[5] - b.y + 24,
            ]),
          }
        }),
      )
    })
    this.select(id)
  }
  p.removeFrames = function () {
    this.transaction(() => {
      const frames = this.roots().filter((s) => s.type === 'frame')
      for (const frame of frames) {
        this.updateShape({ id: frame.id, type: 'group' })
        this.select(frame.id)
        this.ungroupSelected()
      }
    })
  }
  p.fitFrames = function () {
    this.transaction(() => {
      for (const frame of this.roots().filter((s) => s.type === 'frame')) {
        const children = Object.values(this.records).filter(
            (s) => s.typeName === 'shape' && s.parentId === frame.id,
          ),
          m = shapeMatrix(this.records, frame),
          im = inverse(m)
        if (!children.length) continue
        const corners = children.flatMap((s) => {
            const b = this.getShapePageBounds(s)
            return [
              { x: b.x, y: b.y },
              { x: b.x + b.w, y: b.y + b.h },
            ].map((p) => transform(im, p))
          }),
          x = Math.min(...corners.map((p) => p.x)) - 16,
          y = Math.min(...corners.map((p) => p.y)) - 16,
          w = Math.max(...corners.map((p) => p.x)) - x + 16,
          h = Math.max(...corners.map((p) => p.y)) - y + 16,
          local = this.translateShape(
            frame,
            m[0] * x + m[2] * y,
            m[1] * x + m[3] * y,
          )
        this.updateShape({ id: frame.id, ...local, props: { w, h } })
        this.updateShapes(
          children.map((s) => ({ id: s.id, x: s.x - x, y: s.y - y })),
        )
      }
    })
  }
  p.selectionRoots = function (includeLocked = false) {
    const ids = new Set(this.selected)
    return this.getSelectedShapes().filter((s) => {
      if (!includeLocked && s.isLocked) return false
      const seen = new Set()
      let parent = this.records[s.parentId]
      while (parent?.typeName === 'shape' && !seen.has(parent.id)) {
        if (ids.has(parent.id) || (!includeLocked && parent.isLocked))
          return false
        seen.add(parent.id)
        parent = this.records[parent.parentId]
      }
      return true
    })
  }
  p.roots = function () {
    return this.selectionRoots(false)
  }
  p.transformShape = function (s, matrix) {
    const parent = this.records[s.parentId],
      parentInverse =
        parent?.typeName === 'shape'
          ? inverse(shapeMatrix(this.records, parent))
          : [1, 0, 0, 1, 0, 0]
    return {
      id: s.id,
      ...decompose(
        multiply(parentInverse, multiply(matrix, shapeMatrix(this.records, s))),
      ),
    }
  }
  p.translateShape = function (s, dx, dy) {
    const parent = this.getShape(s.parentId),
      m =
        parent?.typeName === 'shape'
          ? inverse(shapeMatrix(this.records, parent))
          : null
    return {
      id: s.id,
      x: s.x + (m ? m[0] * dx + m[2] * dy : dx),
      y: s.y + (m ? m[1] * dx + m[3] * dy : dy),
    }
  }
  p.align = function (axis, edge) {
    const roots = this.roots(),
      b = union(roots.map((s) => this.getShapePageBounds(s)))
    if (!b || roots.length < 2) return
    this.updateShapes(
      roots.map((s) => {
        const a = this.getShapePageBounds(s),
          delta =
            edge === 'start'
              ? b[axis] - a[axis]
              : edge === 'end'
                ? b[axis] +
                  b[axis === 'x' ? 'w' : 'h'] -
                  a[axis] -
                  a[axis === 'x' ? 'w' : 'h']
                : b[axis] +
                  b[axis === 'x' ? 'w' : 'h'] / 2 -
                  a[axis] -
                  a[axis === 'x' ? 'w' : 'h'] / 2
        return this.translateShape(
          s,
          axis === 'x' ? delta : 0,
          axis === 'y' ? delta : 0,
        )
      }),
    )
  }
  p.distribute = function (axis, stackGap = null) {
    const size = axis === 'x' ? 'w' : 'h',
      shapes = this.roots()
        .map((s) => ({ s, b: this.getShapePageBounds(s) }))
        .sort((a, b) => a.b[axis] - b.b[axis])
    if (shapes.length < 2) return
    const first = shapes[0].b,
      last = shapes.at(-1).b,
      gap =
        stackGap ??
        (last[axis] +
          last[size] -
          first[axis] -
          shapes.reduce((n, { b }) => n + b[size], 0)) /
          (shapes.length - 1)
    let cursor = first[axis]
    this.updateShapes(
      shapes.map(({ s, b }) => {
        const delta = cursor - b[axis]
        cursor += b[size] + gap
        return this.translateShape(
          s,
          axis === 'x' ? delta : 0,
          axis === 'y' ? delta : 0,
        )
      }),
    )
  }
  p.reorder = function (kind) {
    this.transaction(() => {
      const roots = this.roots(),
        ids = new Set(roots.map((s) => s.id))
      for (const parentId of new Set(roots.map((s) => s.parentId))) {
        let siblings = Object.values(this.records)
          .filter((s) => s.typeName === 'shape' && s.parentId === parentId)
          .sort((a, b) =>
            String(a.index) < String(b.index)
              ? -1
              : String(a.index) > String(b.index)
                ? 1
                : 0,
          )
        if (kind === 'front')
          siblings = [
            ...siblings.filter((s) => !ids.has(s.id)),
            ...siblings.filter((s) => ids.has(s.id)),
          ]
        if (kind === 'back')
          siblings = [
            ...siblings.filter((s) => ids.has(s.id)),
            ...siblings.filter((s) => !ids.has(s.id)),
          ]
        if (kind === 'forward')
          for (let i = siblings.length - 2; i >= 0; i--) {
            if (ids.has(siblings[i].id) && !ids.has(siblings[i + 1].id))
              [siblings[i], siblings[i + 1]] = [siblings[i + 1], siblings[i]]
          }
        if (kind === 'backward')
          for (let i = 1; i < siblings.length; i++) {
            if (ids.has(siblings[i].id) && !ids.has(siblings[i - 1].id))
              [siblings[i - 1], siblings[i]] = [siblings[i], siblings[i - 1]]
          }
        let index = null
        this.updateShapes(
          siblings.map((s) => ({
            id: s.id,
            index: (index = generateKeyBetween(index, null)),
          })),
        )
      }
    })
  }
  p.rotateSelected = function (angle) {
    const shapes = this.roots(),
      b = union(shapes.map((s) => this.getShapePageBounds(s)))
    if (!b) return
    const c = Math.cos(angle),
      s = Math.sin(angle),
      x = b.center.x,
      y = b.center.y,
      m = [c, s, -s, c, x - c * x + s * y, y - s * x - c * y]
    this.updateShapes(shapes.map((shape) => this.transformShape(shape, m)))
  }
  p.flipSelected = function (axis) {
    // Image flips preserve the asset; other shapes mirror around their own center.
    this.updateShapes(
      this.roots().map((s) => {
        if (s.type === 'image')
          return {
            id: s.id,
            props: {
              [axis === 'x' ? 'flipX' : 'flipY']:
                !s.props[axis === 'x' ? 'flipX' : 'flipY'],
            },
          }
        const key = axis === 'x' ? 'scaleX' : 'scaleY',
          b = this.getShapePageBounds(s),
          m = shapeMatrix(this.records, s)
        const next = { ...s, [key]: -(s[key] ?? 1) },
          n = shapeMatrix({ ...this.records, [s.id]: next }, next),
          localCenter = {
            x: (s.props.w || 180) / 2,
            y: (s.props.h || 120) / 2,
          },
          a = transform(m, localCenter),
          z = transform(n, localCenter)
        return {
          ...this.translateShape(s, a.x - z.x, a.y - z.y),
          [key]: next[key],
        }
      }),
    )
  }
  p.stretch = function (axis) {
    const shapes = this.roots(),
      b = union(shapes.map((s) => this.getShapePageBounds(s)))
    if (!b || shapes.length < 2) return
    this.updateShapes(
      shapes.map((s) => {
        const a = this.getShapePageBounds(s),
          ratio =
            b[axis === 'x' ? 'w' : 'h'] /
            Math.max(1, a[axis === 'x' ? 'w' : 'h']),
          m =
            axis === 'x'
              ? [ratio, 0, 0, 1, b.x - a.x * ratio, 0]
              : [1, 0, 0, ratio, 0, b.y - a.y * ratio]
        return this.transformShape(s, m)
      }),
    )
  }
  p.styleTargets = function () {
    const targets = [],
      queue = [...this.roots()],
      seen = new Set()
    while (queue.length) {
      const shape = queue.shift()
      if (seen.has(shape.id) || shape.isLocked) continue
      seen.add(shape.id)
      if (shape.type === 'group')
        queue.push(
          ...Object.values(this.records).filter(
            (s) => s.typeName === 'shape' && s.parentId === shape.id,
          ),
        )
      else targets.push(shape)
    }
    return targets
  }
  p.setStyle = function (patch) {
    this.style = { ...this.style, ...patch }
    const { opacity, ...props } = patch,
      updates = new Map()
    if (opacity !== undefined)
      for (const shape of this.roots())
        updates.set(shape.id, { id: shape.id, opacity })
    if (Object.keys(props).length)
      for (const shape of this.styleTargets())
        if (shape.type !== 'image')
          updates.set(shape.id, {
            ...updates.get(shape.id),
            id: shape.id,
            props,
          })
    this.updateShapes([...updates.values()])
    this.notify('session')
  }
  p.getBindings = function (id) {
    return Object.values(this.records).filter(
      (r) => r.typeName === 'binding' && r.type === 'arrow' && r.fromId === id,
    )
  }
  p.getArrowEndpoints = function (shape) {
    return arrowEndpoints(this.records, shape)
  }
  p.unbindArrow = function (id, terminal) {
    const bindings = this.getBindings(id).filter(
      (r) => r.props?.terminal === terminal,
    )
    if (!bindings.length) return
    this.checkpoint()
    for (const r of bindings) delete this.records[r.id]
    this.notify()
  }
  p.bindArrow = function (arrowId, terminal, targetId, point) {
    const arrow = this.getShape(arrowId),
      target = this.getShape(targetId)
    if (
      !arrow ||
      !target ||
      arrowId === targetId ||
      target.type === 'arrow' ||
      target.type === 'line' ||
      target.type === 'draw' ||
      target.type === 'highlight'
    )
      return
    const local = transform(inverse(shapeMatrix(this.records, target)), point)
    this.transaction(() => {
      for (const old of this.getBindings(arrowId).filter(
        (r) => r.props?.terminal === terminal,
      )) {
        this.checkpoint()
        delete this.records[old.id]
      }
      this.put([
        {
          id: 'binding:' + crypto.randomUUID(),
          typeName: 'binding',
          type: 'arrow',
          fromId: arrowId,
          toId: targetId,
          meta: {},
          props: {
            terminal,
            normalizedAnchor: {
              x: Math.max(0, Math.min(1, local.x / (target.props.w || 180))),
              y: Math.max(0, Math.min(1, local.y / (target.props.h || 120))),
            },
            isExact: true,
            isPrecise: true,
          },
        },
      ])
    })
  }
  p.captureSelection = function () {
    const roots = this.selectionRoots(true),
      ids = new Set(roots.map((s) => s.id))
    let changed = true
    while (changed) {
      changed = false
      for (const s of Object.values(this.records))
        if (s.typeName === 'shape' && ids.has(s.parentId) && !ids.has(s.id)) {
          ids.add(s.id)
          changed = true
        }
    }
    const shapes = [...ids].map((id) => structuredClone(this.records[id])),
      assets = new Set(shapes.map((s) => s.props?.assetId).filter(Boolean)),
      bindings = Object.values(this.records).filter(
        (r) => r.typeName === 'binding' && ids.has(r.fromId) && ids.has(r.toId),
      )
    // Unselected parents are flattened into page space. External bindings become fixed endpoints.
    for (const s of shapes) {
      if (s.type === 'arrow')
        s.props = { ...s.props, ...this.getArrowEndpoints(this.records[s.id]) }
      if (!ids.has(s.parentId)) {
        const m = shapeMatrix(this.records, this.records[s.id])
        s.parentId = this.pageId
        Object.assign(s, decompose(m))
      }
    }
    return {
      format: 'hamoki-clipboard',
      version: 1,
      roots: roots.map((s) => s.id),
      records: [
        ...shapes,
        ...[...assets].map((id) => this.records[id]).filter(Boolean),
        ...bindings,
      ].map((r) => structuredClone(r)),
    }
  }
  p.pasteSelection = function (
    value,
    offset = { x: 30, y: 30 },
    pageId = this.pageId,
  ) {
    if (
      value?.format !== 'hamoki-clipboard' ||
      value.version !== 1 ||
      !Array.isArray(value.records) ||
      value.records.length > 10000
    )
      throw Error('无法读取画布剪贴板')
    const records = value.records,
      map = new Map(
        records.map((r) => [
          r.id,
          r.typeName === 'shape'
            ? createShapeId()
            : r.typeName + ':' + crypto.randomUUID(),
        ]),
      ),
      roots = new Set(value.roots)
    let index = this.nextIndex(pageId)
    const pasted = records.map((r) => {
      const s = structuredClone(r)
      s.id = map.get(r.id)
      if (s.typeName === 'shape') {
        s.parentId = map.get(s.parentId) || pageId
        if (roots.has(r.id)) {
          s.x += offset.x
          s.y += offset.y
          s.index = index
          index = generateKeyBetween(index, null)
        }
        if (s.props.assetId)
          s.props.assetId = map.get(s.props.assetId) || s.props.assetId
      }
      if (s.typeName === 'binding') {
        s.fromId = map.get(s.fromId)
        s.toId = map.get(s.toId)
        if (!s.fromId || !s.toId) throw Error('剪贴板连线不完整')
      }
      return s
    })
    this.put(pasted)
    this.select(...value.roots.map((id) => map.get(id)))
    return this
  }
  p.duplicateSelected = function () {
    const value = this.captureSelection(),
      originals = value.roots.map((id) => this.getShape(id))
    this.transaction(() => {
      this.pasteSelection(value)
      const copies = this.getSelectedShapes(),
        pending = new Map()
      this.updateShapes(
        copies.map((s, i) => {
          const original = originals[i],
            parent = this.records[original.parentId]
          if (parent?.typeName !== 'shape') return { id: s.id }
          const local = multiply(
              inverse(shapeMatrix(this.records, parent)),
              shapeMatrix(this.records, s),
            ),
            index = this.nextIndex(parent.id, pending.get(parent.id) || null)
          pending.set(parent.id, index)
          return { id: s.id, parentId: parent.id, ...decompose(local), index }
        }),
      )
    })
    return this
  }
  p.renamePage = function (id, name) {
    const page = this.records[id]
    if (page?.typeName === 'page' && name.trim())
      this.put([{ ...page, name: name.trim().slice(0, 100) }])
  }
  p.deletePage = function (id) {
    const pages = this.getPages()
    if (pages.length < 2) throw Error('至少保留一个画布页面')
    const before = this.pageId
    this.setCurrentPage(id)
    this.transaction(() => {
      this.deleteShapes(this.getCurrentPageShapes().map((s) => s.id))
      this.checkpoint()
      delete this.records[id]
      this.notify()
    })
    this.setCurrentPage(
      before === id ? pages.find((p) => p.id !== id).id : before,
    )
  }
  p.duplicatePage = function (id) {
    const before = this.pageId,
      selection = [...this.selected]
    this.setCurrentPage(id)
    this.selectAll()
    const value = this.captureSelection(),
      next = 'page:' + crypto.randomUUID()
    this.transaction(() => {
      this.createPage({
        id: next,
        name: (this.records[id]?.name || '画布') + ' 副本',
      })
      this.pasteSelection(value, { x: 0, y: 0 }, next)
    })
    this.setCurrentPage(next)
  }
  p.moveSelectionToPage = function (id) {
    if (id === this.pageId || this.records[id]?.typeName !== 'page') return
    this.transaction(() => {
      this.select(...this.roots().map((s) => s.id))
      const value = this.captureSelection()
      this.deleteShapes(this.roots().map((s) => s.id))
      this.pasteSelection(value, { x: 0, y: 0 }, id)
    })
    this.setCurrentPage(id)
  }
  p.importSnapshot = function (value) {
    const safe = sanitizeCanvasSnapshot(value).snapshot
    if (!safe) throw Error('画布文件为空')
    const all = Object.values(safe.store),
      pages = all.filter((r) => r.typeName === 'page')
    if (all.length > 50000 || !pages.length) throw Error('画布过大或缺少页面')
    const map = new Map(
      all.map((r) => [r.id, r.typeName + ':' + crypto.randomUUID()]),
    )
    const records = all.map((r) => {
      const next = structuredClone(r)
      next.id = map.get(r.id)
      if (next.parentId) next.parentId = map.get(next.parentId) || next.parentId
      if (next.props?.assetId)
        next.props.assetId = map.get(next.props.assetId) || next.props.assetId
      if (next.typeName === 'binding') {
        next.fromId = map.get(next.fromId)
        next.toId = map.get(next.toId)
      }
      if (next.typeName === 'page')
        next.name = (next.name || '画布') + '（导入）'
      return next
    })
    this.put(records)
    this.setCurrentPage(map.get(pages[0].id))
  }
  p.reorderPage = function (id, direction) {
    const pages = this.getPages(),
      i = pages.findIndex((p) => p.id === id),
      j = i + direction
    if (i < 0 || j < 0 || j >= pages.length) return
    ;[pages[i], pages[j]] = [pages[j], pages[i]]
    let index = null
    this.put(
      pages.map((page) => ({
        ...page,
        index: (index = generateKeyBetween(index, null)),
      })),
    )
  }
  p.zoomToSelection = function () {
    const b = this.getSelectionPageBounds()
    if (!b) return
    const r = this.container.getBoundingClientRect(),
      z = Math.max(
        0.08,
        Math.min(
          4,
          (r.width - 160) / Math.max(1, b.w),
          (r.height - 200) / Math.max(1, b.h),
        ),
      )
    this.setCamera({
      z,
      x: r.width / z / 2 - b.center.x,
      y: r.height / z / 2 - b.center.y,
    })
  }
}

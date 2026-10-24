import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  createShapeId,
  toRichText,
  plainText,
  localBounds,
  shapeMatrix,
  shapeColor,
  intersects,
  inverse,
  transform,
  safeImageSource,
} from './model.js'
import { safeLink } from './richText.js'
import CropEditor from './CropEditor.jsx'
import RichTextEditor from './RichTextEditor.jsx'
import ShapeContent from './ShapeContent.jsx'
import {
  geometries,
  tools,
  pathThrough,
  linePoints,
  arrowGeometry,
} from './features.js'
import CanvasImageActions from '../ui/CanvasImageActions.jsx'
const editable = (target) =>
  target?.closest?.(
    'input,textarea,select,[contenteditable=true],[role=dialog]',
  )
function Shape({ editor, shape }) {
  const p = shape.props || {},
    b = localBounds(shape),
    m = shapeMatrix(editor.records, shape),
    color = shapeColor(shape),
    selected = editor.selected.includes(shape.id)
  let content = <ShapeContent editor={editor} shape={shape} />
  const clips = [],
    seen = new Set()
  let parent = editor.getShape(shape.parentId)
  while (parent?.typeName === 'shape' && !seen.has(parent.id)) {
    seen.add(parent.id)
    if (parent.type === 'frame') {
      const pm = shapeMatrix(editor.records, parent),
        im = inverse(m),
        corners = [
          [0, 0],
          [parent.props.w, 0],
          [parent.props.w, parent.props.h],
          [0, parent.props.h],
        ].map(([x, y]) => transform(im, transform(pm, { x, y }))),
        id =
          'clip-' + shape.id.replace(/[^a-zA-Z0-9]/g, '') + '-' + clips.length
      clips.push(
        <clipPath key={id} id={id}>
          <polygon points={corners.map((p) => `${p.x},${p.y}`).join(' ')} />
        </clipPath>,
      )
      content = <g clipPath={`url(#${id})`}>{content}</g>
    }
    parent = editor.getShape(parent.parentId)
  }
  return (
    <g
      id={'hamoki-shape-' + shape.id.replace(/[^a-zA-Z0-9]/g, '')}
      role="graphics-symbol"
      aria-label={(
        shape.props?.altText ||
        plainText(shape.props?.richText || shape.props?.text) ||
        shape.props?.name ||
        shape.type
      ).slice(0, 150)}
      data-shape-id={shape.id}
      data-shape-type={shape.type}
      transform={`matrix(${m.join(' ')})`}
      opacity={shape.opacity ?? 1}
      style={{
        cursor:
          editor.tool !== 'select'
            ? 'inherit'
            : shape.isLocked
              ? 'not-allowed'
              : 'move',
      }}
    >
      {!!clips.length && <defs>{clips}</defs>}
      {content}
      {selected && (
        <rect
          data-selection-decoration="true"
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          fill="none"
          stroke="#97e9b7"
          strokeWidth={1 / editor.camera.z}
          pointerEvents="none"
        />
      )}
    </g>
  )
}
export default function CanvasView({
  editor,
  onImport,
  onImportRequest,
  onDownload,
  onNotice,
}) {
  useSyncExternalStore(
    (fn) => editor.store.listen(fn, { source: 'all', scope: 'all' }),
    () => editor.revision,
  )
  const svg = useRef(null),
    gesture = useRef(null),
    richEditor = useRef(null),
    lastPointer = useRef(null),
    space = useRef(false),
    touches = useRef(new Map()),
    pinch = useRef(null)
  const [marquee, setMarquee] = useState(null),
    [draft, setDraft] = useState(null),
    [menu, setMenu] = useState(null),
    [editing, setEditing] = useState(null),
    [cropId, setCropId] = useState(null),
    [laserTrail, setLaserTrail] = useState(null)
  const camera = editor.getCamera(),
    bounds = editor.getSelectionPageBounds(),
    zoom = camera.z
  const run = (fn) => {
    try {
      fn()
    } catch (e) {
      onNotice(e.message)
    }
  }
  const editShape = (shape) => {
    setEditing(shape.id)
    setMenu(null)
  }
  const hitShape = (target) => {
    let shape = editor.getShape(
      target.closest?.('[data-shape-id]')?.dataset.shapeId,
    )
    const seen = new Set()
    while (
      shape &&
      !seen.has(shape.id) &&
      editor.getShape(shape.parentId)?.type === 'group' &&
      shape.parentId !== editor.focusedGroup
    ) {
      seen.add(shape.id)
      shape = editor.getShape(shape.parentId)
    }
    return shape
  }
  useEffect(() => {
    const crop = () => {
      const one = editor.getSelectedShapes()
      if (one.length === 1 && one[0].type === 'image' && !one[0].isLocked)
        setCropId(one[0].id)
    }
    editor.container.addEventListener('cowart:crop-selection', crop)
    return () =>
      editor.container.removeEventListener('cowart:crop-selection', crop)
  }, [editor])
  useEffect(() => {
    const wheel = (e) => {
      e.preventDefault()
      editor.zoomAt(
        { x: e.clientX, y: e.clientY },
        Math.exp(-e.deltaY * 0.0015),
      )
    }
    svg.current.addEventListener('wheel', wheel, { passive: false })
    return () => svg.current?.removeEventListener('wheel', wheel)
  }, [editor])
  useEffect(() => {
    const down = (e) => {
      if (editable(e.target)) return
      if (e.key === 'Tab' && e.target === svg.current) {
        e.preventDefault()
        const shapes = editor
            .getCurrentPageShapes()
            .filter(
              (s) => s.parentId === (editor.focusedGroup || editor.pageId),
            ),
          i = shapes.findIndex((s) => s.id === editor.selected.at(-1)),
          next =
            shapes[(i + (e.shiftKey ? -1 : 1) + shapes.length) % shapes.length]
        if (next) editor.select(next.id)
        return
      }
      if (e.code === 'Space') {
        space.current = true
        e.preventDefault()
        return
      }
      if (e.key === 'Escape') {
        setMenu(null)
        setDraft(null)
        editor.endGesture()
        gesture.current = null
        editor.setCurrentTool('select')
        editor.focusedGroup = null
        return
      }
      const command = e.ctrlKey || e.metaKey
      if (command && e.key.toLowerCase() === 'u') {
        e.preventDefault()
        onImportRequest?.()
        return
      }
      if (!command && !e.altKey) {
        if (e.shiftKey && e.code === 'Digit1') {
          e.preventDefault()
          editor.zoomToFit()
          return
        }
        if (e.shiftKey && e.code === 'Digit2') {
          e.preventDefault()
          editor.zoomToSelection()
          return
        }
        if (e.shiftKey && e.code === 'Digit0') {
          e.preventDefault()
          editor.setCamera({ ...editor.camera, z: 1 })
          return
        }
        if (e.key === '+' || e.key === '-' || e.key === '=') {
          e.preventDefault()
          const r = editor.container.getBoundingClientRect()
          editor.zoomAt(
            { x: r.left + r.width / 2, y: r.top + r.height / 2 },
            e.key === '-' ? 0.8 : 1.25,
          )
          return
        }
      }
      if (command && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? editor.redo() : editor.undo()
      } else if (command && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        editor.redo()
      } else if (command && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        editor.selectAll()
      } else if (command && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        editor.duplicateSelected()
      } else if (command && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        run(() =>
          e.shiftKey ? editor.ungroupSelected() : editor.groupSelected(),
        )
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        editor.deleteShapes(
          editor
            .getSelectedShapes()
            .filter((s) => !s.isLocked)
            .map((s) => s.id),
        )
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const n = e.shiftKey ? 10 : 1
        editor.updateShapes(
          editor
            .getSelectedShapes()
            .filter((s) => !s.isLocked)
            .map((s) => ({
              id: s.id,
              x:
                s.x +
                (e.key === 'ArrowRight' ? n : e.key === 'ArrowLeft' ? -n : 0),
              y:
                s.y +
                (e.key === 'ArrowDown' ? n : e.key === 'ArrowUp' ? -n : 0),
            })),
        )
      } else if (!command && e.key.toLowerCase() === 'v')
        editor.setCurrentTool('select')
      else if (!command && e.key.length === 1 && !e.altKey) {
        const shortcut = (e.shiftKey ? 'Shift+' : '') + e.key.toUpperCase(),
          tool = tools.find(([, , key]) => key === shortcut)
        if (tool) {
          e.preventDefault()
          editor.setCurrentTool(tool[0])
        }
      }
    }
    const up = (e) => {
      if (e.code === 'Space') space.current = false
    }
    const blur = () => {
      space.current = false
      if (gesture.current) {
        editor.endGesture()
        gesture.current = null
        setDraft(null)
        setMarquee(null)
      }
      touches.current.clear()
      pinch.current = null
    }
    const paste = (e) => {
      if (editable(e.target)) return
      const native = e.clipboardData?.getData('application/x-hamoki-canvas')
      const plain = e.clipboardData?.getData('text/plain')
      if (native || plain?.startsWith('{"format":"hamoki-clipboard"')) {
        try {
          e.preventDefault()
          editor.pasteSelection(JSON.parse(native || plain))
          return
        } catch (error) {
          onNotice(error.message)
          return
        }
      }
      const files = [...(e.clipboardData?.files || [])].filter((f) =>
        f.type.startsWith('image/'),
      )
      if (files.length) {
        e.preventDefault()
        onImport(files)
      } else {
        const value = e.clipboardData?.getData('text/plain')
        if (value?.trim()) {
          e.preventDefault()
          const p = editor.getViewportPageBounds().center
          const id = createShapeId()
          editor.createShape({
            id,
            type: 'text',
            x: p.x,
            y: p.y,
            props: {
              richText: toRichText(value.slice(0, 5000)),
              w: 300,
              h: 100,
            },
          })
          editor.select(id)
        }
      }
    }
    const copy = (e) => {
      if (editable(e.target) || !editor.selected.length) return
      e.preventDefault()
      const value = JSON.stringify(editor.captureSelection())
      e.clipboardData.setData('application/x-hamoki-canvas', value)
      e.clipboardData.setData('text/plain', value)
      if (e.type === 'cut') editor.deleteShapes(editor.roots().map((s) => s.id))
    }
    document.addEventListener('copy', copy)
    document.addEventListener('cut', copy)
    document.addEventListener('keydown', down)
    document.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    document.addEventListener('paste', paste)
    return () => {
      document.removeEventListener('copy', copy)
      document.removeEventListener('cut', copy)
      document.removeEventListener('keydown', down)
      document.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      document.removeEventListener('paste', paste)
    }
  }, [editor, onImport])
  function start(e) {
    if (e.button === 2 || e.target.closest?.('[data-embed-interactive]')) return
    if (editor.activeEmbed) {
      editor.activeEmbed = null
      editor.notify('session')
    }
    if (editing) richEditor.current?.commit()
    setMenu(null)
    e.preventDefault()
    svg.current.focus()
    svg.current.setPointerCapture(e.pointerId)
    const screen = { x: e.clientX, y: e.clientY },
      point = editor.screenToPage(screen)
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, screen)
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()]
        editor.endGesture()
        gesture.current = null
        pinch.current = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          camera: editor.getCamera(),
          page: editor.screenToPage({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
        }
        return
      }
    }
    if (e.button === 1 || space.current || editor.tool === 'hand') {
      gesture.current = { kind: 'pan', screen, camera: editor.getCamera() }
      return
    }
    lastPointer.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      shiftKey: e.shiftKey,
      pointerType: e.pointerType,
    }
    const handle =
      editor.tool === 'select' ? e.target.dataset.handle : undefined
    if (editor.tool === 'select' && e.target.dataset.vertex !== undefined) {
      const shape = editor.getShape(e.target.dataset.owner),
        vertex = e.target.dataset.vertex
      if (!shape || shape.isLocked) return
      editor.beginGesture()
      if (shape.type === 'arrow') {
        editor.updateShape({
          id: shape.id,
          props: editor.getArrowEndpoints(shape),
        })
        editor.unbindArrow(shape.id, vertex)
      }
      let index = vertex
      if (e.target.dataset.insert !== undefined) {
        const points = linePoints(shape.props).map((p) => ({ ...p })),
          i = Number(vertex),
          a = points[i],
          b = points[i + 1]
        points.splice(i + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
        editor.updateShape({ id: shape.id, props: { points } })
        index = String(i + 1)
      }
      gesture.current = { kind: 'vertex', id: shape.id, vertex: index, point }
      return
    }
    if (handle && bounds) {
      editor.beginGesture()
      gesture.current = {
        kind: handle === 'rotate' ? 'rotate' : 'resize',
        handle,
        point,
        bounds,
        records: editor
          .getSelectedShapes()
          .filter((s) => !s.isLocked)
          .map((s) => structuredClone(s)),
      }
      return
    }
    if (editor.tool !== 'select') {
      const kind = editor.tool
      if (['draw', 'highlight', 'laser'].includes(kind)) {
        editor.beginGesture()
        gesture.current = {
          kind: 'stroke',
          type: kind,
          isPen: e.pointerType === 'pen',
          point,
          points: [{ x: 0, y: 0, z: e.pressure || 0.5 }],
        }
        setDraft({
          x: point.x,
          y: point.y,
          type: kind,
          points: [{ x: 0, y: 0 }],
        })
        return
      }
      if (kind === 'eraser') {
        editor.beginGesture()
        gesture.current = { kind: 'erase', point }
        const hit = editor.hitTest(point)
        if (hit && !hit.isLocked) editor.deleteShapes([hit.id])
        return
      }
      if (kind === 'text') {
        const id = createShapeId()
        editor.createShape({
          id,
          type: 'text',
          opacity: editor.style.opacity,
          x: point.x,
          y: point.y,
          props: { ...editor.style, w: 260, h: 70, richText: toRichText('') },
        })
        editor.select(id)
        editShape(editor.getShape(id))
        if (!editor.preferences.toolLock) editor.setCurrentTool('select')
        return
      }
      gesture.current = {
        kind: 'create',
        type: kind,
        point,
        startTarget:
          kind === 'arrow' || kind === 'annotation'
            ? editor.hitTest(point, { bindable: true })?.id
            : null,
      }
      setDraft({ x: point.x, y: point.y, w: 1, h: 1, type: kind })
      return
    }
    const shape = hitShape(e.target)
    if (shape) {
      if (e.shiftKey) {
        editor.select(
          ...(editor.selected.includes(shape.id)
            ? editor.selected.filter((id) => id !== shape.id)
            : [...editor.selected, shape.id]),
        )
        return
      }
      if (!editor.selected.includes(shape.id)) editor.select(shape.id)
      editor.beginGesture()
      if (e.altKey && !shape.isLocked) editor.duplicateSelected()
      gesture.current = {
        kind: 'move',
        point,
        records: editor
          .getSelectedShapes()
          .filter((s) => !s.isLocked && !editor.selected.includes(s.parentId))
          .map((s) => structuredClone(s)),
      }
    } else {
      gesture.current = {
        kind: 'marquee',
        point,
        initial: e.shiftKey ? editor.getSelectedShapeIds() : [],
      }
      if (!e.shiftKey) editor.selectNone()
      setMarquee({ x: point.x, y: point.y, w: 0, h: 0 })
    }
  }
  function move(e) {
    lastPointer.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      shiftKey: e.shiftKey,
      pointerType: e.pointerType,
    }
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.current.size === 2 && pinch.current) {
        const [a, b] = [...touches.current.values()],
          r = editor.getContainer().getBoundingClientRect(),
          z = Math.max(
            0.08,
            Math.min(
              8,
              (pinch.current.camera.z * Math.hypot(a.x - b.x, a.y - b.y)) /
                Math.max(1, pinch.current.distance),
            ),
          )
        editor.setCamera({
          z,
          x: ((a.x + b.x) / 2 - r.left) / z - pinch.current.page.x,
          y: ((a.y + b.y) / 2 - r.top) / z - pinch.current.page.y,
        })
        return
      }
    }
    const g = gesture.current
    if (!g) return
    const p = editor.screenToPage({ x: e.clientX, y: e.clientY }),
      dx = p.x - g.point?.x,
      dy = p.y - g.point?.y
    if (g.kind === 'pan') {
      editor.setCamera({
        ...g.camera,
        x: g.camera.x + (e.clientX - g.screen.x) / g.camera.z,
        y: g.camera.y + (e.clientY - g.screen.y) / g.camera.z,
      })
      return
    }
    if (g.kind === 'vertex') {
      const shape = editor.getShape(g.id),
        local = transform(inverse(shapeMatrix(editor.records, shape)), p)
      if (shape.type === 'arrow')
        editor.updateShape({ id: g.id, props: { [g.vertex]: local } })
      else {
        const points = linePoints(shape.props).map((p) => ({ ...p }))
        points[Number(g.vertex)] = local
        editor.updateShape({ id: g.id, props: { points } })
      }
      return
    }
    if (g.kind === 'stroke') {
      const last = g.points.at(-1),
        next = { x: p.x - g.point.x, y: p.y - g.point.y, z: e.pressure || 0.5 }
      if (Math.hypot(next.x - last.x, next.y - last.y) > 0.6 / zoom)
        g.points.push(next)
      setDraft({
        x: g.point.x,
        y: g.point.y,
        type: g.type,
        points: [...g.points],
      })
      return
    }
    if (g.kind === 'erase') {
      const steps = Math.max(
        1,
        Math.min(
          200,
          Math.ceil((Math.hypot(p.x - g.point.x, p.y - g.point.y) * zoom) / 4),
        ),
      )
      for (let i = 1; i <= steps; i++) {
        const hit = editor.hitTest({
          x: g.point.x + ((p.x - g.point.x) * i) / steps,
          y: g.point.y + ((p.y - g.point.y) * i) / steps,
        })
        if (hit && !hit.isLocked) editor.deleteShapes([hit.id])
      }
      g.point = p
      return
    }
    if (g.kind === 'move') {
      editor.updateShapes(
        g.records.map((s) => {
          const parent = editor.getShape(s.parentId),
            m =
              parent?.typeName === 'shape'
                ? inverse(shapeMatrix(editor.records, parent))
                : null,
            d = m
              ? { x: m[0] * dx + m[2] * dy, y: m[1] * dx + m[3] * dy }
              : { x: dx, y: dy }
          return {
            id: s.id,
            x:
              s.x +
              (e.shiftKey || editor.preferences.snap
                ? Math.round(d.x / 24) * 24
                : d.x),
            y:
              s.y +
              (e.shiftKey || editor.preferences.snap
                ? Math.round(d.y / 24) * 24
                : d.y),
          }
        }),
      )
      return
    }
    if (g.kind === 'resize') {
      const b = g.bounds,
        west = g.handle.includes('w'),
        north = g.handle.includes('n')
      let sx = Math.max(0.03, (b.w + (west ? -dx : dx)) / Math.max(1, b.w)),
        sy = Math.max(0.03, (b.h + (north ? -dy : dy)) / Math.max(1, b.h))
      if (
        e.shiftKey ||
        g.records.some(
          (s) =>
            s.type === 'image' ||
            s.type === 'group' ||
            s.meta?.cowartAiAspectLocked,
        )
      )
        sx = sy = Math.max(sx, sy)
      const pivot = { x: west ? b.x + b.w : b.x, y: north ? b.y + b.h : b.y }
      editor.updateShapes(
        g.records.map((s) => {
          const m = shapeMatrix(editor.records, s),
            origin = {
              x: pivot.x + (m[4] - pivot.x) * sx,
              y: pivot.y + (m[5] - pivot.y) * sy,
            },
            parent = editor.getShape(s.parentId),
            local =
              parent?.typeName === 'shape'
                ? transform(
                    inverse(shapeMatrix(editor.records, parent)),
                    origin,
                  )
                : origin
          return {
            id: s.id,
            x: local.x,
            y: local.y,
            ...(['group', 'draw', 'highlight', 'line'].includes(s.type)
              ? { scaleX: (s.scaleX || 1) * sx, scaleY: (s.scaleY || 1) * sy }
              : {}),
            props:
              s.type === 'arrow'
                ? {
                    start: {
                      x: (s.props.start?.x || 0) * sx,
                      y: (s.props.start?.y || 0) * sy,
                    },
                    end: {
                      x: (s.props.end?.x || 160) * sx,
                      y: (s.props.end?.y || 0) * sy,
                    },
                  }
                : {
                    w: Math.max(16, (s.props.w || 180) * sx),
                    h: Math.max(16, (s.props.h || 120) * sy),
                  },
          }
        }),
      )
      return
    }
    if (g.kind === 'rotate') {
      const b = g.bounds,
        c = b.center,
        angle =
          Math.atan2(p.y - c.y, p.x - c.x) -
          Math.atan2(g.point.y - c.y, g.point.x - c.x),
        a = e.shiftKey
          ? (Math.round(angle / (Math.PI / 12)) * Math.PI) / 12
          : angle
      editor.updateShapes(
        g.records.map((s) => {
          const m = shapeMatrix(editor.records, s),
            x = m[4] - c.x,
            y = m[5] - c.y,
            point = {
              x: c.x + x * Math.cos(a) - y * Math.sin(a),
              y: c.y + x * Math.sin(a) + y * Math.cos(a),
            },
            parent = editor.getShape(s.parentId),
            local =
              parent?.typeName === 'shape'
                ? transform(inverse(shapeMatrix(editor.records, parent)), point)
                : point
          return {
            id: s.id,
            x: local.x,
            y: local.y,
            rotation: (s.rotation || 0) + a,
          }
        }),
      )
      return
    }
    const box = {
      x: Math.min(p.x, g.point.x),
      y: Math.min(p.y, g.point.y),
      w: Math.abs(dx),
      h: Math.abs(dy),
    }
    if (g.kind === 'create')
      setDraft({ ...box, type: g.type, end: p, start: g.point })
    else {
      setMarquee(box)
      editor.select(
        ...g.initial,
        ...editor
          .getCurrentPageShapes()
          .filter(
            (s) =>
              s.parentId === (editor.focusedGroup || editor.pageId) &&
              intersects(editor.getShapePageBounds(s), box),
          )
          .map((s) => s.id),
      )
    }
  }
  function end(e) {
    touches.current.delete(e.pointerId)
    if (pinch.current) {
      if (touches.current.size < 2) pinch.current = null
      gesture.current = null
      return
    }
    const g = gesture.current
    gesture.current = null
    if (
      g?.kind === 'vertex' &&
      editor.getShape(g.id)?.type === 'arrow' &&
      !e.altKey
    ) {
      const p = editor.screenToPage({ x: e.clientX, y: e.clientY }),
        target = editor.hitTest(p, { exclude: [g.id], bindable: true })
      if (target && target.id !== g.id)
        editor.bindArrow(g.id, g.vertex, target.id, p)
    }
    if (g?.kind === 'stroke' && g.type === 'laser')
      setLaserTrail({ ...g, at: Date.now() })
    if (g?.kind === 'stroke' && g.type !== 'laser') {
      const id = createShapeId()
      editor.createShape({
        id,
        type: g.type,
        x: g.point.x,
        y: g.point.y,
        opacity: editor.style.opacity,
        props: {
          ...editor.style,
          points: g.points,
          isPen: g.isPen,
          isComplete: true,
        },
      })
      editor.select(id)
    }
    if (g?.kind === 'create') {
      const p = editor.screenToPage({ x: e.clientX, y: e.clientY }),
        isArrow = ['arrow', 'annotation'].includes(g.type),
        isGeo = geometries.some(([id]) => id === g.type),
        clicked = Math.hypot(p.x - g.point.x, p.y - g.point.y) < 4 / zoom,
        b = {
          x: Math.min(p.x, g.point.x),
          y: Math.min(p.y, g.point.y),
          w: clicked
            ? g.type === 'holder'
              ? 512
              : 180
            : Math.max(16, Math.abs(p.x - g.point.x)),
          h: clicked
            ? g.type === 'holder'
              ? 683
              : 120
            : Math.max(16, Math.abs(p.y - g.point.y)),
        },
        id = createShapeId(),
        target =
          isArrow && !e.altKey ? editor.hitTest(p, { bindable: true }) : null,
        a = { x: g.point.x - b.x, y: g.point.y - b.y },
        endPoint = clicked ? { x: 160, y: 80 } : { x: p.x - b.x, y: p.y - b.y }
      editor.beginGesture()
      editor.createShape({
        id,
        type:
          g.type === 'holder'
            ? 'frame'
            : isGeo
              ? 'geo'
              : isArrow
                ? 'arrow'
                : g.type,
        x: b.x,
        y: b.y,
        opacity: editor.style.opacity,
        meta:
          g.type === 'holder'
            ? { cowartAiImageHolder: true, cowartAiAspectRatio: b.w / b.h }
            : g.type === 'annotation'
              ? { cowartAnnotationArrow: true }
              : {},
        props: {
          ...editor.style,
          w: b.w,
          h: b.h,
          ...(isGeo ? { geo: g.type } : {}),
          name: g.type === 'holder' ? 'AI 图片' : '框架',
          richText: toRichText(''),
          ...(isArrow
            ? {
                start: a,
                end: endPoint,
                kind: 'arc',
                arrowheadEnd: 'arrow',
                ...(g.type === 'annotation'
                  ? {
                      bend: Math.min(
                        48,
                        Math.max(
                          16,
                          Math.hypot(endPoint.x - a.x, endPoint.y - a.y) * 0.12,
                        ),
                      ),
                      labelPosition: 0,
                    }
                  : {}),
              }
            : {}),
          ...(g.type === 'line'
            ? { points: [a, endPoint], spline: 'line' }
            : {}),
        },
      })
      if (isArrow && !e.altKey) {
        if (g.startTarget) editor.bindArrow(id, 'start', g.startTarget, g.point)
        if (target) editor.bindArrow(id, 'end', target.id, p)
      }
      editor.select(id)
      if (g.type === 'annotation' || g.type === 'note')
        editShape(editor.getShape(id))
      if (!editor.preferences.toolLock) editor.setCurrentTool('select')
    }
    editor.endGesture()
    setMarquee(null)
    setDraft(null)
  }
  useEffect(() => {
    let frame
    const tick = () => {
      const g = gesture.current,
        p = lastPointer.current
      if (
        editor.preferences.edgeScroll &&
        g &&
        p &&
        ['move', 'create', 'stroke', 'marquee', 'vertex'].includes(g.kind)
      ) {
        const r = editor.container.getBoundingClientRect(),
          dx = p.clientX < r.left + 24 ? -8 : p.clientX > r.right - 24 ? 8 : 0,
          dy = p.clientY < r.top + 24 ? -8 : p.clientY > r.bottom - 24 ? 8 : 0
        if (dx || dy) {
          editor.setCamera({
            ...editor.camera,
            x: editor.camera.x - dx / editor.camera.z,
            y: editor.camera.y - dy / editor.camera.z,
          })
          move(p)
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [editor])
  const double = (e) => {
    const shape =
      hitShape(e.target) ||
      editor.hitTest(editor.screenToPage({ x: e.clientX, y: e.clientY }))
    if (!shape) return
    if (shape.type === 'group') {
      editor.focusedGroup = shape.id
      editor.selectNone()
      return
    }
    editor.select(shape.id)
    if (shape.type === 'bookmark') {
      const url = safeLink(shape.props.url)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
      return
    }
    if (shape.type === 'embed') {
      editor.activeEmbed = shape.id
      editor.notify('session')
      return
    }
    if (shape.isLocked) return
    if (shape.type === 'image')
      editor
        .getContainer()
        .dispatchEvent(
          new CustomEvent('cowart:preview-image', { detail: shape.id }),
        )
    else if (['text', 'note', 'arrow', 'geo'].includes(shape.type))
      editShape(shape)
  }
  const shapeBeingEdited = editing && editor.getShape(editing),
    editBounds = shapeBeingEdited && editor.getShapePageBounds(shapeBeingEdited)
  return (
    <>
      <svg
        ref={svg}
        className="hamoki-board"
        style={{
          cursor:
            editor.tool === 'hand'
              ? 'grab'
              : editor.tool === 'select'
                ? 'default'
                : 'crosshair',
        }}
        aria-label="图片画布"
        role="application"
        aria-roledescription="无限画布"
        aria-activedescendant={
          editor.selected.length === 1
            ? 'hamoki-shape-' + editor.selected[0].replace(/[^a-zA-Z0-9]/g, '')
            : undefined
        }
        tabIndex="0"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={(e) => {
          touches.current.delete(e.pointerId)
          pinch.current = null
          gesture.current = null
          editor.endGesture()
          setDraft(null)
          setMarquee(null)
        }}
        onDoubleClick={double}
        onContextMenu={(e) => {
          e.preventDefault()
          const shape = hitShape(e.target)
          if (shape && !editor.selected.includes(shape.id))
            editor.select(shape.id)
          const r = editor.getContainer().getBoundingClientRect()
          setMenu({
            x: Math.min(e.clientX - r.left, r.width - 200),
            y: Math.min(e.clientY - r.top, r.height - 330),
          })
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          onImport(
            [...e.dataTransfer.files],
            editor.screenToPage({ x: e.clientX, y: e.clientY }),
          )
        }}
      >
        <defs>
          <filter
            id="hamoki-rough"
            x="-10%"
            y="-10%"
            width="120%"
            height="120%"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency=".08"
              numOctaves="2"
              seed="17"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="2"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
          <pattern
            id="hamoki-hatch"
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M-2 2L2 -2M0 8L8 0M6 10L10 6"
              stroke="#83b39a"
              strokeWidth="1"
            />
          </pattern>
          <pattern
            id="hamoki-grid"
            width={24 * zoom}
            height={24 * zoom}
            patternUnits="userSpaceOnUse"
            x={(camera.x * zoom) % (24 * zoom)}
            y={(camera.y * zoom) % (24 * zoom)}
          >
            <circle cx="1" cy="1" r="1" fill="#456151" opacity=".35" />
          </pattern>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill={editor.preferences.grid ? 'url(#hamoki-grid)' : 'transparent'}
        />
        <g transform={`scale(${zoom}) translate(${camera.x} ${camera.y})`}>
          {editor.getCurrentPageShapes().map((shape) => (
            <Shape key={shape.id} shape={shape} editor={editor} />
          ))}
          {laserTrail && (
            <path
              key={laserTrail.at}
              className="hamoki-laser-trail"
              d={pathThrough(laserTrail.points, true)}
              transform={`translate(${laserTrail.point.x} ${laserTrail.point.y})`}
              fill="none"
              stroke="#ff7979"
              strokeWidth="3"
              strokeLinecap="round"
              pointerEvents="none"
              onAnimationEnd={() => setLaserTrail(null)}
            />
          )}
          {draft?.points && (
            <path
              d={pathThrough(draft.points, true)}
              transform={`translate(${draft.x} ${draft.y})`}
              fill="none"
              stroke={draft.type === 'laser' ? '#fa7979' : '#9ae7b6'}
              strokeWidth={draft.type === 'highlight' ? 20 : 3}
              strokeLinecap="round"
              opacity={draft.type === 'highlight' ? 0.4 : 1}
              pointerEvents="none"
            />
          )}
          {draft && !draft.points && (
            <rect
              x={draft.x}
              y={draft.y}
              width={draft.w}
              height={draft.h}
              fill="#7cdaa4"
              fillOpacity=".1"
              stroke="#9ae7b6"
              strokeDasharray="5 4"
              strokeWidth={1 / zoom}
            />
          )}
          {marquee && (
            <rect
              {...marquee}
              fill="#83dfab"
              fillOpacity=".12"
              stroke="#9ae7b6"
              strokeWidth={1 / zoom}
              pointerEvents="none"
            />
          )}
          {editor
            .getSelectedShapes()
            .filter(
              (s) =>
                editor.tool === 'select' &&
                ['arrow', 'line'].includes(s.type) &&
                !s.isLocked,
            )
            .flatMap((s) => {
              const m = shapeMatrix(editor.records, s),
                points =
                  s.type === 'arrow'
                    ? Object.entries(editor.getArrowEndpoints(s))
                    : linePoints(s.props).map((p, i) => [String(i), p])
              const midpoints =
                s.type === 'line'
                  ? points.slice(0, -1).map(([vertex, p], i) => {
                      const next = points[i + 1][1],
                        world = transform(m, {
                          x: (p.x + next.x) / 2,
                          y: (p.y + next.y) / 2,
                        })
                      return (
                        <circle
                          key={s.id + 'mid' + vertex}
                          data-owner={s.id}
                          data-vertex={vertex}
                          data-insert="true"
                          cx={world.x}
                          cy={world.y}
                          r={4 / zoom}
                          fill="#204b33"
                          stroke="#90c8a3"
                          strokeWidth={1 / zoom}
                          style={{ cursor: 'copy' }}
                        />
                      )
                    })
                  : []
              return [
                ...midpoints,
                ...points.map(([vertex, p]) => {
                  const world = transform(m, p)
                  return (
                    <circle
                      key={s.id + vertex}
                      data-owner={s.id}
                      data-vertex={vertex}
                      cx={world.x}
                      cy={world.y}
                      r={6 / zoom}
                      fill="#d0f7dd"
                      stroke="#305d40"
                      strokeWidth={1 / zoom}
                      style={{ cursor: 'crosshair' }}
                    />
                  )
                }),
              ]
            })}
          {bounds &&
            editor.tool === 'select' &&
            !editor
              .getSelectedShapes()
              .every((s) => ['arrow', 'line'].includes(s.type)) &&
            !editing &&
            editor.getSelectedShapes().some((s) => !s.isLocked) && (
              <g className="hamoki-handles">
                <rect
                  x={bounds.x}
                  y={bounds.y}
                  width={bounds.w}
                  height={bounds.h}
                  fill="none"
                  stroke="#a2e9bd"
                  strokeWidth={1 / zoom}
                  pointerEvents="none"
                />
                {[
                  ['nw', bounds.x, bounds.y],
                  ['ne', bounds.x + bounds.w, bounds.y],
                  ['sw', bounds.x, bounds.y + bounds.h],
                  ['se', bounds.x + bounds.w, bounds.y + bounds.h],
                ].map(([name, x, y]) => (
                  <rect
                    key={name}
                    data-handle={name}
                    x={x - 5 / zoom}
                    y={y - 5 / zoom}
                    width={10 / zoom}
                    height={10 / zoom}
                    fill="#c9f1d6"
                    stroke="#1b3829"
                    strokeWidth={1 / zoom}
                    style={{ cursor: name + '-resize' }}
                  />
                ))}
                <line
                  x1={bounds.x + bounds.w / 2}
                  x2={bounds.x + bounds.w / 2}
                  y1={bounds.y}
                  y2={bounds.y - 25 / zoom}
                  stroke="#a2e9bd"
                  strokeWidth={1 / zoom}
                />
                <circle
                  data-handle="rotate"
                  cx={bounds.x + bounds.w / 2}
                  cy={bounds.y - 29 / zoom}
                  r={5 / zoom}
                  fill="#c9f1d6"
                  style={{ cursor: 'grab' }}
                />
              </g>
            )}
        </g>
      </svg>
      {editBounds && (
        <RichTextEditor
          ref={richEditor}
          key={editing}
          shape={shapeBeingEdited}
          onCommit={(richText) => {
            if (richText)
              editor.updateShape({
                id: editing,
                props: {
                  richText,
                  ...(shapeBeingEdited.type === 'text'
                    ? {
                        h: Math.max(
                          50,
                          plainText(richText).split('\n').length * 30,
                        ),
                      }
                    : {}),
                },
              })
            setEditing(null)
          }}
          onCancel={() => setEditing(null)}
          style={{
            left: (editBounds.x + camera.x) * zoom,
            top: (editBounds.y + camera.y) * zoom,
            width: Math.max(240, editBounds.w * zoom),
            minHeight: Math.max(90, editBounds.h * zoom),
          }}
        />
      )}
      {cropId && editor.getShape(cropId) && (
        <CropEditor
          editor={editor}
          shape={editor.getShape(cropId)}
          onClose={() => setCropId(null)}
        />
      )}
      <CanvasImageActions editor={editor} />
      {menu && (
        <div
          role="menu"
          aria-label="画布操作"
          className="hamoki-context-menu"
          style={{ left: Math.max(8, menu.x), top: Math.max(65, menu.y) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {[
            [
              '修改所选图片',
              () =>
                editor
                  .getContainer()
                  .dispatchEvent(new CustomEvent('cowart:edit-selection')),
            ],
            [
              '用作参考图',
              () =>
                editor
                  .getContainer()
                  .dispatchEvent(new CustomEvent('cowart:reference-selection')),
            ],
            ['下载所选原图', () => onDownload()],
            [
              '裁剪所选图片',
              () =>
                editor.container.dispatchEvent(
                  new CustomEvent('cowart:crop-selection'),
                ),
            ],
            ['复制一份', () => editor.duplicateSelected()],
            ['组合', () => editor.groupSelected()],
            ['取消组合', () => editor.ungroupSelected()],
            ['置于顶层', () => editor.reorder('front')],
            ['置于底层', () => editor.reorder('back')],
            ['加入框架', () => editor.frameSelection()],
            ['移除框架', () => editor.removeFrames()],
            ['框架适应内容', () => editor.fitFrames()],
            ['全选', () => editor.selectAll()],
            [
              '锁定 / 解锁',
              () =>
                editor.updateShapes(
                  editor
                    .getSelectedShapes()
                    .map((s) => ({ id: s.id, isLocked: !s.isLocked })),
                ),
            ],
            [
              '删除',
              () =>
                editor.deleteShapes(
                  editor
                    .getSelectedShapes()
                    .filter((s) => !s.isLocked)
                    .map((s) => s.id),
                ),
            ],
          ].map(([label, fn]) => (
            <button
              role="menuitem"
              key={label}
              onClick={() => {
                run(fn)
                setMenu(null)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

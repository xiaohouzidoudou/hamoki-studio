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
  let content
  if (shape.type === 'image') {
    const src = safeImageSource(editor.getAsset(p.assetId)?.props?.src),
      asset = editor.getAsset(p.assetId),
      crop = p.crop
    if (src) {
      const tl = crop?.topLeft || { x: 0, y: 0 },
        br = crop?.bottomRight || { x: 1, y: 1 },
        w = asset?.props?.w || b.w,
        h = asset?.props?.h || b.h
      content = (
        <svg
          width={b.w}
          height={b.h}
          viewBox={`${tl.x * w} ${tl.y * h} ${Math.max(1, (br.x - tl.x) * w)} ${Math.max(1, (br.y - tl.y) * h)}`}
          preserveAspectRatio="none"
          overflow="hidden"
        >
          <image
            href={src}
            width={w}
            height={h}
            preserveAspectRatio="none"
            transform={`${p.flipX || p.flipY ? `translate(${p.flipX ? w : 0} ${p.flipY ? h : 0}) scale(${p.flipX ? -1 : 1} ${p.flipY ? -1 : 1})` : ''}`}
          />
        </svg>
      )
    } else
      content = (
        <>
          <rect width={b.w} height={b.h} fill="#402b2c" />
          <text x="12" y="28" fill="#ffb4ae">
            原图暂不可读取
          </text>
        </>
      )
  } else if (shape.type === 'frame')
    content = (
      <>
        <rect
          width={b.w}
          height={b.h}
          rx="8"
          fill="#284938"
          fillOpacity=".18"
          stroke={color}
          strokeWidth="1.5"
          strokeDasharray={shape.meta?.cowartAiImageHolder ? '8 5' : undefined}
        />
        <text x="10" y="-9" fill={color} fontSize="13">
          {p.name || '占位框'}
        </text>
      </>
    )
  else if (shape.type === 'group') return null
  else if (shape.type === 'arrow') {
    const a = p.start || { x: 0, y: 0 },
      e = p.end || { x: 160, y: 80 },
      r = Math.atan2(e.y - a.y, e.x - a.x),
      head = `${e.x},${e.y} ${e.x - 14 * Math.cos(r - 0.45)},${e.y - 14 * Math.sin(r - 0.45)} ${e.x - 14 * Math.cos(r + 0.45)},${e.y - 14 * Math.sin(r + 0.45)}`
    content = (
      <>
        <path
          d={`M ${a.x} ${a.y} L ${e.x} ${e.y}`}
          stroke={color}
          strokeWidth="2.5"
          fill="none"
        />
        <polygon points={head} fill={color} />
        <path
          d={`M ${a.x} ${a.y} L ${e.x} ${e.y}`}
          stroke="transparent"
          strokeWidth="18"
        />
        <text
          x={(a.x + e.x) / 2}
          y={(a.y + e.y) / 2 - 12}
          fill={color}
          fontSize="18"
        >
          {plainText(p.richText || p.text)}
        </text>
      </>
    )
  } else if (shape.type === 'text' || shape.type === 'note') {
    const size = p.fontSize || { s: 16, m: 22, l: 30, xl: 40 }[p.size] || 22
    content = (
      <>
        {shape.type === 'note' && (
          <rect width={b.w} height={b.h} rx="9" fill="#3b4831" />
        )}
        <rect width={b.w} height={b.h} fill="transparent" />
        {plainText(p.richText || p.text)
          .split('\n')
          .map((line, i) => (
            <text
              key={i}
              x={shape.type === 'note' ? 12 : 0}
              y={size + i * (size * 1.35)}
              fontSize={size}
              fontFamily="system-ui,sans-serif"
              fill={color}
            >
              {line || ' '}
            </text>
          ))}
      </>
    )
  } else if (shape.type === 'geo')
    content =
      p.geo === 'ellipse' ? (
        <ellipse
          cx={b.w / 2}
          cy={b.h / 2}
          rx={b.w / 2}
          ry={b.h / 2}
          fill={p.fill === 'none' ? 'transparent' : color}
          fillOpacity=".2"
          stroke={color}
          strokeWidth="2"
        />
      ) : (
        <rect
          width={b.w}
          height={b.h}
          rx="7"
          fill={p.fill === 'none' ? 'transparent' : color}
          fillOpacity=".2"
          stroke={color}
          strokeWidth="2"
        />
      )
  else
    content = (
      <>
        <rect
          width={b.w}
          height={b.h}
          fill="#403a28"
          fillOpacity=".4"
          stroke="#cfbc79"
          strokeDasharray="5 5"
        />
        <text x="10" y="25" fill="#e8d797" fontSize="13">
          旧元素 · {String(shape.type)}（保留）
        </text>
      </>
    )
  return (
    <g
      data-shape-id={shape.id}
      data-shape-type={shape.type}
      transform={`matrix(${m.join(' ')})`}
      opacity={shape.opacity ?? 1}
      style={{ cursor: shape.isLocked ? 'not-allowed' : 'move' }}
    >
      {content}
      {selected && (
        <rect
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
export default function CanvasView({ editor, onImport, onDownload, onNotice }) {
  useSyncExternalStore(
    (fn) => editor.store.listen(fn, { source: 'all', scope: 'all' }),
    () => editor.revision,
  )
  const svg = useRef(null),
    gesture = useRef(null),
    space = useRef(false),
    touches = useRef(new Map()),
    pinch = useRef(null)
  const [marquee, setMarquee] = useState(null),
    [draft, setDraft] = useState(null),
    [menu, setMenu] = useState(null),
    [editing, setEditing] = useState(null),
    [text, setText] = useState('')
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
  const finishText = () => {
    if (editing) {
      editor.updateShape({
        id: editing,
        type: editor.getShape(editing)?.type,
        props: {
          richText: toRichText(text),
          h: Math.max(50, text.split('\n').length * 30),
        },
      })
      setEditing(null)
    }
  }
  const editShape = (shape) => {
    setEditing(shape.id)
    setText(plainText(shape.props?.richText || shape.props?.text))
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
      editor.getShape(shape.parentId)?.type === 'group'
    ) {
      seen.add(shape.id)
      shape = editor.getShape(shape.parentId)
    }
    return shape
  }
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
        return
      }
      const command = e.ctrlKey || e.metaKey
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
      else if (!command && e.key.toLowerCase() === 'h')
        editor.setCurrentTool('hand')
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
    document.addEventListener('keydown', down)
    document.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    document.addEventListener('paste', paste)
    return () => {
      document.removeEventListener('keydown', down)
      document.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      document.removeEventListener('paste', paste)
    }
  }, [editor, onImport])
  function start(e) {
    if (e.button === 2) return
    if (editing) finishText()
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
    const handle = e.target.dataset.handle
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
      if (kind === 'text') {
        const id = createShapeId()
        editor.createShape({
          id,
          type: 'text',
          x: point.x,
          y: point.y,
          props: { w: 260, h: 70, richText: toRichText('') },
        })
        editor.select(id)
        editShape(editor.getShape(id))
        editor.setCurrentTool('select')
        return
      }
      gesture.current = { kind: 'create', type: kind, point }
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
            x: s.x + (e.shiftKey ? Math.round(d.x / 10) * 10 : d.x),
            y: s.y + (e.shiftKey ? Math.round(d.y / 10) * 10 : d.y),
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
            ...(s.type === 'group'
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
              s.parentId === editor.pageId &&
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
    if (g?.kind === 'create') {
      const p = editor.screenToPage({ x: e.clientX, y: e.clientY }),
        b = {
          x: Math.min(p.x, g.point.x),
          y: Math.min(p.y, g.point.y),
          w: Math.max(30, Math.abs(p.x - g.point.x)),
          h: Math.max(30, Math.abs(p.y - g.point.y)),
        },
        id = createShapeId()
      editor.createShape({
        id,
        type:
          g.type === 'holder'
            ? 'frame'
            : g.type === 'rectangle' || g.type === 'ellipse'
              ? 'geo'
              : g.type,
        x: b.x,
        y: b.y,
        meta:
          g.type === 'holder'
            ? { cowartAiImageHolder: true, cowartAiAspectRatio: b.w / b.h }
            : {},
        props: {
          w: b.w,
          h: b.h,
          geo: g.type === 'ellipse' ? 'ellipse' : 'rectangle',
          fill: 'none',
          name: 'AI 图片',
          color: g.type === 'arrow' ? 'red' : 'green',
          ...(g.type === 'arrow'
            ? {
                start: { x: g.point.x - b.x, y: g.point.y - b.y },
                end: { x: p.x - b.x, y: p.y - b.y },
                richText: toRichText(''),
              }
            : {}),
        },
      })
      editor.select(id)
      editor.setCurrentTool('select')
    }
    editor.endGesture()
    setMarquee(null)
    setDraft(null)
  }
  const double = (e) => {
    const shape =
      hitShape(e.target) ||
      editor.hitTest(editor.screenToPage({ x: e.clientX, y: e.clientY }))
    if (!shape) return
    editor.select(shape.id)
    if (shape.type === 'image')
      editor
        .getContainer()
        .dispatchEvent(
          new CustomEvent('cowart:preview-image', { detail: shape.id }),
        )
    else if (['text', 'note', 'arrow'].includes(shape.type)) editShape(shape)
  }
  const shapeBeingEdited = editing && editor.getShape(editing),
    editBounds = shapeBeingEdited && editor.getShapePageBounds(shapeBeingEdited)
  return (
    <>
      <svg
        ref={svg}
        className="hamoki-board"
        aria-label="图片画布"
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
        <rect width="100%" height="100%" fill="url(#hamoki-grid)" />
        <g transform={`scale(${zoom}) translate(${camera.x} ${camera.y})`}>
          {editor.getCurrentPageShapes().map((shape) => (
            <Shape key={shape.id} shape={shape} editor={editor} />
          ))}
          {draft && (
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
          {bounds &&
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
        <textarea
          className="hamoki-text-editor"
          aria-label="编辑标注文字"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={finishText}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
              setEditing(null)
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              finishText()
            }
          }}
          style={{
            left: (editBounds.x + camera.x) * zoom,
            top: (editBounds.y + camera.y) * zoom,
            width: Math.max(180, editBounds.w * zoom),
            height: Math.max(90, editBounds.h * zoom),
          }}
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
            ['复制一份', () => editor.duplicateSelected()],
            ['组合', () => editor.groupSelected()],
            ['取消组合', () => editor.ungroupSelected()],
            ['置于顶层', () => editor.bringToFront()],
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

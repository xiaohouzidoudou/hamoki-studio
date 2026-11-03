import { useState, useRef } from 'react'
import { safeImageSource } from './model.js'
export default function CropEditor({ editor, shape, onClose }) {
  const asset = editor.getAsset(shape.props.assetId),
    stage = useRef(null),
    gesture = useRef(null),
    [crop, setCrop] = useState(
      shape.props.crop || {
        topLeft: { x: 0, y: 0 },
        bottomRight: { x: 1, y: 1 },
      },
    )
  const p = crop.topLeft,
    q = crop.bottomRight
  function start(e, handle) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    gesture.current = {
      handle,
      x: e.clientX,
      y: e.clientY,
      before: structuredClone(crop),
    }
  }
  function move(e) {
    const g = gesture.current
    if (!g) return
    const r = stage.current.getBoundingClientRect(),
      dx = (e.clientX - g.x) / r.width,
      dy = (e.clientY - g.y) / r.height,
      c = structuredClone(g.before),
      a = c.topLeft,
      b = c.bottomRight
    if (g.handle === 'move') {
      const x = Math.max(-a.x, Math.min(1 - b.x, dx)),
        y = Math.max(-a.y, Math.min(1 - b.y, dy))
      a.x += x
      b.x += x
      a.y += y
      b.y += y
    } else {
      if (g.handle.includes('w'))
        a.x = Math.max(0, Math.min(b.x - 0.02, a.x + dx))
      if (g.handle.includes('e'))
        b.x = Math.min(1, Math.max(a.x + 0.02, b.x + dx))
      if (g.handle.includes('n'))
        a.y = Math.max(0, Math.min(b.y - 0.02, a.y + dy))
      if (g.handle.includes('s'))
        b.y = Math.min(1, Math.max(a.y + 0.02, b.y + dy))
    }
    setCrop(c)
  }
  return (
    <div
      className="hamoki-crop-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="无损裁剪图片"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <section>
        <header>
          <strong>裁剪图片</strong>
          <span>拖动范围或四角，原图会完整保留</span>
        </header>
        <div
          ref={stage}
          className="hamoki-crop-stage"
          style={{
            aspectRatio: `${asset?.props.w || 1}/${asset?.props.h || 1}`,
            width: `min(100%, ${(65 * (asset?.props.w || 1)) / (asset?.props.h || 1)}vh)`,
            margin: 'auto',
          }}
        >
          <img
            src={safeImageSource(asset?.props.src) || undefined}
            alt="裁剪原图"
            draggable="false"
          />
          <div
            className="hamoki-crop-area"
            aria-label="裁剪范围"
            style={{
              left: p.x * 100 + '%',
              top: p.y * 100 + '%',
              width: (q.x - p.x) * 100 + '%',
              height: (q.y - p.y) * 100 + '%',
            }}
            onPointerDown={(e) => start(e, 'move')}
            onPointerMove={move}
            onPointerUp={() => (gesture.current = null)}
            onPointerCancel={() => (gesture.current = null)}
          >
            {['nw', 'ne', 'sw', 'se'].map((corner) => (
              <button
                key={corner}
                className={'crop-' + corner}
                aria-label={'裁剪角 ' + corner}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  start(e, corner)
                }}
                onPointerMove={(e) => {
                  e.stopPropagation()
                  move(e)
                }}
                onPointerUp={(e) => {
                  e.stopPropagation()
                  gesture.current = null
                }}
              />
            ))}
          </div>
        </div>
        <footer>
          <button
            onClick={() =>
              setCrop({ topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } })
            }
          >
            重置范围
          </button>
          <button autoFocus onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            onClick={() => {
              const ratio =
                ((asset?.props.h || shape.props.h) * (q.y - p.y)) /
                ((asset?.props.w || shape.props.w) * (q.x - p.x))
              editor.updateShape({
                id: shape.id,
                props: { crop, h: Math.max(16, shape.props.w * ratio) },
              })
              onClose()
            }}
          >
            应用裁剪
          </button>
        </footer>
      </section>
    </div>
  )
}

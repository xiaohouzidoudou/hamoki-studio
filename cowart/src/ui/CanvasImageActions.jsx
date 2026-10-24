import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ImageShapeUtil, useEditor, useValue } from 'tldraw'
import './canvas-image-actions.css'

export class CowartImageShapeUtil extends ImageShapeUtil {
  onDoubleClick(shape) {
    const asset = this.editor.getAsset(shape.props.assetId)
    if (!localImageSource(asset?.props?.src)) return
    this.editor.getContainer().dispatchEvent(new CustomEvent('cowart:preview-image', { detail: shape.id }))
    // A handled shape change keeps the select tool from entering crop mode.
    return { id: shape.id, type: shape.type }
  }
}

function localImageSource(source) {
  if (typeof source !== 'string') return null
  if (source.startsWith('data:image/') || source.startsWith('blob:')) return source
  try {
    const url = new URL(source, window.location.href)
    return url.origin === window.location.origin && ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch { return null }
}

function ImagePreview({ image, onClose, returnFocusTo }) {
  const closeButton = useRef(null)
  const dialog = useRef(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previous = document.activeElement
    const keyboard = event => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); close.current() }
      if (event.key === 'Tab') { event.preventDefault(); closeButton.current?.focus() }
    }
    const focus = event => {
      if (!dialog.current?.contains(event.target)) closeButton.current?.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', keyboard, true)
    document.addEventListener('focusin', focus, true)
    closeButton.current?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('keydown', keyboard, true)
      document.removeEventListener('focusin', focus, true)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
      else if (returnFocusTo?.isConnected) returnFocusTo.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(<div ref={dialog} className="cowart-image-preview" role="dialog" aria-modal="true" aria-label="原图预览"
    onPointerDown={event => {
      event.stopPropagation()
      event.preventDefault()
      if (event.target.tagName !== 'IMG') onClose()
    }}
    onPointerUp={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
    onWheel={event => event.stopPropagation()}>
    <button ref={closeButton} type="button" className="cowart-image-preview-close" onClick={onClose} aria-label="关闭原图预览">×</button>
    <img className="cowart-image-preview-image" src={image.src} alt={image.altText || '所选原图'} draggable={false} />
    <p>原图 · {image.width} × {image.height} · 点击图片外关闭</p>
  </div>, document.body)
}

export default function CanvasImageActions() {
  const editor = useEditor()
  const [previewId, setPreviewId] = useState(null)
  const preview = useValue('original image preview', () => {
    const shape = previewId && editor.getShape(previewId)
    const asset = shape?.type === 'image' && editor.getAsset(shape.props.assetId)
    const src = localImageSource(asset?.props?.src)
    return src ? { src, altText: shape.props.altText, width: asset.props.w, height: asset.props.h } : null
  }, [editor, previewId])
  const selection = useValue('selected image actions', () => {
    const shapes = editor.getSelectedShapes()
    if (shapes.length !== 1 || shapes[0].type !== 'image' || !editor.isIn('select')) return null
    if (!localImageSource(editor.getAsset(shapes[0].props.assetId)?.props?.src)) return null
    const bounds = editor.getShapePageBounds(shapes[0])
    if (!bounds) return null
    // tldraw's native image toolbar occupies the space above the selection.
    const point = editor.pageToScreen({ x: bounds.x, y: bounds.y + bounds.h })
    const viewport = editor.getContainer().getBoundingClientRect()
    return { id: shapes[0].id, left: Math.max(8, Math.min(point.x - viewport.left, viewport.width - 224)),
      top: Math.max(8, Math.min(point.y - viewport.top + 8, viewport.height - 96)) }
  }, [editor])
  useEffect(() => {
    const container = editor.getContainer()
    const open = event => setPreviewId(event.detail)
    container.addEventListener('cowart:preview-image', open)
    return () => container.removeEventListener('cowart:preview-image', open)
  }, [editor])
  return <>
    {selection && !preview && <div className="cowart-image-actions" role="toolbar" aria-label="所选图片操作"
      style={{ left: selection.left, top: selection.top }} onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
      <button type="button" onClick={() => setPreviewId(selection.id)}>预览原图</button>
      <button type="button" onClick={() => editor.getContainer().dispatchEvent(new CustomEvent('cowart:edit-selection'))}>修改这张图</button>
    </div>}
    {preview && <ImagePreview image={preview} onClose={() => setPreviewId(null)} returnFocusTo={editor.getContainer()} />}
  </>
}

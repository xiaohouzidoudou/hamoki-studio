import { useCallback, useEffect, useRef, useState } from 'react'
import { CanvasDocument, createShapeId } from './canvas/model.js'
import CanvasControls from './canvas/CanvasControls.jsx'
import CanvasView from './canvas/CanvasView.jsx'
import { originalImagesZip } from './canvas/download.js'
import { sanitizeCanvasSnapshot } from './canvasSnapshot.js'
import {
  loadCanvasSnapshot,
  saveCanvasSnapshot,
  readViewState,
  writeViewState,
} from './lib/storage.js'
import { createSaveState } from './lib/saveState.js'
import { applySavedAssetSources } from './lib/canvasAssets.js'
import StudioPanel from './ui/StudioPanel.jsx'
import './canvas/canvas.css'
function Icon({ name }) {
  const paths = {
    select: 'M5 3 19 13 12 14 9 21Z',
    hand: 'M8 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v8c0 5-3 7-7 7h-1c-2 0-4-2-5-4l-3-5a2 2 0 0 1 3-2l1 1Z',
    holder: 'M4 4H20V20H4ZM8 10l3 3 5-6',
    rectangle: 'M4 5H20V19H4Z',
    ellipse: 'M20 12a8 7 0 1 1-16 0 8 7 0 1 1 16 0',
    arrow: 'M4 20 20 4M9 4H20V15',
    text: 'M4 5H20M12 5V20M8 20H16',
    upload: 'M12 16V3M6 9 12 3 18 9M4 15V21H20V15',
    download: 'M12 3V17M6 11 12 17 18 11M4 17V21H20V17',
    undo: 'M8 4 3 9 8 14M3 9H14a6 6 0 0 1 0 12',
    redo: 'M16 4 21 9 16 14M21 9H10a6 6 0 0 0 0 12',
    fit: 'M3 9V3H9M15 3H21V9M21 15V21H15M9 21H3V15M8 8H16V16H8Z',
    trash: 'M4 6H20M9 6V3H15V6M6 6 7 21H17L18 6',
    plus: 'M12 4V20M4 12H20',
  }
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.select} />
    </svg>
  )
}
const fileData = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
const sizeOf = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () =>
      resolve({ w: image.naturalWidth, h: image.naturalHeight })
    image.onerror = () => reject(Error('图片文件无法解码'))
    image.src = src
  })
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
export default function App() {
  const container = useRef(null),
    editorRef = useRef(null),
    retrySave = useRef(null),
    raw = useRef(null),
    fileInput = useRef(null)
  const [loaded, setLoaded] = useState(null),
    [editor, setEditor] = useState(null),
    [error, setError] = useState(''),
    [saveError, setSaveError] = useState(''),
    [status, setStatus] = useState('已同步'),
    [warnings, setWarnings] = useState([]),
    [open, setOpen] = useState(true),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0)
  const getEditor = useCallback(() => editorRef.current, [])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [canvas, view] = await Promise.all([
          loadCanvasSnapshot(),
          readViewState(),
        ])
        if (cancelled) return
        raw.current = canvas.snapshot
        const safe = sanitizeCanvasSnapshot(canvas.snapshot)
        setWarnings(safe.skippedRecords)
        setLoaded({ snapshot: safe.snapshot, view: view.viewState })
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    if (!loaded || !container.current) return
    const doc = new CanvasDocument(loaded.snapshot, container.current)
    editorRef.current = doc
    window.__cowartEditor = doc
    try {
      const style = JSON.parse(localStorage.getItem('hamoki-canvas-style'))
      if (style && typeof style === 'object')
        for (const key of [
          'color',
          'fill',
          'dash',
          'size',
          'font',
          'textAlign',
          'verticalAlign',
          'kind',
          'spline',
          'arrowheadStart',
          'arrowheadEnd',
          'bold',
          'italic',
          'underline',
          'strike',
          'opacity',
        ])
          if (['string', 'boolean', 'number'].includes(typeof style[key]))
            doc.style[key] = style[key]
    } catch {}
    try {
      const prefs = JSON.parse(
        localStorage.getItem('hamoki-canvas-preferences'),
      )
      if (prefs && typeof prefs === 'object')
        for (const key of Object.keys(doc.preferences))
          if (typeof prefs[key] === 'boolean') doc.preferences[key] = prefs[key]
    } catch {}
    if (loaded.view?.currentPageId)
      doc.setCurrentPage(loaded.view.currentPageId)
    if (loaded.view?.camera) doc.setCamera(loaded.view.camera)
    setEditor(doc)
    const state = createSaveState()
    let timer,
      viewTimer,
      saving = false,
      pending = false,
      disposed = false
    const schedule = () => {
      state.changed()
      setStatus('待保存')
      clearTimeout(timer)
      timer = setTimeout(save, 500)
    }
    async function save() {
      if (!state.dirty || disposed) return
      if (saving) {
        pending = true
        return
      }
      saving = true
      setStatus('保存中…')
      const captured = state.capture()
      try {
        const result = await saveCanvasSnapshot(doc.store.getStoreSnapshot())
        if (result.storage !== 'studio')
          throw Error('画布未保存，请保留备份并重试')
        applySavedAssetSources(doc, result.assetReplacements)
        state.acknowledge(captured)
        if (!disposed) {
          setSaveError('')
          setStatus(state.dirty ? '待保存' : '已同步')
        }
      } catch (e) {
        if (!disposed) {
          setSaveError(e.message)
          setStatus('未同步')
        }
      } finally {
        saving = false
        if (pending && !disposed) {
          pending = false
          clearTimeout(timer)
          timer = setTimeout(save, 100)
        }
      }
    }
    retrySave.current = save
    const off = doc.store.listen(schedule, {
      source: 'user',
      scope: 'document',
    })
    const session = doc.store.listen(
      () => {
        setRevision((x) => x + 1)
        clearTimeout(viewTimer)
        viewTimer = setTimeout(
          () =>
            writeViewState({
              version: 1,
              currentPageId: doc.pageId,
              camera: doc.getCamera(),
              updatedAt: new Date().toISOString(),
            }).catch((e) => {
              if (!disposed) setNotice('视图位置未保存：' + e.message)
            }),
          300,
        )
      },
      { source: 'all', scope: 'all' },
    )
    const edit = () => {
      setOpen(true)
      requestAnimationFrame(() =>
        document.querySelector('.hamoki-studio-panel textarea')?.focus(),
      )
    }
    const beforeUnload = (e) => {
      if (state.dirty || saving) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    doc.container.addEventListener('cowart:edit-selection', edit)
    doc.container.addEventListener('cowart:reference-selection', edit)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      disposed = true
      clearTimeout(timer)
      clearTimeout(viewTimer)
      off()
      session()
      doc.container.removeEventListener('cowart:edit-selection', edit)
      doc.container.removeEventListener('cowart:reference-selection', edit)
      window.removeEventListener('beforeunload', beforeUnload)
      if (window.__cowartEditor === doc) delete window.__cowartEditor
      if (editorRef.current === doc) editorRef.current = null
    }
  }, [loaded])
  const importFiles = useCallback(async (files, point) => {
    const doc = editorRef.current
    if (!doc) return
    try {
      if (files.length > 20) throw Error('每次最多导入 20 张图片')
      const records = [],
        origin = point || doc.getViewportPageBounds().center
      let x = origin.x,
        index = doc.nextIndex()
      for (const file of files) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
          throw Error('请导入 PNG、JPG 或 WebP 图片')
        if (!file.size || file.size > 12 * 1024 * 1024)
          throw Error('单张图片需小于 12MB')
        const src = await fileData(file),
          size = await sizeOf(src),
          w = Math.min(512, size.w),
          h = (w * size.h) / size.w,
          assetId = 'asset:' + crypto.randomUUID(),
          id = createShapeId()
        records.push(
          {
            id: assetId,
            typeName: 'asset',
            type: 'image',
            meta: {},
            props: {
              src,
              name: file.name,
              mimeType: file.type,
              w: size.w,
              h: size.h,
              fileSize: file.size,
              isAnimated: false,
            },
          },
          {
            id,
            typeName: 'shape',
            type: 'image',
            parentId: doc.getCurrentPageId(),
            x,
            y: origin.y,
            rotation: 0,
            index,
            opacity: 1,
            isLocked: false,
            meta: {},
            props: { w, h, assetId, altText: file.name, crop: null },
          },
        )
        x += w + 40
        index = doc.nextIndex(doc.pageId, index)
      }
      if (!point && records.length) {
        const shapes = records.filter((record) => record.typeName === 'shape')
        const span = x - origin.x - 40
        const height = Math.max(...shapes.map((shape) => shape.props.h))
        for (const shape of shapes) {
          shape.x -= span / 2
          shape.y -= height / 2
        }
      }
      doc.store.put(records)
      doc.select(
        ...records.filter((r) => r.typeName === 'shape').map((r) => r.id),
      )
      setNotice('已导入 ' + files.length + ' 张图片，正在保存')
    } catch (e) {
      setNotice(e.message)
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }, [])
  const download = useCallback(async () => {
    const doc = editorRef.current
    if (!doc) return
    try {
      setNotice('正在准备下载…')
      const originals = await originalImagesZip(doc)
      if (originals) downloadBlob(originals.blob, originals.name)
      else {
        const result = await doc.toImageDataUrl(doc.getSelectedShapeIds(), {
          pixelRatio: 2,
          background: false,
        })
        downloadBlob(
          await (await fetch(result.url)).blob(),
          'hamoki-selection.png',
        )
      }
      setNotice('下载已准备完成')
    } catch (e) {
      setNotice(e.message)
    }
  }, [])
  const exportDocument = () =>
    downloadBlob(
      new Blob(
        [
          JSON.stringify(
            editor ? editor.store.getStoreSnapshot() : raw.current,
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
      'hamoki-canvas-backup.json',
    )
  const run = (fn) => {
    try {
      fn()
    } catch (e) {
      setNotice(e.message)
    }
  }
  if (error)
    return (
      <main className="hamoki-load-error">
        <h1>画布读取失败</h1>
        <p>{error}</p>
        <p>已停止保存，服务器原始画布不会被覆盖。</p>
        <button disabled={!raw.current} onClick={exportDocument}>
          导出原始画布备份
        </button>
        <button onClick={() => location.reload()}>重新加载</button>
      </main>
    )
  if (!loaded) return <main className="cowart-status">正在读取画布…</main>
  const selected = editor?.getSelectedShapes() || [],
    one = selected.length === 1 ? selected[0] : null
  function setDimension(key, value) {
    if (!one || one.isLocked) return
    const size = Number(value)
    if (!Number.isFinite(size) || size < 16 || size > 8192) return
    const props = { [key]: size }
    if (one.type === 'image' || one.meta?.cowartAiAspectLocked) {
      const other = key === 'w' ? 'h' : 'w'
      props[other] = size * (one.props[other] / one.props[key])
    }
    editor.updateShape({ id: one.id, props })
  }
  return (
    <main
      className={
        'cowart-canvas' +
        (open ? ' with-studio-panel' : '') +
        (editor?.preferences.focus ? ' hamoki-focus' : '')
      }
      data-canvas-engine="hamoki-native-v1"
    >
      <div ref={container} className="hamoki-canvas tl-container">
        {editor && (
          <CanvasView
            editor={editor}
            onImport={importFiles}
            onImportRequest={() => fileInput.current?.click()}
            onDownload={download}
            onNotice={setNotice}
          />
        )}
        <div className="hamoki-canvas-header">
          <img src="/assets/hamoki-avatar-32.png" alt="" />
          <strong>Hamoki Canvas</strong>
          <span className={'hamoki-sync ' + (saveError ? 'is-error' : '')}>
            {status}
          </span>
        </div>
        {editor && (
          <>
            <CanvasControls
              editor={editor}
              onNotice={setNotice}
              onImport={() => fileInput.current?.click()}
              onBackup={exportDocument}
              onDownload={download}
            />
            <div className="hamoki-tools" role="toolbar" aria-label="画布工具">
              {[
                ['select', '选择 · V'],
                ['hand', '移动画布 · H'],
                ['holder', 'AI 占位框'],
                ['rectangle', '矩形'],
                ['ellipse', '椭圆'],
                ['arrow', '箭头标注'],
                ['text', '文字'],
              ].map(([tool, label]) => (
                <button
                  key={tool}
                  title={label}
                  aria-label={label}
                  aria-pressed={editor.tool === tool}
                  onClick={() => editor.setCurrentTool(tool)}
                >
                  <Icon name={tool} />
                </button>
              ))}
              <span className="hamoki-tool-divider" />
              <button
                title="导入图片"
                aria-label="导入图片"
                onClick={() => fileInput.current?.click()}
              >
                <Icon name="upload" />
              </button>
              <button
                title="撤销"
                aria-label="撤销"
                disabled={!editor.history.length}
                onClick={() => editor.undo()}
              >
                <Icon name="undo" />
              </button>
              <button
                title="重做"
                aria-label="重做"
                disabled={!editor.future.length}
                onClick={() => editor.redo()}
              >
                <Icon name="redo" />
              </button>
            </div>
            <div className="hamoki-view-controls">
              <button
                aria-label="缩小"
                onClick={() =>
                  editor.zoomAt(
                    {
                      x:
                        container.current.getBoundingClientRect().left +
                        container.current.clientWidth / 2,
                      y: container.current.clientHeight / 2,
                    },
                    0.8,
                  )
                }
              >
                −
              </button>
              <button
                aria-label="重置缩放"
                onClick={() => editor.setCamera({ ...editor.camera, z: 1 })}
              >
                {Math.round(editor.camera.z * 100)}%
              </button>
              <button
                aria-label="放大"
                onClick={() =>
                  editor.zoomAt(
                    {
                      x:
                        container.current.getBoundingClientRect().left +
                        container.current.clientWidth / 2,
                      y: container.current.clientHeight / 2,
                    },
                    1.25,
                  )
                }
              >
                +
              </button>
              <button
                aria-label="适合画布"
                title="适合画布"
                onClick={() => editor.zoomToFit()}
              >
                <Icon name="fit" />
              </button>
              <span />
              <select
                aria-label="画布页面"
                value={editor.pageId}
                onChange={(e) => editor.setCurrentPage(e.target.value)}
              >
                {editor.getPages().map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || '画布'}
                  </option>
                ))}
              </select>
              <button
                aria-label="新增画布页面"
                onClick={() => {
                  const id = 'page:' + crypto.randomUUID()
                  editor.createPage({
                    id,
                    name: '画布 ' + (editor.getPages().length + 1),
                  })
                  editor.setCurrentPage(id)
                }}
              >
                <Icon name="plus" />
              </button>
            </div>
            {!editor.getCurrentPageShapes().length && (
              <div className="hamoki-empty-hint">
                <strong>把灵感放上画布</strong>
                <span>拖入图片，或创建 AI 占位框</span>
                <small>空格 / 中键拖动画布 · 滚轮缩放 · 双击预览原图</small>
              </div>
            )}
            {!!selected.length && (
              <div
                className="hamoki-selection-properties"
                aria-label="所选元素属性"
              >
                <strong>{selected.length} 个元素</strong>
                {one && one.type !== 'arrow' && one.type !== 'group' && (
                  <>
                    <label>
                      宽
                      <input
                        aria-label="元素宽度"
                        type="number"
                        min="16"
                        max="8192"
                        value={Math.round(one.props.w || 180)}
                        onChange={(e) => setDimension('w', e.target.value)}
                      />
                    </label>
                    <label>
                      高
                      <input
                        aria-label="元素高度"
                        type="number"
                        min="16"
                        max="8192"
                        value={Math.round(one.props.h || 120)}
                        onChange={(e) => setDimension('h', e.target.value)}
                      />
                    </label>
                  </>
                )}
                <div className="hamoki-color-palette">
                  {['green', 'yellow', 'red', 'blue', 'white', 'grey'].map(
                    (color) => (
                      <button
                        key={color}
                        aria-label={'颜色 ' + color}
                        data-color={color}
                        onClick={() => editor.setStyle({ color })}
                      />
                    ),
                  )}
                </div>
                <button aria-label="下载所选内容" onClick={download}>
                  <Icon name="download" />
                </button>
                <button
                  aria-label="删除所选内容"
                  onClick={() =>
                    editor.deleteShapes(
                      selected.filter((s) => !s.isLocked).map((s) => s.id),
                    )
                  }
                >
                  <Icon name="trash" />
                </button>
              </div>
            )}
          </>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          aria-label="选择导入图片"
          onChange={(e) => importFiles([...e.target.files])}
        />
      </div>
      <div className="cowart-ai-launcher">
        <button onClick={() => setOpen((v) => !v)}>
          {open ? '收起 Studio' : '打开 Studio'}
        </button>
        <a className="hamoki-back-link" href="/">
          管理后台 ↗
        </a>
      </div>
      {editor && (
        <StudioPanel
          open={open}
          onClose={() => setOpen(false)}
          getEditor={getEditor}
          canvasEditor={editor}
        />
      )}
      {saveError && (
        <aside className="hamoki-save-error" role="alert">
          <strong>画布尚未同步</strong>：{saveError}
          <button onClick={() => retrySave.current?.()}>重试保存</button>
          <button onClick={exportDocument}>导出当前画布备份</button>
        </aside>
      )}
      {warnings.length > 0 && (
        <details className="hamoki-legacy-warning">
          <summary>{warnings.length} 条旧画布兼容提示（原始记录保留）</summary>
          {warnings.slice(0, 12).map((r, i) => (
            <p key={i}>
              {r.id}：{r.reason}
            </p>
          ))}
          <button onClick={exportDocument}>导出完整备份</button>
        </details>
      )}
      {notice && (
        <div className="hamoki-toast" role="status">
          {notice}
          <button aria-label="关闭提示" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
    </main>
  )
}

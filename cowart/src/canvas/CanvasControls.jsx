import { useState, useRef, useEffect } from 'react'
import { tools, geoPath } from './features.js'
import { safeLink } from './richText.js'
import { colors, createShapeId, toRichText } from './model.js'
import { exportSvg, downloadFile } from './export.js'
function ToolGlyph({ type }) {
  const paths = {
    select: 'M3 2 20 13 12 14 8 22Z',
    hand: 'M6 12V6H10V12V3H14V12V5H18V14L15 21H8L2 14Z',
    holder: 'M2 2H22V22H2ZM6 12L10 16 18 6',
    draw: 'M3 19Q8 2 12 12T21 4',
    eraser: 'M3 15L13 3 22 12 12 22H8Z',
    text: 'M3 4H21M12 4V21M7 21H17',
    arrow: 'M3 21L21 3M10 3H21V14',
    annotation: 'M3 19Q18 20 20 3M12 6L20 3 23 11',
    note: 'M3 2H21V15L15 22H3ZM15 22V15H21',
    line: 'M3 21L12 4 21 17',
    highlight: 'M4 19L18 3 23 8 9 24M2 21H12',
    laser:
      'M12 2V6M2 12H6M18 12H22M12 18V22M5 5L8 8M16 16L19 19M5 19L8 16M16 8L19 5',
    frame: 'M4 0V24M20 0V24M0 4H24M0 20H24',
  }
  return (
    <svg
      width="22"
      height="22"
      viewBox="-2 -2 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d={paths[type] || geoPath(type, 24, 24)} />
    </svg>
  )
}
const styles = [
  [
    'fill',
    '填充',
    [
      ['none', '无'],
      ['semi', '半透明'],
      ['solid', '实心'],
      ['pattern', '纹理'],
    ],
  ],
  [
    'dash',
    '线型',
    [
      ['solid', '实线'],
      ['dashed', '虚线'],
      ['dotted', '点线'],
      ['draw', '手绘'],
    ],
  ],
  [
    'size',
    '尺寸',
    [
      ['s', '小'],
      ['m', '中'],
      ['l', '大'],
      ['xl', '特大'],
    ],
  ],
  [
    'font',
    '字体',
    [
      ['draw', '手写'],
      ['sans', '无衬线'],
      ['serif', '衬线'],
      ['mono', '等宽'],
    ],
  ],
  [
    'textAlign',
    '文字对齐',
    [
      ['start', '左'],
      ['middle', '居中'],
      ['end', '右'],
    ],
  ],
  [
    'verticalAlign',
    '垂直对齐',
    [
      ['start', '顶部'],
      ['middle', '居中'],
      ['end', '底部'],
    ],
  ],
  [
    'kind',
    '箭头路径',
    [
      ['arc', '曲线'],
      ['straight', '直线'],
      ['elbow', '折线'],
    ],
  ],
  [
    'spline',
    '线条路径',
    [
      ['line', '直线'],
      ['cubic', '平滑'],
    ],
  ],
  ...['Start', 'End'].map((end, i) => [
    'arrowhead' + end,
    i ? '终点箭头' : '起点箭头',
    [
      ['none', '无'],
      ['arrow', '箭头'],
      ['triangle', '三角'],
      ['dot', '圆点'],
      ['bar', '短线'],
      ['diamond', '菱形'],
      ['square', '方形'],
      ['inverted', '反向三角'],
      ['pipe', '竖线'],
    ],
  ]),
]
export default function CanvasControls({
  editor,
  onNotice,
  onImport,
  onBackup,
  onDownload,
}) {
  const [panel, setPanel] = useState(null),
    [transparent, setTransparent] = useState(false),
    [help, setHelp] = useState(false),
    importInput = useRef(null)
  useEffect(() => {
    const down = (e) => {
      if (e.key === 'Escape') {
        setPanel(null)
        setHelp(false)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])
  const run = async (fn) => {
    try {
      await fn()
    } catch (e) {
      onNotice(e.message)
    }
  }
  const selected = editor.getSelectedShapes(),
    one = selected.length === 1 ? selected[0] : null,
    value = (key) => {
      const targets =
          key === 'opacity'
            ? editor.roots()
            : editor.styleTargets().filter((s) => s.type !== 'image'),
        values = new Set(
          targets.map((s) =>
            key === 'opacity'
              ? (s.opacity ?? 1)
              : (s.props?.[key] ?? editor.style[key]),
          ),
        )
      return values.size > 1
        ? '__mixed__'
        : values.size
          ? [...values][0]
          : editor.style[key]
    },
    applicable = (key) => {
      if (!one) return true
      if (one.type === 'image') return false
      if (key === 'kind' || key.startsWith('arrowhead'))
        return one.type === 'arrow'
      if (key === 'spline') return one.type === 'line'
      if (key === 'fill') return one.type === 'geo'
      if (['font', 'textAlign', 'verticalAlign'].includes(key))
        return ['text', 'note', 'geo', 'arrow'].includes(one.type)
      return true
    }
  const action = (label, fn, disabled = false) => (
    <button key={label} disabled={disabled} onClick={() => run(fn)}>
      {label}
    </button>
  )
  const exportImage = async (type) => {
    const ids = editor.selected.length
      ? editor.selected
      : [...editor.getCurrentPageShapeIds()]
    if (type === 'svg') {
      const result = await exportSvg(editor, ids, { background: !transparent })
      downloadFile(
        new Blob([result.text], { type: 'image/svg+xml' }),
        'hamoki-canvas.svg',
      )
    } else {
      const result = await editor.toImageDataUrl(ids, {
        pixelRatio: 2,
        background: !transparent,
      })
      downloadFile(await (await fetch(result.url)).blob(), 'hamoki-canvas.png')
    }
  }
  const toggle = (key) => {
    editor.preferences = {
      ...editor.preferences,
      [key]: !editor.preferences[key],
    }
    localStorage.setItem(
      'hamoki-canvas-preferences',
      JSON.stringify(editor.preferences),
    )
    editor.notify('session')
  }
  const setProp = (key, val) => {
    editor.setStyle({ [key]: val })
    localStorage.setItem('hamoki-canvas-style', JSON.stringify(editor.style))
  }
  const copy = async (cut = false) => {
    if (cut) {
      const roots = editor.roots()
      if (!roots.length) throw Error('请先解锁需要剪切的元素')
      editor.select(...roots.map((s) => s.id))
    }
    const value = editor.captureSelection()
    editor.clipboard = value
    try {
      await navigator.clipboard.writeText(JSON.stringify(value))
    } catch {
      onNotice('已复制到当前画布剪贴板；可用 Ctrl/⌘+C 复制到系统')
    }
    if (cut) editor.deleteShapes(editor.roots().map((s) => s.id))
  }
  const paste = async () => {
    let text,
      denied = false
    try {
      text = await navigator.clipboard.readText()
    } catch {
      denied = true
    }
    if (text?.startsWith('{"format":"hamoki-clipboard"'))
      editor.pasteSelection(JSON.parse(text))
    else if (text?.trim()) {
      const center = editor.getViewportPageBounds().center,
        id = createShapeId()
      editor.createShape({
        id,
        type: 'text',
        x: center.x,
        y: center.y,
        props: {
          ...editor.style,
          richText: toRichText(text.slice(0, 10000)),
          w: 300,
          h: 70,
        },
      })
      editor.select(id)
    } else if (denied && editor.clipboard)
      editor.pasteSelection(editor.clipboard)
    else onNotice('请使用 Ctrl/⌘+V 粘贴图片、文字或画布元素')
  }
  const insertLink = (type) => {
    const input = prompt(
      type === 'embed' ? '嵌入地址（https://…）' : '链接地址（https://…）',
    )
    if (!input) return
    const url = safeLink(input)
    if (!url || !url.startsWith('https://'))
      throw Error('请输入有效的 HTTPS 地址')
    const center = editor.getViewportPageBounds().center,
      id = createShapeId()
    editor.createShape({
      id,
      type,
      x: center.x - 240,
      y: center.y - 140,
      props: {
        w: 480,
        h: type === 'embed' ? 280 : 100,
        url,
        title: new URL(url).hostname,
        color: 'green',
      },
    })
    editor.select(id)
  }
  const flatten = async () => {
    const roots = editor.roots()
    if (!roots.length) return
    const records = editor.records,
      ids = roots.map((s) => s.id),
      before = new Map(Object.values(records).map((r) => [r.id, r])),
      bounds = editor.getSelectionPageBounds(),
      result = await editor.toImageDataUrl(ids, {
        background: false,
        pixelRatio: 2,
      })
    if (
      [...before].some(([id, r]) => editor.records[id] !== r) ||
      Object.keys(editor.records).length !== before.size
    )
      throw Error('导出期间画布已更新，请重新操作')
    const assetId = 'asset:' + crypto.randomUUID(),
      id = createShapeId()
    editor.transaction(() => {
      editor.createAssets([
        {
          id: assetId,
          type: 'image',
          props: {
            src: result.url,
            w: result.width,
            h: result.height,
            mimeType: 'image/png',
            name: '画布合成.png',
            isAnimated: false,
          },
        },
      ])
      editor.deleteShapes(ids)
      editor.createShape({
        id,
        type: 'image',
        x: bounds.x - 16,
        y: bounds.y - 16,
        props: { assetId, w: bounds.w + 32, h: bounds.h + 32, crop: null },
      })
    })
    editor.select(id)
  }
  const arrange = [
    ['复制', () => copy()],
    ['剪切', () => copy(true)],
    ['粘贴', paste],
    ['左对齐', () => editor.align('x', 'start')],
    ['水平居中', () => editor.align('x', 'center')],
    ['右对齐', () => editor.align('x', 'end')],
    ['顶对齐', () => editor.align('y', 'start')],
    ['垂直居中', () => editor.align('y', 'center')],
    ['底对齐', () => editor.align('y', 'end')],
    ['水平分布', () => editor.distribute('x')],
    ['垂直分布', () => editor.distribute('y')],
    ['横向堆叠', () => editor.distribute('x', 24)],
    ['纵向堆叠', () => editor.distribute('y', 24)],
    ['水平拉伸', () => editor.stretch('x')],
    ['垂直拉伸', () => editor.stretch('y')],
    ['置于底层', () => editor.reorder('back')],
    ['下移一层', () => editor.reorder('backward')],
    ['上移一层', () => editor.reorder('forward')],
    ['置于顶层', () => editor.reorder('front')],
    ['逆时针旋转', () => editor.rotateSelected(-Math.PI / 2)],
    ['顺时针旋转', () => editor.rotateSelected(Math.PI / 2)],
    ['水平翻转', () => editor.flipSelected('x')],
    ['垂直翻转', () => editor.flipSelected('y')],
    ['加入框架', () => editor.frameSelection()],
    ['移除框架', () => editor.removeFrames()],
    ['框架适应内容', () => editor.fitFrames()],
    ['组合', () => editor.groupSelected()],
    ['取消组合', () => editor.ungroupSelected()],
    ['复制一份', () => editor.duplicateSelected()],
    ['转成图片', flatten],
    [
      '转为链接卡片',
      () => {
        if (!one || !safeLink(one.props.url))
          throw Error('请先选择一个元素并设置有效链接')
        editor.updateShape({ id: one.id, type: 'bookmark' })
      },
    ],
    [
      '转为嵌入内容',
      () => {
        if (!one || !safeLink(one.props.url))
          throw Error('请先选择一个元素并设置有效链接')
        editor.updateShape({ id: one.id, type: 'embed' })
      },
    ],
    [
      '锁定 / 解锁',
      () =>
        editor.updateShapes(
          selected.map((s) => ({ id: s.id, isLocked: !s.isLocked })),
        ),
    ],
    [
      '解锁全部',
      () =>
        editor.updateShapes(
          editor
            .getCurrentPageShapes()
            .filter((s) => s.isLocked)
            .map((s) => ({ id: s.id, isLocked: false })),
        ),
    ],
  ]
  return (
    <>
      <div
        className="hamoki-menu-tabs"
        role="toolbar"
        aria-label="完整画布控制"
      >
        {['工具库', '样式', '排列', '页面', '视图', '文件'].map((name) => (
          <button
            key={name}
            aria-expanded={panel === name}
            onClick={() => setPanel(panel === name ? null : name)}
          >
            {name}
          </button>
        ))}
      </div>
      {panel && (
        <section className="hamoki-control-panel" aria-label={panel + '面板'}>
          <header>
            <strong>{panel}</strong>
            <button aria-label="关闭画布面板" onClick={() => setPanel(null)}>
              ×
            </button>
          </header>
          {panel === '工具库' && (
            <div className="hamoki-tool-library">
              {tools.map(([id, label, key]) => (
                <button
                  key={id}
                  title={key ? `${label} · ${key}` : label}
                  aria-label={label}
                  aria-pressed={editor.tool === id}
                  onClick={() => {
                    editor.setCurrentTool(id)
                    setPanel(null)
                  }}
                >
                  <ToolGlyph type={id} />
                  <span>{label}</span>
                </button>
              ))}
              <button
                onClick={() => {
                  onImport()
                  setPanel(null)
                }}
              >
                <ToolGlyph type="holder" />
                <span>导入媒体</span>
              </button>
            </div>
          )}
          {panel === '样式' && (
            <fieldset
              className="hamoki-style-fields"
              disabled={!!selected.length && selected.every((s) => s.isLocked)}
            >
              <p className="hamoki-panel-hint">
                {selected.length
                  ? `应用到 ${selected.length} 个元素及新绘制内容`
                  : '新绘制内容的默认样式'}
              </p>
              <div className="hamoki-full-colors">
                {Object.entries(colors).map(([key, color]) => (
                  <button
                    key={key}
                    aria-label={'样式颜色 ' + key}
                    aria-pressed={value('color') === key}
                    style={{ background: color }}
                    onClick={() => setProp('color', key)}
                  />
                ))}
              </div>
              <label>
                不透明度
                <select
                  aria-label="不透明度"
                  value={value('opacity')}
                  onChange={(e) => setProp('opacity', Number(e.target.value))}
                >
                  {value('opacity') === '__mixed__' && (
                    <option value="__mixed__" disabled>
                      混合
                    </option>
                  )}
                  {[0.1, 0.25, 0.5, 0.75, 1].map((n) => (
                    <option key={n} value={n}>
                      {n * 100}%
                    </option>
                  ))}
                </select>
              </label>
              {styles
                .filter(([key]) => applicable(key))
                .map(([key, label, choices]) => (
                  <label key={key}>
                    {label}
                    <select
                      aria-label={label}
                      value={value(key) || choices[0][0]}
                      onChange={(e) => setProp(key, e.target.value)}
                    >
                      {value(key) === '__mixed__' && (
                        <option value="__mixed__" disabled>
                          混合
                        </option>
                      )}
                      {choices.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              <div className="hamoki-action-grid">
                {[
                  ['bold', '粗体'],
                  ['italic', '斜体'],
                  ['underline', '下划线'],
                  ['strike', '删除线'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    aria-pressed={
                      value(key) === '__mixed__' ? 'mixed' : !!value(key)
                    }
                    onClick={() => setProp(key, !value(key))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {one?.type === 'frame' && (
                <label>
                  框架名称
                  <input
                    aria-label="框架名称"
                    value={one.props.name || ''}
                    onChange={(e) =>
                      editor.updateShape({
                        id: one.id,
                        props: { name: e.target.value.slice(0, 100) },
                      })
                    }
                  />
                </label>
              )}
              {one?.type === 'text' && (
                <label>
                  文字自动宽度
                  <input
                    aria-label="文字自动宽度"
                    type="checkbox"
                    checked={!!one.props.autoSize}
                    onChange={(e) =>
                      editor.updateShape({
                        id: one.id,
                        props: { autoSize: e.target.checked },
                      })
                    }
                  />
                </label>
              )}
              {one && (
                <label>
                  元素链接
                  <input
                    aria-label="元素链接"
                    type="url"
                    placeholder="https://…"
                    value={one.props.url || ''}
                    onChange={(e) =>
                      editor.updateShape({
                        id: one.id,
                        props: { url: e.target.value.slice(0, 2000) },
                      })
                    }
                  />
                </label>
              )}
              {one?.type === 'arrow' && (
                <label>
                  弯曲
                  <input
                    aria-label="箭头弯曲"
                    type="range"
                    min="-250"
                    max="250"
                    value={one.props.bend || 0}
                    onChange={(e) =>
                      editor.updateShape({
                        id: one.id,
                        props: { bend: Number(e.target.value) },
                      })
                    }
                  />
                </label>
              )}
              {one?.type === 'image' && (
                <>
                  {action('拖动裁剪图片', () =>
                    editor.container.dispatchEvent(
                      new CustomEvent('cowart:crop-selection'),
                    ),
                  )}
                  <details>
                    <summary>无损裁剪</summary>
                    <p className="hamoki-panel-hint">
                      百分比范围，保留完整原图
                    </p>
                    {[
                      ['left', '左', 0],
                      ['top', '上', 0],
                      ['right', '右', 100],
                      ['bottom', '下', 100],
                    ].map(([key, label, fallback]) => {
                      const axis =
                          key === 'left' || key === 'right' ? 'x' : 'y',
                        start = key === 'left' || key === 'top',
                        part = start ? 'topLeft' : 'bottomRight',
                        crop = one.props.crop || {
                          topLeft: { x: 0, y: 0 },
                          bottomRight: { x: 1, y: 1 },
                        }
                      return (
                        <label key={key}>
                          {label}
                          <input
                            aria-label={'裁剪' + label}
                            type="number"
                            min="0"
                            max="100"
                            value={Math.round(
                              (crop[part]?.[axis] ?? fallback / 100) * 100,
                            )}
                            onChange={(e) => {
                              const n = Number(e.target.value) / 100,
                                other =
                                  crop[start ? 'bottomRight' : 'topLeft']?.[
                                    axis
                                  ] ?? (start ? 1 : 0)
                              if (
                                n >= 0 &&
                                n <= 1 &&
                                (start ? n < other : n > other)
                              )
                                editor.updateShape({
                                  id: one.id,
                                  props: {
                                    crop: {
                                      ...crop,
                                      [part]: { ...crop[part], [axis]: n },
                                    },
                                  },
                                })
                            }}
                          />
                        </label>
                      )
                    })}
                    {action('重置裁剪', () =>
                      editor.updateShape({ id: one.id, props: { crop: null } }),
                    )}
                  </details>
                </>
              )}
              {one?.meta?.cowartAiImageHolder && (
                <>
                  <label>
                    锁定比例
                    <input
                      type="checkbox"
                      aria-label="锁定占位框比例"
                      checked={!!one.meta.cowartAiAspectLocked}
                      onChange={(e) =>
                        editor.updateShape({
                          id: one.id,
                          meta: { cowartAiAspectLocked: e.target.checked },
                        })
                      }
                    />
                  </label>
                  <label>
                    占位框比例
                    <select
                      aria-label="占位框比例"
                      value=""
                      onChange={(e) => {
                        const [w, h] = e.target.value.split(':').map(Number)
                        editor.updateShape({
                          id: one.id,
                          props: { h: (one.props.w * h) / w },
                          meta: { cowartAiAspectRatio: w / h },
                        })
                      }}
                    >
                      <option value="">选择比例</option>
                      {['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'].map(
                        (v) => (
                          <option key={v}>{v}</option>
                        ),
                      )}
                    </select>
                  </label>
                </>
              )}
            </fieldset>
          )}
          {panel === '排列' && (
            <div className="hamoki-action-grid">
              {arrange.map(([label, fn]) =>
                action(
                  label,
                  fn,
                  !selected.length && !['解锁全部', '粘贴'].includes(label),
                ),
              )}
            </div>
          )}
          {panel === '页面' && (
            <>
              {editor.getPages().map((p, i) => (
                <div className="hamoki-page-row" key={p.id}>
                  <button
                    aria-pressed={p.id === editor.pageId}
                    onClick={() => editor.setCurrentPage(p.id)}
                  >
                    {p.name}
                  </button>
                  <button
                    aria-label={'重命名 ' + p.name}
                    onClick={() => {
                      const name = prompt('页面名称', p.name)
                      if (name) editor.renamePage(p.id, name)
                    }}
                  >
                    ✎
                  </button>
                  <button
                    aria-label={'上移页面 ' + p.name}
                    disabled={!i}
                    onClick={() => {
                      editor.reorderPage(p.id, -1)
                    }}
                  >
                    ↑
                  </button>
                </div>
              ))}
              <div className="hamoki-action-grid">
                {action('复制当前页面', () =>
                  editor.duplicatePage(editor.pageId),
                )}
                {action(
                  '删除当前页面',
                  () => {
                    if (confirm('删除当前页面及其中的元素？可使用撤销恢复。'))
                      editor.deletePage(editor.pageId)
                  },
                  editor.getPages().length === 1,
                )}
              </div>
              <label>
                移动所选到
                <select
                  aria-label="移动所选到页面"
                  value=""
                  onChange={(e) => editor.moveSelectionToPage(e.target.value)}
                >
                  <option value="">选择页面</option>
                  {editor
                    .getPages()
                    .filter((p) => p.id !== editor.pageId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
          {panel === '视图' && (
            <>
              <div className="hamoki-action-grid">
                {action('适合全部', () => editor.zoomToFit())}
                {action(
                  '适合选区',
                  () => editor.zoomToSelection(),
                  !selected.length,
                )}
                {action('100%', () =>
                  editor.setCamera({ ...editor.camera, z: 1 }),
                )}
                {action('快捷键', () => setHelp(true))}
              </div>
              {Object.entries({
                grid: '显示网格',
                snap: '网格吸附',
                toolLock: '保持当前工具',
                focus: '专注模式',
                edgeScroll: '边缘滚动',
                wrap: '文字自动换行',
              }).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    aria-label={label}
                    type="checkbox"
                    checked={!!editor.preferences[key]}
                    onChange={() => toggle(key)}
                  />
                </label>
              ))}
            </>
          )}
          {panel === '文件' && (
            <>
              <p className="hamoki-panel-hint">
                有选区时导出选区，否则导出当前页面。
              </p>
              <label>
                透明背景
                <input
                  type="checkbox"
                  checked={transparent}
                  onChange={(e) => setTransparent(e.target.checked)}
                />
              </label>
              <div className="hamoki-action-grid">
                {action('导出 PNG', () => exportImage('png'))}
                {action('导出 SVG', () => exportImage('svg'))}
                {action('完整画布备份', onBackup)}
                {action('插入链接卡片', () => insertLink('bookmark'))}
                {action('插入嵌入内容', () => insertLink('embed'))}
                {action('所选原图 ZIP', onDownload)}
                {action(
                  '导出所选 JSON',
                  () =>
                    downloadFile(
                      new Blob([JSON.stringify(editor.captureSelection())], {
                        type: 'application/json',
                      }),
                      'hamoki-selection.json',
                    ),
                  !selected.length,
                )}
                {action('导入画布 JSON', () => importInput.current.click())}
              </div>
            </>
          )}
        </section>
      )}
      <input
        ref={importInput}
        type="file"
        accept="application/json,.json"
        aria-label="导入画布文件"
        hidden
        onChange={(e) =>
          run(async () => {
            const file = e.target.files[0]
            if (!file) return
            if (file.size > 30 * 1024 * 1024) throw Error('画布文件需小于 30MB')
            const value = JSON.parse(await file.text())
            if (value.format === 'hamoki-clipboard')
              editor.pasteSelection(value)
            else editor.importSnapshot(value)
            e.target.value = ''
          })
        }
      />
      {help && (
        <div
          className="hamoki-help"
          role="dialog"
          aria-label="画布快捷键"
          aria-modal="true"
        >
          <h2>画布快捷键</h2>
          <p>空格 / 中键拖动：平移 · 滚轮：缩放 · Shift：多选 / 等比 / 吸附</p>
          <p>
            Ctrl/⌘ + Z：撤销 · Shift+Z：重做 · A：全选 · C/X/V：复制/剪切/粘贴 ·
            D：复制一份 · G：组合 · Shift+G：取消组合
          </p>
          <div>
            {tools
              .filter((t) => t[2])
              .map(([id, label, key]) => (
                <p key={id}>
                  <kbd>{key}</kbd> {label}
                </p>
              ))}
          </div>
          <button autoFocus onClick={() => setHelp(false)}>
            关闭
          </button>
        </div>
      )}
    </>
  )
}

const test = require('node:test'),
  assert = require('node:assert/strict')
const setup = async () => {
  const { CanvasDocument } = await import('../cowart/src/canvas/model.js')
  return new CanvasDocument(null, {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 700,
    }),
  })
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`)
test('完整工具：原版 30 入口含媒体；每种图形有独立有限几何', async () => {
  const { tools, geometries, geoPath } = await import(
    '../cowart/src/canvas/features.js'
  )
  assert.equal(tools.length + 1, 30)
  assert.equal(geometries.length, 16)
  assert.equal(new Set(tools.map((t) => t[0])).size, 29)
  for (const [id] of geometries) {
    const path = geoPath(id, 120, 90)
    assert.ok(path.startsWith('M'))
    assert.doesNotMatch(path, /NaN|undefined|Infinity/)
  }
  assert.notEqual(geoPath('triangle', 100, 100), geoPath('rectangle', 100, 100))
})
test('旧绘画数据：独立读取 float32 原点和 binary16 点差，不改变原始字段', async () => {
  const { decodeLegacyPath } = await import(
      '../cowart/src/canvas/legacyPaths.js'
    ),
    { strokePoints } = await import('../cowart/src/canvas/features.js')
  assert.deepEqual(decodeLegacyPath('AACAPwAAAEAAAIA/AEIARAC4AEQARAA0'), [
    { x: 1, y: 2, z: 1 },
    { x: 4, y: 6, z: 0.5 },
    { x: 8, y: 10, z: 0.75 },
  ])
  const props = {
    segments: [{ type: 'free', path: 'AAAAAAAAAAAAAIA/AEkATQAA' }],
  }
  assert.equal(strokePoints(props)[1].y, 20)
  assert.ok(props.segments[0].path)
  assert.deepEqual(decodeLegacyPath('broken!'), [])
})
test('连线：目标旋转/移动/删除后固定端点；撤销恢复绑定，原始任务元数据保留', async () => {
  const d = await setup()
  d.createShape({
    id: 'shape:target',
    type: 'geo',
    x: 100,
    y: 100,
    props: { w: 100, h: 80 },
    meta: { task: 'original' },
  })
  d.createShape({
    id: 'shape:arrow',
    type: 'arrow',
    x: 0,
    y: 0,
    props: { start: { x: 0, y: 0 }, end: { x: 200, y: 140 } },
  })
  d.bindArrow('shape:arrow', 'end', 'shape:target', { x: 200, y: 140 })
  near(d.getArrowEndpoints(d.getShape('shape:arrow')).end.x, 200)
  d.updateShape({ id: 'shape:target', x: 150, rotation: Math.PI / 2 })
  const e = d.getArrowEndpoints(d.getShape('shape:arrow')).end
  near(e.x, 110)
  near(e.y, 200)
  const bound = d.getShapePageBounds('shape:arrow')
  assert.ok(bound.h >= 200)
  d.deleteShapes(['shape:target'])
  assert.equal(d.getBindings('shape:arrow').length, 0)
  near(d.getShape('shape:arrow').props.end.x, e.x)
  d.undo()
  assert.equal(d.getBindings('shape:arrow').length, 1)
  assert.equal(d.getShape('shape:target').meta.task, 'original')
})
test('剪贴板：子树、资产、内部绑定重新编号；外部连线定格，跨页面只撤销一次', async () => {
  const d = await setup()
  d.createAssets([
    {
      id: 'asset:original',
      type: 'image',
      props: { src: 'data:image/png;base64,abc' },
    },
  ])
  d.createShapes([
    {
      id: 'shape:a',
      type: 'image',
      x: 10,
      y: 20,
      props: { w: 100, h: 100, assetId: 'asset:original' },
    },
    { id: 'shape:b', type: 'geo', x: 250, y: 20 },
    {
      id: 'shape:r',
      type: 'arrow',
      x: 0,
      y: 0,
      props: { start: { x: 60, y: 70 }, end: { x: 300, y: 70 } },
    },
  ])
  d.bindArrow('shape:r', 'start', 'shape:a', { x: 60, y: 70 })
  d.bindArrow('shape:r', 'end', 'shape:b', { x: 300, y: 70 })
  d.select('shape:a', 'shape:r')
  const clip = d.captureSelection()
  assert.equal(clip.records.filter((r) => r.typeName === 'binding').length, 1)
  d.createPage({ id: 'page:new' })
  d.setCurrentPage('page:new')
  const history = d.history.length
  d.pasteSelection(clip)
  assert.equal(d.history.length, history + 1)
  assert.equal(d.getSelectedShapes().length, 2)
  const arrow = d.getSelectedShapes().find((s) => s.type === 'arrow'),
    image = d.getSelectedShapes().find((s) => s.type === 'image')
  assert.notEqual(image.props.assetId, 'asset:original')
  assert.equal(d.getBindings(arrow.id)[0].toId, image.id)
  near(arrow.props.end.x, 250)
  assert.ok(d.getShape('shape:b'))
  d.undo()
  assert.equal(d.getCurrentPageShapes().length, 0)
})
test('排列：对齐/分布/层级仅改变目标元素，锁定元素不动，操作可撤销', async () => {
  const d = await setup()
  d.createShapes([
    { id: 'shape:a', type: 'geo', x: 20, y: 30, props: { w: 50, h: 40 } },
    { id: 'shape:b', type: 'geo', x: 200, y: 100, props: { w: 100, h: 40 } },
    { id: 'shape:c', type: 'geo', x: 500, y: 200, props: { w: 70, h: 40 } },
    { id: 'shape:locked', type: 'geo', x: 777, y: 777, isLocked: true },
  ])
  d.select('shape:a', 'shape:b', 'shape:c', 'shape:locked')
  const before = d.history.length
  d.align('y', 'start')
  assert.equal(d.history.length, before + 1)
  for (const id of ['a', 'b', 'c']) near(d.getShape('shape:' + id).y, 30)
  near(d.getShape('shape:locked').y, 777)
  d.distribute('x', 24)
  near(d.getShape('shape:b').x, 94)
  near(d.getShape('shape:c').x, 218)
  d.select('shape:a')
  d.reorder('front')
  assert.equal(d.getCurrentPageShapes().at(-1).id, 'shape:a')
  d.undo()
  assert.notEqual(d.getCurrentPageShapes().at(-1).id, 'shape:a')
})
test('页面：复制携带内部绑定和独立资产；删除保护最后一页并可撤销', async () => {
  const d = await setup()
  d.createShape({ id: 'shape:a', type: 'geo', props: { w: 50, h: 50 } })
  const first = d.pageId
  d.duplicatePage(first)
  const second = d.pageId
  assert.notEqual(first, second)
  assert.equal(d.getPages().length, 2)
  assert.equal(d.getCurrentPageShapes().length, 1)
  assert.notEqual(d.getCurrentPageShapes()[0].id, 'shape:a')
  d.deletePage(second)
  assert.equal(d.pageId, first)
  assert.equal(d.getPages().length, 1)
  assert.throws(() => d.deletePage(first), /至少保留/)
  d.undo()
  assert.equal(d.getPages().length, 2)
  d.setCurrentPage(second)
  assert.equal(d.getCurrentPageShapes().length, 1)
})
test('富文本：列表、格式、链接和软换行在布局中保留，不执行不安全链接', async () => {
  const { richBlocks, layoutRich, safeLink } = await import(
      '../cowart/src/canvas/richText.js'
    ),
    doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Hello', marks: [{ type: 'bold' }] },
                    { type: 'hardBreak' },
                    {
                      type: 'text',
                      text: 'World',
                      marks: [
                        {
                          type: 'link',
                          attrs: { href: 'https://example.com' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
  const blocks = richBlocks(doc)
  assert.equal(blocks[0][0].text, '• ')
  assert.equal(blocks[0][1].marks[0].type, 'bold')
  assert.equal(layoutRich(doc, 300, '22px sans-serif').length, 2)
  assert.equal(safeLink('javascript:alert(1)'), null)
  assert.equal(safeLink('https://example.com'), 'https://example.com/')
})
test('裁剪/翻转图片不能重用完整原图编号作为 AI 输入', async () => {
  const { originalSourceMatches } = await import(
    '../cowart/src/canvas/export.js'
  )
  assert.ok(originalSourceMatches({ props: {} }))
  assert.ok(!originalSourceMatches({ props: { flipX: true } }))
  assert.ok(!originalSourceMatches({ rotation: 1, props: {} }))
  assert.ok(
    !originalSourceMatches({
      props: {
        crop: { topLeft: { x: 0.2, y: 0 }, bottomRight: { x: 1, y: 1 } },
      },
    }),
  )
})
test('画布导入：新增独立页面，映射所有引用，原项目数据不覆盖', async () => {
  const d = await setup()
  d.createShape({ id: 'shape:original', type: 'geo' })
  const old = d.store.getStoreSnapshot()
  d.importSnapshot(old)
  assert.equal(d.getPages().length, 2)
  assert.ok(d.getShape('shape:original'))
  assert.equal(d.getCurrentPageShapes().length, 1)
  assert.notEqual(d.getCurrentPageShapes()[0].id, 'shape:original')
  d.undo()
  assert.equal(d.getPages().length, 1)
})
test('嵌套非等比缩放与旋转：解组/复制保留完整仿射变换，不漂移', async () => {
  const d = await setup(),
    { shapeMatrix } = await import('../cowart/src/canvas/model.js')
  d.createShape({
    id: 'shape:g',
    type: 'group',
    x: 120,
    y: 100,
    rotation: 0.7,
    scaleX: 2,
    scaleY: 0.6,
  })
  d.createShape({
    id: 'shape:c',
    type: 'geo',
    parentId: 'shape:g',
    x: 30,
    y: 40,
    rotation: 0.4,
    scaleX: 1.3,
    scaleY: 0.8,
    props: { w: 100, h: 60 },
  })
  const before = shapeMatrix(d.records, d.getShape('shape:c'))
  d.select('shape:g')
  d.ungroupSelected()
  const after = shapeMatrix(d.records, d.getShape('shape:c'))
  before.forEach((n, i) => near(n, after[i]))
  d.select('shape:c')
  const value = d.captureSelection()
  d.pasteSelection(value, { x: 0, y: 0 })
  const duplicate = shapeMatrix(d.records, d.getSelectedShapes()[0])
  before.forEach((n, i) => near(n, duplicate[i]))
})
test('生成图定位尊重旋转和缩放后的锚点，不与原图重叠', async () => {
  const { pageBoundsForShape, choosePlacement } = await import(
      '../cowart/src/lib/placement.js'
    ),
    d = await setup()
  d.createShape({
    id: 'shape:a',
    type: 'image',
    x: 200,
    y: 100,
    rotation: Math.PI / 2,
    scaleX: 2,
    props: { w: 100, h: 60 },
  })
  const a = d.getShape('shape:a'),
    b = pageBoundsForShape(d.records, a)
  near(b.x, 140)
  near(b.w, 60)
  near(b.h, 200)
  const placed = choosePlacement({
    store: d.records,
    pageId: d.pageId,
    parentId: d.pageId,
    anchorShape: a,
    width: 100,
    height: 100,
    margin: 40,
    placement: 'right',
  })
  near(placed.x, 240)
  near(placed.y, 100)
})
test('组合样式和透明度：样式更新子元素；解组保持视觉透明度', async () => {
  const d = await setup()
  d.createShapes([
    { id: 'shape:a', type: 'geo', opacity: 0.5 },
    { id: 'shape:b', type: 'geo', x: 300 },
  ])
  d.select('shape:a', 'shape:b')
  d.groupSelected()
  const group = d.getSelectedShapes()[0]
  d.setStyle({ color: 'red', opacity: 0.5 })
  assert.equal(d.getShape('shape:a').props.color, 'red')
  assert.equal(d.getShape('shape:a').opacity, 0.5)
  assert.equal(d.getShape(group.id).opacity, 0.5)
  d.ungroupSelected()
  assert.equal(d.getShape('shape:a').opacity, 0.25)
  assert.equal(d.getShape('shape:b').opacity, 0.5)
})
test('占位框：框住既有标注后必须非空；移动进出框架保留世界位置和任务身份', async () => {
  const d = await setup(),
    { isEmptyImageHolder } = await import('../cowart/src/lib/canvasInputs.js')
  d.createShape({
    id: 'shape:a',
    type: 'geo',
    x: 100,
    y: 120,
    props: { w: 40, h: 40 },
    meta: { requestId: 'unchanged' },
  })
  d.transaction(() => {
    d.createShape({
      id: 'shape:f',
      type: 'frame',
      x: 80,
      y: 90,
      props: { w: 200, h: 200 },
      meta: { cowartAiImageHolder: true },
    })
    d.captureInsideFrame('shape:f')
  })
  assert.equal(d.getShape('shape:a').parentId, 'shape:f')
  assert.equal(isEmptyImageHolder(d.records, d.getShape('shape:f')), false)
  near(d.getShapePageBounds('shape:a').x, 100)
  d.adoptMovedShapes(['shape:a'], { x: 500, y: 500 })
  assert.equal(d.getShape('shape:a').parentId, d.pageId)
  near(d.getShape('shape:a').x, 100)
  assert.equal(d.getShape('shape:a').meta.requestId, 'unchanged')
  d.adoptMovedShapes(['shape:a'], { x: 150, y: 150 })
  assert.equal(d.getShape('shape:a').parentId, 'shape:f')
  near(d.getShapePageBounds('shape:a').x, 100)
})
test('普通连线落在目标边界，标注保留精确落点；旧非精确绑定也正确解析', async () => {
  const d = await setup()
  d.createShapes([
    { id: 'shape:left', type: 'geo', x: 0, y: 0, props: { w: 100, h: 100 } },
    { id: 'shape:right', type: 'geo', x: 300, y: 0, props: { w: 100, h: 100 } },
    {
      id: 'shape:arrow',
      type: 'arrow',
      props: { start: { x: 50, y: 50 }, end: { x: 350, y: 50 } },
    },
  ])
  d.bindArrow('shape:arrow', 'start', 'shape:left', { x: 50, y: 50 })
  d.bindArrow('shape:arrow', 'end', 'shape:right', { x: 350, y: 50 })
  const e = d.getArrowEndpoints(d.getShape('shape:arrow'))
  near(e.start.x, 100)
  near(e.end.x, 300)
  d.updateShape({ id: 'shape:arrow', meta: { cowartAnnotationArrow: true } })
  d.bindArrow('shape:arrow', 'end', 'shape:right', { x: 350, y: 50 })
  near(d.getArrowEndpoints(d.getShape('shape:arrow')).end.x, 350)
})
test('保存URL异步提交：撤销/重做只还原用户编辑，不把资产退回旧blob；已捕获快照保持原值', async () => {
  const d = await setup()
  d.createAssets([
    { id: 'asset:a', type: 'image', props: { src: 'blob:before-save' } },
  ])
  d.createShape({
    id: 'shape:a',
    type: 'image',
    x: 20,
    props: { assetId: 'asset:a' },
  })
  const captured = d.store.getStoreSnapshot()
  d.beginGesture()
  d.updateShape({ id: 'shape:a', x: 100 })
  d.store.mergeRemoteChanges(() =>
    d.updateAssets([{ id: 'asset:a', props: { src: '/api/media/saved.png' } }]),
  )
  d.endGesture()
  d.undo()
  assert.equal(d.getShape('shape:a').x, 20)
  assert.equal(d.getAsset('asset:a').props.src, '/api/media/saved.png')
  assert.equal(captured.store['asset:a'].props.src, 'blob:before-save')
  d.redo()
  assert.equal(d.getShape('shape:a').x, 100)
  assert.equal(d.getAsset('asset:a').props.src, '/api/media/saved.png')
})

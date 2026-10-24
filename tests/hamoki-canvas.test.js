const test = require('node:test')
const assert = require('node:assert/strict')
async function setup() {
  const { CanvasDocument } = await import('../cowart/src/canvas/model.js')
  return new CanvasDocument(null, {
    getBoundingClientRect: () => ({
      left: 20,
      top: 40,
      width: 900,
      height: 650,
    }),
  })
}
test('自有画布：编辑、撤销、重做和快照捕获互不篡改', async () => {
  const d = await setup()
  d.createShape({
    id: 'shape:a',
    type: 'geo',
    x: 100,
    y: 200,
    props: { w: 50, h: 80 },
  })
  const captured = d.store.getStoreSnapshot()
  d.beginGesture()
  for (let x = 101; x < 120; x++) d.updateShape({ id: 'shape:a', x })
  d.endGesture()
  assert.equal(captured.store['shape:a'].x, 100)
  d.undo()
  assert.equal(d.getShape('shape:a').x, 100)
  d.redo()
  assert.equal(d.getShape('shape:a').x, 119)
})
test('自有画布：远程资产URL更新不变成用户编辑或产生撤销项', async () => {
  const d = await setup(),
    events = []
  d.store.listen((e) => events.push(e), { source: 'user', scope: 'document' })
  d.createAssets([
    {
      id: 'asset:a',
      type: 'image',
      props: { src: 'blob:original', w: 10, h: 10 },
    },
  ])
  const count = d.history.length
  d.store.mergeRemoteChanges(() =>
    d.updateAssets([
      { id: 'asset:a', props: { src: '/api/media/example.png' } },
    ]),
  )
  assert.equal(events.length, 1)
  assert.equal(d.history.length, count)
  assert.equal(d.getAsset('asset:a').props.w, 10)
})
test('自有画布：组合/移动/解组保留子元素世界坐标和原始资产', async () => {
  const d = await setup()
  d.createShapes([
    {
      id: 'shape:a',
      type: 'image',
      x: 120,
      y: 80,
      props: { assetId: 'asset:source', w: 100, h: 80 },
    },
    { id: 'shape:b', type: 'geo', x: 260, y: 100, props: { w: 80, h: 80 } },
  ])
  d.select('shape:a', 'shape:b')
  d.groupSelected()
  const group = d.getSelectedShapes()[0]
  assert.equal(d.getShape('shape:a').parentId, group.id)
  assert.equal(d.getShapePageBounds('shape:a').x, 120)
  d.updateShape({ id: group.id, x: group.x + 50 })
  assert.equal(d.getShapePageBounds('shape:a').x, 170)
  d.ungroupSelected()
  assert.equal(d.getShape('shape:a').parentId, d.pageId)
  assert.equal(d.getShape('shape:a').x, 170)
  assert.equal(d.getShape('shape:a').props.assetId, 'asset:source')
})
test('自有画布：旋转父元素的子坐标与相机互逆', async () => {
  const d = await setup()
  d.createShape({
    id: 'shape:frame',
    type: 'frame',
    x: 100,
    y: 200,
    rotation: Math.PI / 2,
    props: { w: 200, h: 200 },
  })
  d.createShape({
    id: 'shape:child',
    type: 'image',
    x: 10,
    y: 20,
    parentId: 'shape:frame',
    props: { w: 30, h: 40 },
  })
  const b = d.getShapePageBounds('shape:child')
  assert.ok(Math.abs(b.x - 40) < 0.001)
  assert.ok(Math.abs(b.y - 210) < 0.001)
  d.setCamera({ x: 140, y: -20, z: 2 })
  const p = { x: 190, y: 200 }
  const round = d.screenToPage(d.pageToScreen(p))
  assert.deepEqual(round, p)
})
test('自有画布：页面/复制/级联删除不会混淆已有文档', async () => {
  const d = await setup()
  d.createShape({ id: 'shape:a', type: 'geo', x: 10, y: 20 })
  d.select('shape:a')
  d.duplicateSelected()
  assert.equal(d.getCurrentPageShapes().length, 2)
  assert.equal(d.getSelectedShapes()[0].x, 40)
  d.createPage({ id: 'page:other' })
  d.setCurrentPage('page:other')
  assert.equal(d.getCurrentPageShapes().length, 0)
  d.setCurrentPage('page:main')
  assert.equal(d.getCurrentPageShapes().length, 2)
})
test('旧快照兼容：未知元素和元数据完整保留；坏格式/未来版本拒绝保存', async () => {
  const { sanitizeCanvasSnapshot } = await import(
    '../cowart/src/canvasSnapshot.js'
  )
  const snapshot = {
    schema: { schemaVersion: 2, sequences: { old: 99 } },
    store: {
      'page:old': { id: 'page:old', typeName: 'page' },
      'shape:unknown': {
        id: 'shape:unknown',
        typeName: 'shape',
        type: 'custom-legacy',
        parentId: 'page:old',
        props: { secretCustomState: { color: 'gold' } },
        meta: { original: true },
      },
    },
  }
  const before = JSON.stringify(snapshot),
    safe = sanitizeCanvasSnapshot(snapshot)
  assert.equal(JSON.stringify(snapshot), before)
  assert.deepEqual(safe.snapshot.store, snapshot.store)
  assert.equal(safe.skippedRecords.length, 1)
  const { CanvasDocument } = await import('../cowart/src/canvas/model.js')
  const d = new CanvasDocument(safe.snapshot, {})
  d.createShape({ id: 'shape:new', type: 'geo' })
  assert.deepEqual(
    d.store.getStoreSnapshot().store['shape:unknown'],
    snapshot.store['shape:unknown'],
  )
  assert.throws(
    () => sanitizeCanvasSnapshot({ schema: { hamokiCanvas: 2 }, store: {} }),
    /较新的版本/,
  )
  assert.throws(
    () =>
      sanitizeCanvasSnapshot({
        schema: {},
        store: { broken: { typeName: 'shape' } },
      }),
    /记录不完整/,
  )
})
test('自有画布：图片源限制排除脚本/外站，仅接受站内媒体或位图', async () => {
  const { safeImageSource } = await import('../cowart/src/canvas/model.js')
  for (const source of [
    'javascript:alert(1)',
    'data:image/svg+xml,<svg/>',
    'https://evil.example/image.png',
    '/api/providers',
  ])
    assert.equal(safeImageSource(source), null)
  assert.ok(
    safeImageSource('/api/media/00000000-0000-4000-8000-000000000001.png'),
  )
  assert.ok(safeImageSource('data:image/png;base64,aA=='))
})
test('批量原图ZIP保留UTF-8文件名和完整字节，可由标准工具读取', async () => {
  const { zipFiles, crc32 } = await import('../cowart/src/canvas/download.js')
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  const zip = zipFiles([
    { name: '原图.png', bytes: new Uint8Array([1, 2, 3, 4]) },
    { name: 'second.png', bytes: new Uint8Array([5, 6, 7]) },
  ])
  const { spawnSync } = require('node:child_process')
  const checked = spawnSync(
    'python3',
    [
      '-c',
      'import sys,io,zipfile;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));assert z.read("原图.png")==bytes([1,2,3,4]);assert z.read("second.png")==bytes([5,6,7]);assert z.testzip() is None',
    ],
    { input: Buffer.from(await zip.arrayBuffer()) },
  )
  assert.equal(checked.status, 0, String(checked.stderr))
})

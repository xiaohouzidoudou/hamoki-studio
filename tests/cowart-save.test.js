const test = require('node:test')
const assert = require('node:assert/strict')

test('旧保存响应不能确认上传期间的新编辑，失败后仍待保存', async () => {
  const { createSaveState } = await import('../cowart/src/lib/saveState.js')
  const state = createSaveState()
  state.changed()
  const first = state.capture()
  let finish
  const request = new Promise(resolve => { finish = resolve })
  const saving = request.then(() => state.acknowledge(first))
  state.changed()
  finish()
  await saving
  assert.equal(state.dirty, true)
  const second = state.capture()
  // A rejected request never acknowledges its captured version.
  await assert.rejects(Promise.reject(new Error('503')))
  assert.equal(state.dirty, true)
  state.acknowledge(second)
  assert.equal(state.dirty, false)
})

test('图片捕获使用独立记录，撤销或替换不会被异步保存篡改', async () => {
  const { normalizeAssetSources } = await import('../cowart/src/lib/assetCapture.js')
  const previousFetch = global.fetch
  const previousReader = global.FileReader
  global.FileReader = class {
    readAsDataURL() { this.result = 'data:image/png;base64,captured'; this.onload() }
  }
  const asset = { typeName: 'asset', type: 'image', props: { src: 'blob:original' } }
  const snapshot = { schema: {}, store: { asset } }
  let finish
  global.fetch = () => new Promise(resolve => { finish = resolve })
  try {
    const pending = normalizeAssetSources(snapshot)
    finish({ ok: true, blob: async () => new Blob(['image']) })
    const saved = await pending
    assert.equal(asset.props.src, 'blob:original')
    assert.equal(saved.store.asset.props.src, 'data:image/png;base64,captured')
    assert.notEqual(saved.store.asset, asset)
    global.fetch = async () => { throw new Error('revoked') }
    await assert.rejects(normalizeAssetSources(snapshot), /尚未保存/)
    global.fetch = async () => ({ ok: false })
    await assert.rejects(normalizeAssetSources(snapshot), /尚未保存/)
  } finally {
    global.fetch = previousFetch
    global.FileReader = previousReader
  }
})

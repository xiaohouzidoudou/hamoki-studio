'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const modulePromise = import('data:text/javascript;base64,' + fs.readFileSync(
  path.join(__dirname, '../cowart/src/lib/jobRecovery.js')).toString('base64'))

test('completed Cowart job identity survives stale/missing/wrong-project snapshots until its image is saved', async () => {
  const { acknowledgeSavedResult, hasUnsavedResult } = await modulePromise
  const values = new Map([
    ['hamoki-cowart-active:p1', JSON.stringify({ jobId: 'job1', resultId: 'image1' })],
    ['hamoki-cowart-last-request:p1', 'request1'],
    ['hamoki-cowart-active:p2', JSON.stringify({ jobId: 'job2', resultId: 'image2' })]
  ])
  const storage = { getItem: k => values.get(k), removeItem: k => values.delete(k) }
  assert.equal(hasUnsavedResult('p1', storage), true)
  const snapshot = meta => ({ store: { image: { typeName: 'shape', meta } } })
  for (const stale of [null, { store: {} }, snapshot({ studioHistoryId: 'old', studioProjectId: 'p1' }),
    snapshot({ studioHistoryId: 'image1', studioProjectId: 'p2' })]) {
    assert.equal(acknowledgeSavedResult('p1', stale, storage), false)
    assert.equal(hasUnsavedResult('p1', storage), true)
  }
  assert.equal(acknowledgeSavedResult('p1', snapshot({ studioHistoryId: 'image1', studioProjectId: 'p1' }), storage), true)
  assert.equal(hasUnsavedResult('p1', storage), false)
  assert.equal(values.has('hamoki-cowart-last-request:p1'), false)
  assert.equal(hasUnsavedResult('p2', storage), true)
})

test('running jobs and broken browser storage never have their identity silently discarded', async () => {
  const { acknowledgeSavedResult, hasUnsavedResult } = await modulePromise
  const running = { getItem: () => '{"jobId":"running"}', removeItem: () => assert.fail('must retain running job') }
  assert.equal(acknowledgeSavedResult('p1', { store: {} }, running), false)
  assert.equal(hasUnsavedResult('p1', running), false)
  const broken = { getItem: () => { throw Error('storage unavailable') } }
  assert.equal(hasUnsavedResult('p1', broken), true)
  assert.equal(acknowledgeSavedResult('p1', null, broken), false)
})

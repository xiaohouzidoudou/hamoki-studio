'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')

const root = path.resolve(__dirname, '..')
const freePort = () => new Promise(resolve => {
  const server = net.createServer()
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close(() => resolve(port))
  })
})
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function launch(port, dataDir) {
  const child = spawn(process.execPath, [path.join(root, 'gateway.js')], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), APP_ALLOWED_HOST: 'ps.test',
      APP_ENCRYPTION_KEY: 'cowart-test-encryption-key-at-least-32chars', INVITE_CODE: 'local-test',
      COWART_PREVIEW: '1', DATA_DIR: dataDir, COOKIE_SECURE: '1', NODE_ENV: 'test',
      USER_QUOTA_GB: '1', TOTAL_QUOTA_GB: '5' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let messages = ''
  child.stdout.on('data', bytes => { messages += bytes })
  child.stderr.on('data', bytes => { messages += bytes })
  for (let i = 0; i < 150; i++) {
    if (messages.includes('account gateway ready')) return child
    if (child.exitCode !== null) throw Error('Gateway exited: ' + messages)
    await delay(40)
  }
  child.kill()
  throw Error('Failed to start: ' + messages)
}

function client(port) {
  let cookie = ''
  return async (api, method = 'GET', body, origin) => {
    const buffer = body === undefined ? null : Buffer.from(JSON.stringify(body))
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port, path: api, method,
        headers: { Host: 'ps.test', ...(cookie ? { Cookie: cookie } : {}),
          ...(buffer ? { 'Content-Type': 'application/json', 'Content-Length': buffer.length } : {}),
          ...(origin ? { Origin: origin } : {}) }
      }, res => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          if (res.headers['set-cookie']?.[0]) cookie = res.headers['set-cookie'][0].split(';')[0]
          const raw = Buffer.concat(chunks).toString('utf8')
          resolve({ status: res.statusCode, data: (res.headers['content-type'] || '').includes('application/json') ? JSON.parse(raw) : raw })
        })
      })
      req.on('error', reject)
      req.end(buffer)
    })
  }
}

test('Cowart preview requires a session; server snapshots have account-scoped optimistic revisions', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hamoki-cowart-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const port = await freePort()
  let child = await launch(port, dir)
  t.after(() => child.kill('SIGTERM'))
  const a = client(port), b = client(port), outsider = client(port)
  assert.equal((await a('/cowart/')).status, 401)
  assert.equal((await a('/api/cowart/snapshot?projectId=123')).status, 401)
  assert.equal((await a('/api/register', 'POST', { username: 'cowarta', password: '12345678', inviteCode: 'local-test' })).status, 201)
  assert.equal((await b('/api/register', 'POST', { username: 'cowartb', password: '12345678', inviteCode: 'local-test' })).status, 201)
  const pA = (await a('/api/projects')).data.defaultId
  const pB = (await b('/api/projects')).data.defaultId
  assert.notEqual(pA, pB)
  assert.equal((await a('/api/cowart/snapshot?projectId=' + pB)).status, 404)
  assert.equal((await b('/api/cowart/snapshot?projectId=' + pA)).status, 404)
  assert.equal((await outsider('/api/cowart/snapshot?projectId=' + pA)).status, 401)
  assert.deepEqual((await a('/api/cowart/snapshot?projectId=' + pA)).data, { snapshot: null, revision: 0, updatedAt: null })

  const snapshot = { schema: { schemaVersion: 2, sequences: {} }, store: {
    'page:aaa': { id: 'page:aaa', typeName: 'page', name: '工作画布', index: 'a1' }
  } }
  const save = await a('/api/cowart/snapshot?projectId=' + pA, 'PUT', { snapshot, revision: 0 })
  assert.equal(save.status, 200, JSON.stringify(save.data))
  assert.equal(save.data.revision, 1)
  assert.equal((await a('/api/cowart/snapshot?projectId=' + pA)).data.revision, 1)
  assert.equal((await b('/api/cowart/snapshot?projectId=' + pB)).data.revision, 0)
  assert.equal((await a('/api/cowart/snapshot?projectId=' + pA, 'PUT', { snapshot, revision: 0 })).status, 409)
  assert.equal((await a('/api/cowart/snapshot?projectId=' + pA, 'PUT', { snapshot, revision: 1 }, 'https://evil.example')).status, 403)
  const unsafe = { schema: snapshot.schema, store: {
    'asset:unsafe': { id: 'asset:unsafe', typeName: 'asset', type: 'image', props: { src: 'https://evil.example/leak.png' } }
  } }
  assert.equal((await a('/api/cowart/snapshot?projectId=' + pA, 'PUT', { snapshot: unsafe, revision: 1 })).status, 400)

  await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM') })
  child = await launch(port, dir)
  assert.equal((await a('/api/cowart/snapshot?projectId=' + pA)).data.revision, 1, 'saved canvas survives restart')
  assert.equal((await b('/api/cowart/snapshot?projectId=' + pB)).data.revision, 0)
})

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { verifyCanvasArchive } from './canvas-archive.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const data = mkdtempSync(path.join(tmpdir(), 'cowart-asset-browser-'))
const port = await new Promise((resolve) => {
  const s = createServer()
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port
    s.close(() => resolve(p))
  })
})
const app = spawn(process.execPath, [path.join(root, 'gateway.js')], {
  cwd: root,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    APP_ALLOWED_HOST: '127.0.0.1',
    DATA_DIR: data,
    APP_ENCRYPTION_KEY: 'local-assets-smoke-only-key-12345678901234567890',
    INVITE_CODE: 'local-assets',
    COOKIE_SECURE: '0',
    COWART_PREVIEW: '1',
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = '',
  browser,
  page
for (const stream of [app.stdout, app.stderr])
  stream.on('data', (buf) => (output += buf))
const screenshot = path.join(
  root,
  'cowart',
  'test-results',
  'archive-smoke.png',
)
mkdirSync(path.dirname(screenshot), { recursive: true })
try {
  for (let i = 0; i < 150 && !output.includes('account gateway ready'); i++) {
    if (app.exitCode !== null) throw Error(output)
    await new Promise((r) => setTimeout(r, 50))
  }
  assert.match(output, /account gateway ready/)
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext(),
    base = 'http://127.0.0.1:' + port
  assert.equal(
    (
      await context.request.post(base + '/api/register', {
        data: {
          username: 'assetbrowser',
          password: 'password123',
          inviteCode: 'local-assets',
        },
      })
    ).status(),
    201,
  )
  const projectId = (
    await (await context.request.get(base + '/api/projects')).json()
  ).defaultId
  page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  assert.equal(
    (
      await page.goto(base + '/cowart/?projectId=' + projectId, {
        waitUntil: 'domcontentloaded',
      })
    ).status(),
    200,
  )
  await page.waitForFunction(() => !!window.__cowartEditor)
  await verifyCanvasArchive({ page, context, base, projectId })
  assert.deepEqual(errors, [])
  await page.evaluate(() => {
    window.__cowartEditor.zoomToFit({ animation: { duration: 0 } })
  })
  await page.screenshot({ path: screenshot, fullPage: true })
} catch (error) {
  await page?.screenshot({ path: screenshot, fullPage: true }).catch(() => {})
  throw error
} finally {
  await browser?.close()
  if (app.exitCode === null) {
    const stopped = new Promise((resolve) => app.once('exit', resolve))
    app.kill()
    await stopped
  }
  rmSync(data, { recursive: true, force: true })
}

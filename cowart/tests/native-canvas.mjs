import assert from 'node:assert/strict'
export async function verifyNativeCanvas({ page, context, base, projectId }) {
  const errors = [],
    foreign = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (r) => {
    if (
      new URL(r.url()).origin !== base &&
      !r.url().startsWith('data:') &&
      !r.url().startsWith('blob:')
    )
      foreign.push(r.url())
  })
  const old = {
    schema: { schemaVersion: 2, sequences: { 'legacy-opaque': 12 } },
    store: {
      'page:legacy': {
        id: 'page:legacy',
        typeName: 'page',
        name: '旧画布',
        index: 'a1',
        meta: {},
      },
      'shape:legacy-opaque': {
        id: 'shape:legacy-opaque',
        typeName: 'shape',
        type: 'legacy-custom',
        parentId: 'page:legacy',
        index: 'a1',
        x: 1300,
        y: 1200,
        props: { w: 90, h: 80, originalConfig: { preserve: true } },
        meta: { original: true },
      },
    },
  }
  assert.equal(
    (
      await context.request.put(
        base + '/api/cowart/snapshot?projectId=' + projectId,
        { data: { revision: 0, snapshot: old } },
      )
    ).status(),
    200,
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__cowartEditor)
  assert.equal(
    await page.locator('[data-canvas-engine="hamoki-native-v1"]').count(),
    1,
  )
  assert.equal(
    await page
      .getByText('旧元素 · legacy-custom（保留）', { exact: true })
      .count(),
    1,
  )
  // This production bundle must stay alive beyond the old SDK's five-second gate.
  await page.waitForTimeout(10500)
  assert.equal(await page.evaluate(() => !!window.__cowartEditor), true)
  assert.equal(await page.getByTestId('tl-license-expired').count(), 0)
  const source = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 320
    c.height = 180
    const x = c.getContext('2d')
    x.fillStyle = '#3e9566'
    x.fillRect(0, 0, 320, 180)
    x.fillStyle = '#cbe8a0'
    x.fillRect(10, 10, 300, 160)
    return c.toDataURL()
  })
  const bytes = Buffer.from(source.split(',')[1], 'base64')
  await page.getByLabel('选择导入图片', { exact: true }).setInputFiles([
    { name: 'one.png', mimeType: 'image/png', buffer: bytes },
    { name: 'two.png', mimeType: 'image/png', buffer: bytes },
  ])
  await page.waitForFunction(
    () =>
      window.__cowartEditor
        .getCurrentPageShapes()
        .filter((s) => s.type === 'image').length === 2,
  )
  await page.waitForFunction(() =>
    window.__cowartEditor
      .getCurrentPageShapes()
      .filter((s) => s.type === 'image')
      .every((s) =>
        window.__cowartEditor
          .getAsset(s.props.assetId)
          .props.src.startsWith('/api/media/'),
      ),
  )
  const images = await page.evaluate(() =>
    window.__cowartEditor
      .getCurrentPageShapes()
      .filter((s) => s.type === 'image')
      .map((s) => s.id),
  )
  await page.evaluate(() => {
    window.__cowartEditor.setCamera({ x: 0, y: 0, z: 1 })
    window.__cowartEditor.selectNone()
  })
  await page.getByRole('button', { name: '矩形', exact: true }).click()
  const rect = await page.locator('.hamoki-board').boundingBox()
  await page.mouse.move(rect.x + 150, rect.y + 240)
  await page.mouse.down()
  await page.mouse.move(rect.x + 250, rect.y + 310, { steps: 8 })
  await page.mouse.up()
  const shape = await page.evaluate(
    () => window.__cowartEditor.getSelectedShapes()[0],
  )
  assert.equal(shape.type, 'geo')
  const center = await page.evaluate(() => {
    const e = window.__cowartEditor,
      b = e.getSelectionPageBounds()
    return e.pageToScreen(b.center)
  })
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x + 40, center.y + 20, { steps: 6 })
  await page.mouse.up()
  assert.equal(
    await page.evaluate(
      (id) => Math.round(window.__cowartEditor.getShape(id).x),
      shape.id,
    ),
    190,
  )
  await page.keyboard.press('Control+z')
  assert.equal(
    await page.evaluate(
      (id) => Math.round(window.__cowartEditor.getShape(id).x),
      shape.id,
    ),
    150,
  )
  await page.keyboard.press('Control+Shift+z')
  assert.equal(
    await page.evaluate(
      (id) => Math.round(window.__cowartEditor.getShape(id).x),
      shape.id,
    ),
    190,
  )
  let box = await page.evaluate(() => {
    const e = window.__cowartEditor,
      b = e.getSelectionPageBounds()
    return {
      point: e.pageToScreen({ x: b.x + b.w, y: b.y + b.h }),
      w: b.w,
      h: b.h,
    }
  })
  await page.mouse.move(box.point.x, box.point.y)
  await page.mouse.down()
  await page.mouse.move(box.point.x + 30, box.point.y + 20, { steps: 5 })
  await page.mouse.up()
  assert.ok(
    (await page.evaluate(
      (id) => window.__cowartEditor.getShape(id).props.w,
      shape.id,
    )) > 120,
  )
  box = await page.evaluate(() => {
    const e = window.__cowartEditor,
      b = e.getSelectionPageBounds()
    return {
      point: e.pageToScreen({ x: b.x + b.w / 2, y: b.y - 29 }),
      center: e.pageToScreen(b.center),
    }
  })
  await page.mouse.move(box.point.x, box.point.y)
  await page.mouse.down()
  await page.mouse.move(box.center.x + 100, box.center.y, { steps: 10 })
  await page.mouse.up()
  assert.ok(
    Math.abs(
      await page.evaluate(
        (id) => window.__cowartEditor.getShape(id).rotation,
        shape.id,
      ),
    ) > 0.5,
  )
  await page.getByRole('button', { name: '文字', exact: true }).click()
  await page.mouse.click(rect.x + 420, rect.y + 160)
  await page
    .getByLabel('编辑标注文字', { exact: true })
    .fill('周年按钮：减少灯光')
  await page.getByLabel('编辑标注文字', { exact: true }).press('Control+Enter')
  assert.equal(
    await page.getByText('周年按钮：减少灯光', { exact: true }).count(),
    1,
  )
  await page.getByRole('button', { name: '箭头标注', exact: true }).click()
  await page.mouse.move(rect.x + 120, rect.y + 420)
  await page.mouse.down()
  await page.mouse.move(rect.x + 280, rect.y + 470, { steps: 7 })
  await page.mouse.up()
  assert.equal(
    await page.evaluate(
      () => window.__cowartEditor.getSelectedShapes()[0].type,
    ),
    'arrow',
  )
  // Independent image grouping, non-destructive duplication, batch ZIP and refs.
  await page.evaluate((ids) => window.__cowartEditor.select(...ids), images)
  const first = await page.evaluate((id) => {
    const e = window.__cowartEditor,
      b = e.getShapePageBounds(id)
    return e.pageToScreen({ x: b.x + 20, y: b.y + 20 })
  }, images[0])
  await page.mouse.click(first.x, first.y, { button: 'right' })
  const downloading = page.waitForEvent('download')
  await page
    .getByRole('menuitem', { name: '下载所选原图', exact: true })
    .click()
  const download = await downloading
  assert.match(download.suggestedFilename(), /\.zip$/)
  await page.evaluate((ids) => window.__cowartEditor.select(...ids), images)
  await page.keyboard.press('Control+g')
  assert.equal(
    await page.evaluate(
      () => window.__cowartEditor.getSelectedShapes()[0].type,
    ),
    'group',
  )
  await page.keyboard.press('Control+Shift+g')
  assert.equal(
    await page.evaluate(
      () => window.__cowartEditor.getSelectedShapeIds().length,
    ),
    2,
  )
  await page.evaluate((id) => window.__cowartEditor.select(id), images[0])
  await page.mouse.click(first.x, first.y, { button: 'right' })
  await page.getByRole('menuitem', { name: '用作参考图', exact: true }).click()
  await page.getByLabel('修改主图', { exact: true }).waitFor()
  assert.equal(
    await page.getByLabel('修改主图', { exact: true }).inputValue(),
    '',
  )
  let saved
  for (let i = 0; i < 80; i++) {
    saved = await (
      await context.request.get(
        base + '/api/cowart/snapshot?projectId=' + projectId,
      )
    ).json()
    if (
      saved.snapshot?.store?.[shape.id]?.rotation > 0 &&
      Object.values(saved.snapshot.store).filter((s) => s.type === 'text')
        .length
    )
      break
    await page.waitForTimeout(100)
  }
  assert.deepEqual(
    saved.snapshot.store['shape:legacy-opaque'],
    old.store['shape:legacy-opaque'],
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    (id) => !!window.__cowartEditor?.getShape(id),
    shape.id,
  )
  assert.equal(
    await page.evaluate(
      () =>
        window.__cowartEditor
          .getCurrentPageShapes()
          .filter((s) => s.type === 'image').length,
    ),
    2,
  )
  assert.deepEqual(errors, [])
  assert.deepEqual(foreign, [])
  await page.screenshot({
    path: new URL('../test-results/native-canvas.png', import.meta.url)
      .pathname,
    fullPage: true,
  })
  // Narrow viewport remains operable after the assistant is collapsed.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.hamoki-studio-panel header button').click()
  await page.getByRole('button', { name: '打开 Studio', exact: true }).waitFor()
  assert.equal(await page.locator('.hamoki-board').isVisible(), true)
  await page.screenshot({
    path: new URL('../test-results/native-mobile.png', import.meta.url)
      .pathname,
    fullPage: true,
  })
  console.log(
    'PASS: native canvas >10s, original legacy preservation, multi-file import, pointer move/resize/rotate, undo/redo, text/arrow, groups, ZIP, explicit reference, reload and mobile',
  )
}

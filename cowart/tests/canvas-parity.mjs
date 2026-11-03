import assert from 'node:assert/strict'
export async function verifyCanvasParity({ page, context, base, projectId }) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    const d = window.__cowartEditor
    d.selectNone()
    d.setCamera({ x: 0, y: 0, z: 1 })
    d.preferences.toolLock = false
  })
  const choose = async (label) => {
    await page.getByRole('button', { name: '工具库', exact: true }).click()
    await page
      .getByRole('region', { name: '工具库面板' })
      .getByRole('button', { name: label, exact: true })
      .click()
  }
  const drag = async (x = 440, y = 320, dx = 130, dy = 90) => {
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y + dy, { steps: 10 })
    await page.mouse.up()
  }
  const geoLabels = [
    '矩形',
    '椭圆',
    '三角形',
    '菱形',
    '六边形',
    '胶囊形',
    '平行四边形',
    '星形',
    '云朵',
    '心形',
    '叉选框',
    '勾选框',
    '左箭头',
    '上箭头',
    '下箭头',
    '右箭头',
  ]
  const geos = []
  for (let i = 0; i < geoLabels.length; i++) {
    await choose(geoLabels[i])
    await drag(350 + (i % 4) * 150, 240 + Math.floor(i / 4) * 140, 100, 80)
    const shape = await page.evaluate(
      () => window.__cowartEditor.getSelectedShapes()[0],
    )
    assert.equal(shape.type, 'geo')
    geos.push(shape.id)
  }
  for (const [label, type] of [
    ['画笔', 'draw'],
    ['荧光笔', 'highlight'],
    ['线条', 'line'],
    ['箭头', 'arrow'],
    ['框架', 'frame'],
    ['AI 占位框', 'frame'],
  ]) {
    await choose(label)
    await drag(420, 820, 160, -90)
    assert.equal(
      await page.evaluate(
        () => window.__cowartEditor.getSelectedShapes()[0]?.type,
      ),
      type,
      label,
    )
  }
  await choose('便签')
  await page.mouse.click(700, 780)
  await page
    .getByRole('textbox', { name: '编辑标注文字', exact: true })
    .fill('完整便签回归')
  await page
    .getByRole('textbox', { name: '编辑标注文字', exact: true })
    .press('Control+Enter')
  assert.equal(
    await page.evaluate(
      () => window.__cowartEditor.getSelectedShapes()[0].type,
    ),
    'note',
  )
  await choose('曲线标注')
  await drag(800, 720, -100, -90)
  await page
    .getByRole('textbox', { name: '编辑标注文字', exact: true })
    .fill('曲线标注标签')
  await page
    .getByRole('textbox', { name: '编辑标注文字', exact: true })
    .press('Control+Enter')
  const annotation = await page.evaluate(
    () => window.__cowartEditor.getSelectedShapes()[0],
  )
  assert.ok(annotation.meta.cowartAnnotationArrow)
  assert.ok(annotation.props.bend)
  const count = await page.evaluate(
    () => window.__cowartEditor.getCurrentPageShapes().length,
  )
  await choose('激光笔')
  await drag(700, 680, 80, -40)
  assert.equal(
    await page.evaluate(
      () => window.__cowartEditor.getCurrentPageShapes().length,
    ),
    count,
  )
  // Real eraser deletes only a stroke beneath the pointer, then undo restores it.
  await choose('画笔')
  await drag(780, 400, 120, 30)
  const drawId = await page.evaluate(() => window.__cowartEditor.selected[0])
  await choose('橡皮')
  await page.mouse.click(840, 415)
  assert.ok(
    !(await page.evaluate((id) => window.__cowartEditor.getShape(id), drawId)),
  )
  await page.keyboard.press('Control+z')
  assert.ok(
    await page.evaluate((id) => window.__cowartEditor.getShape(id), drawId),
  )
  // Rich text uses editable DOM; save, reopen and export retain the marked runs.
  await choose('文字')
  await page.mouse.click(700, 600)
  const textbox = page.getByRole('textbox', {
    name: '编辑标注文字',
    exact: true,
  })
  await textbox.fill('格式化文字')
  const typingId = await page.evaluate(() => window.__cowartEditor.selected[0])
  let typingSaved = false
  for (let i = 0; i < 50; i++) {
    const saved = await (
      await context.request.get(
        base + '/api/cowart/snapshot?projectId=' + projectId,
      )
    ).json()
    if (
      (
        JSON.stringify(saved.snapshot?.store?.[typingId]?.props.richText) || ''
      ).includes('格式化文字')
    ) {
      typingSaved = true
      break
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.ok(typingSaved, 'Text must save while its editor remains open')
  await textbox.press('Control+a')
  await page.getByRole('button', { name: '文字粗体', exact: true }).click()
  await page.getByRole('button', { name: '有序列表', exact: true }).click()
  await textbox.press('Control+Enter')
  const richId = await page.evaluate(() => window.__cowartEditor.selected[0])
  assert.ok(
    await page.evaluate(
      (id) =>
        JSON.stringify(
          window.__cowartEditor.getShape(id).props.richText,
        ).includes('bold'),
      richId,
    ),
  )
  assert.ok(
    await page.evaluate(
      (id) =>
        JSON.stringify(
          window.__cowartEditor.getShape(id).props.richText,
        ).includes('orderedList'),
      richId,
    ),
  )
  const richBefore = await page.evaluate(
    (id) => window.__cowartEditor.getShape(id).props.richText,
    richId,
  )
  await page.keyboard.press('Control+z')
  assert.ok(
    !(await page.evaluate((id) => window.__cowartEditor.getShape(id), richId)),
  )
  await page.keyboard.press('Control+Shift+z')
  assert.deepEqual(
    await page.evaluate(
      (id) => window.__cowartEditor.getShape(id).props.richText,
      richId,
    ),
    richBefore,
  )
  // Arrange, grouped style/opacity, native clipboard and page menus use actual UI.
  const actionIds = [geos[0], geos[5], geos[10]]
  const starts = await page.evaluate((ids) => {
    const d = window.__cowartEditor
    d.select(...ids)
    return ids.map((id) => d.getShapePageBounds(id).x)
  }, actionIds)
  await page.getByRole('button', { name: '排列', exact: true }).click()
  await page.getByRole('button', { name: '左对齐', exact: true }).click()
  const aligned = await page.evaluate(
    (ids) => ids.map((id) => window.__cowartEditor.getShapePageBounds(id).x),
    actionIds,
  )
  assert.ok(aligned.every((x) => Math.abs(x - Math.min(...starts)) < 0.001))
  await page.keyboard.press('Control+z')
  assert.deepEqual(
    await page.evaluate(
      (ids) => ids.map((id) => window.__cowartEditor.getShapePageBounds(id).x),
      actionIds,
    ),
    starts,
  )
  await page.getByRole('button', { name: '组合', exact: true }).click()
  const groupId = await page.evaluate(() => window.__cowartEditor.selected[0])
  await page.getByRole('button', { name: '样式', exact: true }).click()
  await page.getByRole('button', { name: '样式颜色 red', exact: true }).click()
  await page.getByLabel('不透明度', { exact: true }).selectOption('0.5')
  await page.getByLabel('填充', { exact: true }).selectOption('pattern')
  await page.getByLabel('线型', { exact: true }).selectOption('draw')
  assert.ok(
    await page.evaluate(
      (ids) =>
        ids.every(
          (id) => window.__cowartEditor.getShape(id).props.color === 'red',
        ),
      actionIds,
    ),
  )
  assert.equal(
    await page
      .locator(`[data-shape-id="${actionIds[0]}"]`)
      .getAttribute('opacity'),
    '0.5',
  )
  await page.getByRole('button', { name: '排列', exact: true }).click()
  await page.getByRole('button', { name: '取消组合', exact: true }).click()
  assert.ok(
    !(await page.evaluate((id) => window.__cowartEditor.getShape(id), groupId)),
  )
  assert.equal(
    await page
      .locator(`[data-shape-id="${actionIds[0]}"]`)
      .getAttribute('opacity'),
    '0.5',
  )
  await page.getByRole('button', { name: '关闭画布面板', exact: true }).click()
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: base,
  })
  const beforePaste = await page.evaluate(
    () => window.__cowartEditor.getCurrentPageShapes().length,
  )
  await page.locator('.hamoki-board').focus()
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await page.waitForFunction(
    (n) => window.__cowartEditor.getCurrentPageShapes().length === n + 3,
    beforePaste,
  )
  const pageBefore = await page.evaluate(() => {
    const d = window.__cowartEditor
    return {
      id: d.pageId,
      name: d.records[d.pageId].name,
      count: d.getCurrentPageShapes().length,
      pages: d.getPages().length,
    }
  })
  await page.getByRole('button', { name: '页面', exact: true }).click()
  await page.getByRole('button', { name: '复制当前页面', exact: true }).click()
  const copied = await page.evaluate(() => {
    const d = window.__cowartEditor
    return {
      id: d.pageId,
      count: d.getCurrentPageShapes().length,
      pages: d.getPages().length,
    }
  })
  assert.notEqual(copied.id, pageBefore.id)
  assert.equal(copied.count, pageBefore.count)
  assert.equal(copied.pages, pageBefore.pages + 1)
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: '删除当前页面', exact: true }).click()
  assert.equal(
    await page.evaluate(() => window.__cowartEditor.getPages().length),
    pageBefore.pages,
  )
  await page.keyboard.press('Control+z')
  assert.equal(
    await page.evaluate(() => window.__cowartEditor.getPages().length),
    pageBefore.pages + 1,
  )
  await page
    .getByRole('region', { name: '页面面板' })
    .getByRole('button', { name: pageBefore.name, exact: true })
    .click()
  await page.getByRole('button', { name: '关闭画布面板', exact: true }).click()
  // Connectors bind to the visible edges, follow targets, detach on an explicit
  // arrow-body drag, and restore their exact identity/bindings with one undo.
  const originalPage = await page.evaluate(() => window.__cowartEditor.pageId)
  await page.getByRole('button', { name: '新增画布页面', exact: true }).click()
  await page.evaluate(() =>
    window.__cowartEditor.setCamera({ x: 0, y: 0, z: 1 }),
  )
  await choose('矩形')
  await drag(350, 320, 100, 80)
  const left = await page.evaluate(() => window.__cowartEditor.selected[0])
  await choose('矩形')
  await drag(650, 320, 100, 80)
  const right = await page.evaluate(() => window.__cowartEditor.selected[0])
  await choose('箭头')
  await drag(400, 360, 300, 0)
  const connector = await page.evaluate(() => window.__cowartEditor.selected[0])
  const bound = await page.evaluate((id) => {
    const d = window.__cowartEditor
    return {
      bindings: d.getBindings(id).length,
      points: d.getArrowEndpoints(d.getShape(id)),
    }
  }, connector)
  assert.equal(bound.bindings, 2)
  assert.ok(Math.abs(bound.points.start.x - 50) < 0.01)
  assert.ok(Math.abs(bound.points.end.x - 250) < 0.01)
  await choose('选择')
  await drag(400, 360, 40, 60)
  const followed = await page.evaluate((id) => {
    const d = window.__cowartEditor,
      s = d.getShape(id),
      ends = d.getArrowEndpoints(s)
    return {
      bindings: d.getBindings(id).length,
      mid: d.pageToScreen({
        x: s.x + (ends.start.x + ends.end.x) / 2,
        y: s.y + (ends.start.y + ends.end.y) / 2,
      }),
    }
  }, connector)
  assert.equal(followed.bindings, 2)
  assert.ok(followed.mid.y > 360)
  await page.evaluate((id) => window.__cowartEditor.select(id), connector)
  await page.mouse.move(followed.mid.x, followed.mid.y)
  await page.mouse.down()
  await page.mouse.move(followed.mid.x, followed.mid.y + 70, { steps: 10 })
  await page.mouse.up()
  assert.equal(
    await page.evaluate(
      (id) => window.__cowartEditor.getBindings(id).length,
      connector,
    ),
    0,
  )
  await page.keyboard.press('Control+z')
  assert.equal(
    await page.evaluate(
      (id) => window.__cowartEditor.getBindings(id).length,
      connector,
    ),
    2,
  )
  await page.getByRole('button', { name: '页面', exact: true }).click()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: '删除当前页面', exact: true }).click()
  await page.getByRole('button', { name: '关闭画布面板', exact: true }).click()
  assert.equal(
    await page.evaluate(() => window.__cowartEditor.pageId),
    originalPage,
  )
  // Actual file import + draggable crop + flip: assert rendered pixels, not just props.
  const source = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 200
    c.height = 100
    const x = c.getContext('2d')
    x.fillStyle = '#ff0000'
    x.fillRect(0, 0, 100, 100)
    x.fillStyle = '#0000ff'
    x.fillRect(100, 0, 100, 100)
    return c.toDataURL()
  })
  await page.getByLabel('选择导入图片', { exact: true }).setInputFiles({
    name: 'crop-pixel-fixture.png',
    mimeType: 'image/png',
    buffer: Buffer.from(source.split(',')[1], 'base64'),
  })
  await page.waitForFunction(
    () =>
      window.__cowartEditor.getSelectedShapes()[0]?.props.altText ===
      'crop-pixel-fixture.png',
  )
  await page.waitForFunction(() =>
    window.__cowartEditor
      .getAsset(window.__cowartEditor.getSelectedShapes()[0]?.props.assetId)
      ?.props.src.startsWith('/api/media/'),
  )
  const cropBefore = await page.evaluate(() => {
    const d = window.__cowartEditor,
      s = d.getSelectedShapes()[0]
    return {
      id: s.id,
      assetId: s.props.assetId,
      src: d.getAsset(s.props.assetId).props.src,
    }
  })
  await page.getByRole('button', { name: '样式', exact: true }).click()
  await page.getByRole('button', { name: '拖动裁剪图片', exact: true }).click()
  const stage = await page.locator('.hamoki-crop-stage').boundingBox(),
    corner = await page.getByLabel('裁剪角 nw', { exact: true }).boundingBox()
  await page.mouse.move(
    corner.x + corner.width / 2 + 2,
    corner.y + corner.height / 2 + 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    stage.x + stage.width * 0.25,
    stage.y + stage.height * 0.05,
    { steps: 8 },
  )
  await page.mouse.up()
  await page.getByRole('button', { name: '应用裁剪', exact: true }).click()
  await page.getByRole('button', { name: '排列', exact: true }).click()
  await page.getByRole('button', { name: '水平翻转', exact: true }).click()
  const pixels = await page.evaluate(async (before) => {
    const d = window.__cowartEditor,
      s = d.getShape(before.id),
      r = await d.toImageDataUrl([s.id], {
        background: false,
        padding: 0,
        pixelRatio: 1,
      }),
      image = new Image()
    image.src = r.url
    await image.decode()
    const c = document.createElement('canvas')
    c.width = image.width
    c.height = image.height
    const x = c.getContext('2d')
    x.drawImage(image, 0, 0)
    return {
      src: d.getAsset(s.props.assetId).props.src,
      crop: s.props.crop,
      flip: s.props.flipX,
      left: [
        ...x.getImageData(
          Math.floor(c.width * 0.1),
          Math.floor(c.height * 0.5),
          1,
          1,
        ).data,
      ],
      right: [
        ...x.getImageData(
          Math.floor(c.width * 0.9),
          Math.floor(c.height * 0.5),
          1,
          1,
        ).data,
      ],
    }
  }, cropBefore)
  assert.equal(pixels.src, cropBefore.src)
  assert.ok(pixels.crop.topLeft.x > 0.2)
  assert.ok(pixels.flip)
  assert.ok(
    pixels.left[2] > 240 && pixels.left[0] < 15,
    'left cropped/flipped pixel must be blue',
  )
  assert.ok(
    pixels.right[0] > 240 && pixels.right[2] < 15,
    'right cropped/flipped pixel must be red',
  )
  await page.getByRole('button', { name: '关闭画布面板', exact: true }).click()
  // Every geometry is rendered as its own vector path; SVG/PNG use that same renderer.
  await page.evaluate((ids) => window.__cowartEditor.select(...ids), geos)
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const svgDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click()
  const svg = await svgDownload
  assert.equal(svg.suggestedFilename(), 'hamoki-canvas.svg')
  const bytesOf = async (download) => {
    const chunks = []
    for await (const chunk of await download.createReadStream())
      chunks.push(chunk)
    return Buffer.concat(chunks)
  }
  const svgText = (await bytesOf(svg)).toString('utf8')
  const vector = await page.evaluate((text) => {
    const d = new DOMParser().parseFromString(text, 'image/svg+xml')
    return {
      error: !!d.querySelector('parsererror'),
      shapes: d.querySelectorAll('[data-shape-type=geo]').length,
      selection: d.querySelectorAll('[data-selection-decoration]').length,
    }
  }, svgText)
  assert.deepEqual(vector, { error: false, shapes: 16, selection: 0 })
  const pngDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click()
  const png = await pngDownload
  assert.equal(png.suggestedFilename(), 'hamoki-canvas.png')
  const pngBytes = await bytesOf(png)
  assert.equal(pngBytes.subarray(1, 4).toString(), 'PNG')
  assert.ok(pngBytes.readUInt32BE(16) > 500)
  assert.ok(pngBytes.readUInt32BE(20) > 500)
  await page.getByRole('button', { name: '关闭画布面板', exact: true }).click()
  await page.evaluate(() => window.__cowartEditor.selectNone())
  await page.waitForFunction(
    () => document.body.textContent.includes('已同步'),
    {},
    { timeout: 20000 },
  )
  const before = await page.evaluate(() => {
    const d = window.__cowartEditor
    return d
      .getCurrentPageShapes()
      .map((s) => ({ id: s.id, type: s.type, props: s.props }))
  })
  await page.reload()
  await page.waitForFunction(() => !!window.__cowartEditor)
  const restored = await page.evaluate(() =>
    window.__cowartEditor
      .getCurrentPageShapes()
      .map((s) => ({ id: s.id, type: s.type, props: s.props })),
  )
  assert.deepEqual(restored, before)
  await page.screenshot({
    path: new URL('../test-results/canvas-parity.png', import.meta.url)
      .pathname,
    fullPage: true,
  })
  console.log(
    'PASS: full tool inventory, sixteen geometry variants, draw/highlight/eraser/laser, note/annotation/rich text, draggable crop/flip with actual pixels and intact source, valid SVG/PNG, save and reload',
  )
}

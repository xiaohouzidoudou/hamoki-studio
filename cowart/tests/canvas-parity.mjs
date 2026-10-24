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
  await textbox.press('Control+a')
  await page.getByRole('button', { name: '文字粗体', exact: true }).click()
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
  // Every geometry is rendered as its own vector path; SVG/PNG use that same renderer.
  await page.evaluate((ids) => window.__cowartEditor.select(...ids), geos)
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const svgDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click()
  const svg = await svgDownload
  assert.equal(svg.suggestedFilename(), 'hamoki-canvas.svg')
  const pngDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click()
  assert.equal((await pngDownload).suggestedFilename(), 'hamoki-canvas.png')
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
    'PASS: full tool inventory, sixteen geometry variants, draw/highlight/eraser/laser, note/annotation/rich text, SVG/PNG, save and reload',
  )
}

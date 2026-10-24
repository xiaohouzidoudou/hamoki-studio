import { createShapeId, toRichText } from '../canvas/model.js'
import { generateKeyBetween } from 'fractional-indexing'

const DEMO_IMAGE_DISPLAY_W = 900
const DEMO_IMAGE_X = 280
const DEMO_IMAGE_Y = 88
const ONBOARDING_META = { cowartOnboarding: true }

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function createOnboardingTextShape({ editor, pageId, x, y, text, size = 'm', w = 248 }) {
  const id = createShapeId()
  editor.createShape({
    id,
    type: 'text',
    parentId: pageId,
    x,
    y,
    meta: ONBOARDING_META,
    props: {
      richText: toRichText(text),
      color: 'blue',
      size,
      font: 'sans',
      textAlign: 'start',
      w,
      autoSize: true,
      scale: editor.getResizeScaleFactor()
    }
  })
  return id
}

// Seed the canvas with the demo screenshot and concise step labels for first-time users.
export async function seedDemoCanvas(editor) {
  const pageId = editor.getCurrentPageId()
  editor.markHistoryStoppingPoint('cowart-onboarding-demo')

  createOnboardingTextShape({
    editor,
    pageId,
    x: 24,
    y: 24,
    text: 'Hamoki Studio · Cowart 创作画布',
    size: 'l',
    w: 420
  })
  createOnboardingTextShape({
    editor,
    pageId,
    x: 24,
    y: 68,
    text: '选中素材后通过右侧 AI 面板生成或修改图片',
    size: 's',
    w: 420
  })

  const steps = [
    '① 工具栏「AI 图片」— 放置占位框',
    '②「标注」— 画箭头写修改说明',
    '③ 选中内容 →「✨ AI 助手」生成',
    '④ 模型由 Studio 后台统一配置；这里不保存 API Key'
  ]

  let stepY = 160
  for (const text of steps) {
    createOnboardingTextShape({ editor, pageId, x: 24, y: stepY, text })
    stepY += 52
  }

  editor.timers.requestAnimationFrame(() => {
    editor.zoomToFit({ animation: { duration: 320 } })
  })
}

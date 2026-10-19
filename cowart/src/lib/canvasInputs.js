export const IMAGE_REFERENCE_ROLES = [
  ['general', '综合参考'], ['shape', '造型与结构'], ['color', '配色'],
  ['style', '画风与材质'], ['pose', '动作与构图'], ['background', '背景与氛围']
]

export function canvasInputSelection(shapes, primaryChoice = 'auto') {
  const images = shapes.filter(shape => shape.type === 'image')
  const holder = shapes.find(shape => shape.type === 'frame' && shape.meta?.cowartAiImageHolder)
  const primary = primaryChoice === 'auto' ? (!holder && images.length === 1 ? images[0] : null) :
    images.find(shape => shape.id === primaryChoice) || null
  return { images, holder, primary, anchor: holder || primary || images[0] || shapes[0] }
}

export function isEmptyImageHolder(store, shape) {
  return shape?.type === 'frame' && !!shape?.meta?.cowartAiImageHolder && !Object.values(store).some(record =>
    record.typeName === 'shape' && record.parentId === shape.id)
}

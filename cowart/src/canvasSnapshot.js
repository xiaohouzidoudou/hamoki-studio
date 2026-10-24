// Validate the storage envelope without invoking an external editor schema.
// Unknown legacy records stay opaque and are carried through every save.
export function isCanvasSnapshot(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !!value.store &&
    typeof value.store === 'object' &&
    !Array.isArray(value.store) &&
    !!value.schema &&
    typeof value.schema === 'object' &&
    !Array.isArray(value.schema)
  )
}
export function firstErrorLine(error) {
  return String(error?.message || error).split('\n')[0]
}
export function describeSkippedRecord(record, reason) {
  return {
    id: record?.id || '(missing id)',
    typeName: record?.typeName || '(missing typeName)',
    type: record?.type || null,
    reason: firstErrorLine(reason),
  }
}
export function sanitizeCanvasSnapshot(snapshot) {
  if (snapshot == null) return { snapshot: null, skippedRecords: [] }
  if (!isCanvasSnapshot(snapshot))
    throw Error('旧画布格式无法安全读取，已停止保存；请先导出原始备份')
  if (snapshot.schema.hamokiCanvas > 1)
    throw Error('此画布来自较新的版本，已停止保存，避免覆盖')
  const warnings = []
  for (const [id, r] of Object.entries(snapshot.store)) {
    if (!r || typeof r !== 'object' || r.id !== id)
      throw Error('画布记录不完整，已停止保存，避免丢失内容')
    if (r.typeName === 'shape') {
      if (
        !['image', 'frame', 'group', 'geo', 'text', 'note', 'arrow'].includes(
          r.type,
        )
      )
        warnings.push(
          describeSkippedRecord(r, '旧元素暂不支持编辑，原始记录将保留'),
        )
      if (!snapshot.store[r.parentId])
        warnings.push(describeSkippedRecord(r, '父元素缺失，原始记录将保留'))
      if (r.type === 'image' && !snapshot.store[r.props?.assetId])
        warnings.push(describeSkippedRecord(r, '原图引用缺失，原始记录将保留'))
    }
  }
  return {
    snapshot: {
      schema: { ...snapshot.schema, hamokiCanvas: 1 },
      store: { ...snapshot.store },
    },
    skippedRecords: warnings,
  }
}

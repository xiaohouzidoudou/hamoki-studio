// A completed image is recoverable until a server snapshot contains it.
export function acknowledgeSavedResult(projectId, snapshot, storage = sessionStorage) {
  const key = 'hamoki-cowart-active:' + projectId
  try {
    const pending = JSON.parse(storage.getItem(key) || 'null')
    if (!pending?.resultId) return false
    const saved = Object.values(snapshot?.store || {}).some(record =>
      record.typeName === 'shape' && record.meta?.studioHistoryId === pending.resultId &&
      record.meta?.studioProjectId === projectId)
    if (!saved) return false
    storage.removeItem(key)
    storage.removeItem('hamoki-cowart-last-request:' + projectId)
    return true
  } catch {
    return false
  }
}

export function hasUnsavedResult(projectId, storage = sessionStorage) {
  // Fail closed when browser storage is unavailable: do not replace job identity.
  try {
    return !!JSON.parse(storage.getItem('hamoki-cowart-active:' + projectId) || 'null')?.resultId
  } catch {
    return true
  }
}

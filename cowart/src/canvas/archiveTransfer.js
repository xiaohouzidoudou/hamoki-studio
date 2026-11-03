// Stream large downloads to a user-selected file. Unsupported browsers have a
// bounded-memory fallback; an API error is never offered as a ZIP download.
export function chooseArchiveDestination() {
  if (typeof window.showSaveFilePicker !== 'function') return Promise.resolve(null)
  return window.showSaveFilePicker({
    suggestedName: 'hamoki-canvas.zip',
    types: [{ description: 'Hamoki 画布完整备份', accept: { 'application/zip': ['.zip'] } }],
  })
}
export async function downloadArchive(projectId, destination, { signal, onProgress = () => {} } = {}) {
  const response = await fetch('/api/cowart/archive?projectId=' + encodeURIComponent(projectId), {
    credentials: 'same-origin', cache: 'no-store', signal,
  })
  if (!response.ok) {
    const result = await response.json().catch(() => ({}))
    throw Error(result.error || '完整备份下载失败：' + response.status)
  }
  if (response.headers.get('content-type')?.split(';')[0] !== 'application/zip') {
    await response.body?.cancel()
    throw Error('服务器未返回完整备份文件')
  }
  const length = Number(response.headers.get('content-length'))
  const limit = 100 * 1024 ** 2
  if (!destination && (!length || length > limit)) {
    await response.body?.cancel()
    throw Error('大备份请使用支持直接保存文件的桌面 Edge 或 Chrome')
  }
  let writer, reader, received = 0
  const chunks = []
  try {
    if (signal?.aborted) throw new DOMException('备份已取消', 'AbortError')
    if (destination) writer = await destination.createWritable()
    reader = response.body.getReader()
    for (;;) {
      if (signal?.aborted) throw new DOMException('备份已取消', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (!destination && received > limit) throw Error('备份超出当前浏览器的下载容量')
      if (writer) await writer.write(value)
      else chunks.push(value)
      onProgress('正在下载备份 ' + Math.round(received / 1024 ** 2) + ' MB' + (length ? ' / ' + Math.ceil(length / 1024 ** 2) + ' MB' : ''))
    }
    if (!received || (length && received !== length)) throw Error('备份下载不完整，请重试')
    if (writer) await writer.close()
    else {
      const url = URL.createObjectURL(new Blob(chunks, { type: 'application/zip' }))
      const link = document.createElement('a')
      link.href = url; link.download = 'hamoki-canvas.zip'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    }
  } catch (error) {
    await reader?.cancel().catch(() => {})
    await writer?.abort().catch(() => {})
    throw error
  } finally { reader?.releaseLock() }
}

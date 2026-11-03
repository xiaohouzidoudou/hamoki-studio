function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// Never mutate records owned by the live editor while capturing an async save.
// A missing blob must fail the save, so callers keep the document dirty.
export async function normalizeAssetSources(snapshot) {
  const store = { ...snapshot.store }
  for (const [id, record] of Object.entries(store)) {
    const src = record?.props?.src
    if (record?.typeName !== 'asset' || record.type !== 'image' ||
        typeof src !== 'string' || !src.startsWith('blob:')) continue
    try {
      const response = await fetch(src)
      if (!response.ok) throw new Error('读取图片失败')
      const captured = await blobToDataUrl(await response.blob())
      store[id] = { ...record, props: { ...record.props, src: captured } }
    } catch {
      throw new Error('画布图片尚未保存：无法读取导入图片，请重新导入后再保存')
    }
  }
  return { ...snapshot, store }
}

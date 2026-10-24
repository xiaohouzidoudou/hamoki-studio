// Interoperability reader for recorded point data. IEEE 754 float32 origin,
// followed by little-endian binary16 deltas (x,y,pressure). This independent
// decoder is validated against fixed data fixtures, without an editor runtime.
function half(bits) {
  const sign = bits & 0x8000 ? -1 : 1,
    e = (bits >>> 10) & 31,
    f = bits & 1023
  return e === 31
    ? f
      ? NaN
      : sign * Infinity
    : sign *
        (e === 0
          ? (Math.pow(2, -14) * f) / 1024
          : Math.pow(2, e - 15) * (1 + f / 1024))
}
export function decodeLegacyPath(value) {
  if (
    typeof value !== 'string' ||
    value.length > 4 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    return []
  try {
    const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
    if (bytes.length < 12 || (bytes.length - 12) % 6) return []
    const view = new DataView(bytes.buffer),
      p = {
        x: view.getFloat32(0, true),
        y: view.getFloat32(4, true),
        z: view.getFloat32(8, true),
      },
      points = [{ ...p }]
    for (let i = 12; i < bytes.length; i += 6) {
      p.x += half(view.getUint16(i, true))
      p.y += half(view.getUint16(i + 2, true))
      p.z += half(view.getUint16(i + 4, true))
      if (!Number.isFinite(p.x + p.y + p.z)) return []
      points.push({ ...p })
    }
    return points
  } catch {
    return []
  }
}

import { decodeLegacyPath } from './legacyPaths.js'
// Product feature inventory and independent geometric constructions.
export const geometries = [
  ['rectangle', '矩形'],
  ['ellipse', '椭圆'],
  ['triangle', '三角形'],
  ['diamond', '菱形'],
  ['hexagon', '六边形'],
  ['oval', '胶囊形'],
  ['rhombus', '平行四边形'],
  ['star', '星形'],
  ['cloud', '云朵'],
  ['heart', '心形'],
  ['x-box', '叉选框'],
  ['check-box', '勾选框'],
  ['arrow-left', '左箭头'],
  ['arrow-up', '上箭头'],
  ['arrow-down', '下箭头'],
  ['arrow-right', '右箭头'],
]
export const tools = [
  ['annotation', '曲线标注', 'C'],
  ['select', '选择', 'V'],
  ['hand', '平移', 'H'],
  ['holder', 'AI 占位框', 'A'],
  ['draw', '画笔', 'D'],
  ['eraser', '橡皮', 'E'],
  ['text', '文字', 'T'],
  ['arrow', '箭头', 'Shift+A'],
  ['note', '便签', 'N'],
  ...geometries.map((t) => (t[0] === 'rectangle' ? [...t, 'R'] : t)),
  ['line', '线条', 'L'],
  ['highlight', '荧光笔', 'Shift+D'],
  ['laser', '激光笔', 'K'],
  ['frame', '框架', 'F'],
]
export const fontFamilies = {
  draw: '"Comic Sans MS", "KaiTi", cursive',
  sans: 'system-ui, sans-serif',
  serif: 'Georgia, "Songti SC", serif',
  mono: 'ui-monospace, monospace',
}
export const strokeWidth = (p = {}) =>
  ({ s: 1.5, m: 2.5, l: 4.5, xl: 8 })[p.size] || 2.5
export const fontSize = (p = {}) =>
  p.fontSize || { s: 16, m: 22, l: 30, xl: 40 }[p.size] || 22
export function polygon(points) {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ') + ' Z'
}
export function geoPath(kind, w, h) {
  const rect = `M0 0 H${w} V${h} H0 Z`
  if (kind === 'ellipse')
    return `M0 ${h / 2} A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2} A${w / 2} ${h / 2} 0 1 0 0 ${h / 2} Z`
  if (kind === 'oval') {
    const r = Math.min(w, h) / 2
    return `M${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${h - r} Q${w} ${h} ${w - r} ${h} H${r} Q0 ${h} 0 ${h - r} V${r} Q0 0 ${r} 0 Z`
  }
  if (kind === 'triangle')
    return polygon([
      [w / 2, 0],
      [w, h],
      [0, h],
    ])
  if (kind === 'diamond')
    return polygon([
      [w / 2, 0],
      [w, h / 2],
      [w / 2, h],
      [0, h / 2],
    ])
  if (kind === 'rhombus')
    return polygon([
      [w * 0.2, 0],
      [w, 0],
      [w * 0.8, h],
      [0, h],
    ])
  if (kind === 'hexagon')
    return polygon([
      [w * 0.25, 0],
      [w * 0.75, 0],
      [w, h / 2],
      [w * 0.75, h],
      [w * 0.25, h],
      [0, h / 2],
    ])
  if (kind === 'star')
    return polygon(
      Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5,
          r = i % 2 ? 0.22 : 0.5
        return [w / 2 + Math.cos(a) * w * r, h / 2 + Math.sin(a) * h * r]
      }),
    )
  if (kind === 'heart')
    return `M${w / 2} ${h} C${w * 0.4} ${h * 0.86} 0 ${h * 0.57} 0 ${h * 0.27} C0 ${-h * 0.08} ${w * 0.4} ${-h * 0.08} ${w / 2} ${h * 0.23} C${w * 0.6} ${-h * 0.08} ${w} ${-h * 0.08} ${w} ${h * 0.27} C${w} ${h * 0.57} ${w * 0.6} ${h * 0.86} ${w / 2} ${h} Z`
  if (kind === 'cloud')
    return `M${w * 0.2} ${h * 0.92} C${-w * 0.08} ${h} ${-w * 0.04} ${h * 0.5} ${w * 0.16} ${h * 0.5} C${w * 0.08} ${h * 0.12} ${w * 0.4} ${-h * 0.1} ${w * 0.55} ${h * 0.2} C${w * 0.8} ${-h * 0.08} ${w * 1.03} ${h * 0.2} ${w * 0.86} ${h * 0.46} C${w * 1.1} ${h * 0.5} ${w * 1.04} ${h} ${w * 0.78} ${h * 0.92} Z`
  if (kind?.startsWith('arrow-')) {
    const points = [
      [0, 0.32],
      [0.62, 0.32],
      [0.62, 0],
      [1, 0.5],
      [0.62, 1],
      [0.62, 0.68],
      [0, 0.68],
    ]
    return polygon(
      points.map(([x, y]) => {
        if (kind === 'arrow-left') return [(1 - x) * w, y * h]
        if (kind === 'arrow-up') return [y * w, (1 - x) * h]
        if (kind === 'arrow-down') return [y * w, x * h]
        return [x * w, y * h]
      }),
    )
  }
  return rect
}
export function linePoints(props = {}) {
  if (Array.isArray(props.points))
    return props.points.filter(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
    )
  // Existing line records use a keyed handle table; preserve its declared order.
  if (props.points && typeof props.points === 'object')
    return Object.values(props.points)
      .sort((a, b) =>
        String(a.index) < String(b.index)
          ? -1
          : String(a.index) > String(b.index)
            ? 1
            : 0,
      )
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  return []
}
export function strokePoints(props = {}) {
  if (Array.isArray(props.points)) return linePoints(props)
  return (props.segments || []).flatMap((s) =>
    Array.isArray(s.points) ? s.points : decodeLegacyPath(s.path || s.points),
  )
}
export function pathThrough(points, curved = false) {
  if (!points.length) return ''
  if (points.length === 1) return `M${points[0].x} ${points[0].y} l.01 .01`
  let d = `M${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    const p = points[i],
      prev = points[i - 1],
      next = points[i + 1]
    if (curved && next)
      d += ` Q${p.x} ${p.y} ${(p.x + next.x) / 2} ${(p.y + next.y) / 2}`
    else if (curved && i === 1) d += ` Q${prev.x} ${prev.y} ${p.x} ${p.y}`
    else d += ` L${p.x} ${p.y}`
  }
  return d
}
export function arrowGeometry(p = {}, endpoints) {
  const a = endpoints?.start || p.start || { x: 0, y: 0 },
    b = endpoints?.end || p.end || { x: 160, y: 80 }
  if (p.kind === 'elbow') {
    const mid = (a.x + b.x) / 2
    return {
      d: `M${a.x} ${a.y} H${mid} V${b.y} H${b.x}`,
      start: a,
      end: b,
      startAngle: b.x >= a.x ? 0 : Math.PI,
      endAngle: b.x >= a.x ? 0 : Math.PI,
      label: { x: mid, y: (a.y + b.y) / 2 },
    }
  }
  const dx = b.x - a.x,
    dy = b.y - a.y,
    len = Math.hypot(dx, dy) || 1,
    bend = p.kind === 'straight' ? 0 : Number(p.bend) || 0
  const c = {
    x: (a.x + b.x) / 2 - (dy / len) * bend * 2,
    y: (a.y + b.y) / 2 + (dx / len) * bend * 2,
  }
  return {
    d: bend
      ? `M${a.x} ${a.y} Q${c.x} ${c.y} ${b.x} ${b.y}`
      : `M${a.x} ${a.y} L${b.x} ${b.y}`,
    start: a,
    end: b,
    startAngle: Math.atan2(c.y - a.y, c.x - a.x),
    endAngle: Math.atan2(b.y - c.y, b.x - c.x),
    label: { x: (a.x + 2 * c.x + b.x) / 4, y: (a.y + 2 * c.y + b.y) / 4 },
  }
}
export function pointDistance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    )
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t)
}
export function pressureOutline(points, width) {
  if (!points.length) return ''
  if (points.length === 1) {
    const p = points[0],
      r = width * Math.max(0.2, p.z ?? 0.5)
    return `M${p.x - r} ${p.y} A${r} ${r} 0 1 0 ${p.x + r} ${p.y} A${r} ${r} 0 1 0 ${p.x - r} ${p.y} Z`
  }
  const left = [],
    right = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      prev = points[Math.max(0, i - 1)],
      next = points[Math.min(points.length - 1, i + 1)],
      dx = next.x - prev.x,
      dy = next.y - prev.y,
      len = Math.hypot(dx, dy) || 1,
      r = width * Math.max(0.15, Math.min(1, p.z ?? 0.5))
    left.push([p.x - (dy / len) * r, p.y + (dx / len) * r])
    right.push([p.x + (dy / len) * r, p.y - (dx / len) * r])
  }
  return polygon([...left, ...right.reverse()])
}

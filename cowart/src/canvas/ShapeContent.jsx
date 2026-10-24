import { layoutRich, safeLink } from './richText.js'
import { plainText, localBounds, shapeColor, safeImageSource } from './model.js'
import {
  geoPath,
  pressureOutline,
  linePoints,
  strokePoints,
  pathThrough,
  arrowGeometry,
  strokeWidth,
  fontSize,
  fontFamilies,
} from './features.js'
function TextLabel({ shape, box, arrow, wrap = true }) {
  const p = shape.props || {},
    size = fontSize(p),
    color = shapeColor(shape),
    font = fontFamilies[p.font] || fontFamilies.sans,
    doc = p.richText || {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: p.text || '' }] },
      ],
    },
    lines = layoutRich(
      doc,
      box.w - (shape.type === 'text' ? 0 : 24),
      `${size}px ${font}`,
      wrap && p.autoSize !== true,
    ),
    align = p.textAlign || 'start',
    x =
      arrow?.x ??
      (align === 'middle'
        ? box.w / 2
        : align === 'end'
          ? box.w - 12
          : shape.type === 'text'
            ? 0
            : 12),
    height = lines.length * size * 1.35,
    y =
      arrow?.y ??
      (p.verticalAlign === 'end'
        ? box.h - height
        : p.verticalAlign === 'middle'
          ? (box.h - height) / 2
          : shape.type === 'text'
            ? 0
            : 8)
  return (
    <text
      fill={color}
      fontSize={size}
      fontFamily={font}
      textAnchor={arrow ? 'middle' : align}
      dominantBaseline="hanging"
      style={{
        fontWeight: p.bold ? 'bold' : undefined,
        fontStyle: p.italic ? 'italic' : undefined,
        textDecoration: [
          p.underline ? 'underline' : '',
          p.strike ? 'line-through' : '',
        ]
          .filter(Boolean)
          .join(' '),
      }}
    >
      {lines.map((runs, i) => (
        <tspan key={i} x={x} y={y + i * size * 1.35}>
          {runs.length
            ? runs.map((run, j) => {
                const has = (type) => run.marks.some((m) => m.type === type),
                  link = run.marks.find((m) => m.type === 'link'),
                  style = {
                    fontWeight: has('bold') ? 'bold' : undefined,
                    fontStyle: has('italic') ? 'italic' : undefined,
                    textDecoration: [
                      has('underline') ? 'underline' : '',
                      has('strike') ? 'line-through' : '',
                    ]
                      .filter(Boolean)
                      .join(' '),
                    fontFamily: has('code') ? fontFamilies.mono : undefined,
                  }
                return link && safeLink(link.attrs?.href) ? (
                  <a
                    key={j}
                    href={safeLink(link.attrs.href)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <tspan style={style}>{run.text}</tspan>
                  </a>
                ) : (
                  <tspan key={j} style={style}>
                    {run.text}
                  </tspan>
                )
              })
            : ' '}
        </tspan>
      ))}
    </text>
  )
}
function ArrowHead({ point, angle, kind, size, color }) {
  if (kind === 'none') return null
  const r = size * 4,
    transform = `translate(${point.x} ${point.y}) rotate(${(angle * 180) / Math.PI})`
  if (kind === 'dot')
    return <circle cx={point.x} cy={point.y} r={size * 1.8} fill={color} />
  if (kind === 'pipe' || kind === 'bar')
    return (
      <path
        d={`M0 ${-r / 2} V${r / 2}`}
        transform={transform}
        fill="none"
        stroke={color}
        strokeWidth={size}
      />
    )
  if (kind === 'diamond')
    return (
      <path
        d={`M0 0 L${-r / 2} ${-r / 3} L${-r} 0 L${-r / 2} ${r / 3} Z`}
        transform={transform}
        fill={color}
      />
    )
  if (kind === 'inverted')
    return (
      <path
        d={`M${-r} 0 L0 ${-r * 0.4} L0 ${r * 0.4} Z`}
        transform={transform}
        fill={color}
      />
    )
  if (kind === 'square')
    return (
      <rect
        x={-r}
        y={-r / 2}
        width={r}
        height={r}
        transform={transform}
        fill={color}
      />
    )
  return (
    <path
      d={`M${-r} ${-r * 0.4} L0 0 L${-r} ${r * 0.4}${kind === 'triangle' ? ' Z' : ''}`}
      transform={transform}
      fill={kind === 'triangle' ? color : 'none'}
      stroke={color}
      strokeWidth={size}
      strokeLinejoin="round"
    />
  )
}
export default function ShapeContent({ editor, shape }) {
  const p = shape.props || {},
    b = localBounds(shape),
    color = shapeColor(shape),
    sw = strokeWidth(p),
    fill =
      p.fill === 'none' || !p.fill
        ? 'transparent'
        : p.fill === 'pattern'
          ? 'url(#hamoki-hatch)'
          : color,
    fillOpacity = p.fill === 'semi' ? 0.25 : 1,
    stroke = {
      stroke: color,
      strokeWidth: sw,
      strokeDasharray:
        p.dash === 'dashed'
          ? `${sw * 4} ${sw * 3}`
          : p.dash === 'dotted'
            ? `.1 ${sw * 2.5}`
            : undefined,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      filter: p.dash === 'draw' ? 'url(#hamoki-rough)' : undefined,
    }
  if (shape.type === 'group') return null
  if (shape.type === 'image') {
    const asset = editor.getAsset(p.assetId),
      src = safeImageSource(asset?.props?.src),
      tl = p.crop?.topLeft || { x: 0, y: 0 },
      br = p.crop?.bottomRight || { x: 1, y: 1 },
      w = asset?.props?.w || b.w,
      h = asset?.props?.h || b.h
    return src ? (
      <svg width={b.w} height={b.h} overflow="hidden">
        <g
          transform={
            p.flipX || p.flipY
              ? `translate(${p.flipX ? b.w : 0} ${p.flipY ? b.h : 0}) scale(${p.flipX ? -1 : 1} ${p.flipY ? -1 : 1})`
              : undefined
          }
        >
          <svg
            width={b.w}
            height={b.h}
            viewBox={`${tl.x * w} ${tl.y * h} ${Math.max(1, (br.x - tl.x) * w)} ${Math.max(1, (br.y - tl.y) * h)}`}
            preserveAspectRatio="none"
          >
            <image href={src} width={w} height={h} preserveAspectRatio="none" />
          </svg>
        </g>
      </svg>
    ) : (
      <>
        <rect width={b.w} height={b.h} fill="#402b2c" />
        <text x="12" y="28" fill="#ffb4ae">
          原图暂不可读取
        </text>
      </>
    )
  }
  if (shape.type === 'geo')
    return (
      <>
        <path
          d={geoPath(p.geo, b.w, b.h)}
          fill={fill}
          fillOpacity={fillOpacity}
          {...stroke}
        />
        {p.geo === 'x-box' && (
          <path
            d={`M0 0 L${b.w} ${b.h} M${b.w} 0 L0 ${b.h}`}
            fill="none"
            {...stroke}
          />
        )}
        {p.geo === 'check-box' && (
          <path
            d={`M${b.w * 0.2} ${b.h * 0.5} L${b.w * 0.4} ${b.h * 0.75} L${b.w * 0.85} ${b.h * 0.2}`}
            fill="none"
            {...stroke}
          />
        )}
        <TextLabel wrap={editor.preferences.wrap} shape={shape} box={b} />
      </>
    )
  if (shape.type === 'frame')
    return (
      <>
        <rect
          width={b.w}
          height={b.h}
          fill="#284938"
          fillOpacity={p.fill === 'none' ? 0.05 : 0.18}
          {...stroke}
          strokeDasharray={shape.meta?.cowartAiImageHolder ? '8 5' : undefined}
        />
        <text x="8" y="-9" fill={color} fontSize="13">
          {p.name || (shape.meta?.cowartAiImageHolder ? 'AI 图片' : '框架')}
        </text>
      </>
    )
  if (
    shape.type === 'draw' ||
    shape.type === 'highlight' ||
    shape.type === 'line'
  ) {
    const points = shape.type === 'line' ? linePoints(p) : strokePoints(p),
      width = shape.type === 'highlight' ? sw * 8 : sw
    return (
      <>
        {shape.type === 'draw' && p.isPen ? (
          <path d={pressureOutline(points, sw)} fill={color} />
        ) : (
          <path
            d={pathThrough(
              points,
              p.spline === 'cubic' || shape.type !== 'line',
            )}
            fill="none"
            {...stroke}
            strokeWidth={width}
            opacity={shape.type === 'highlight' ? 0.4 : 1}
          />
        )}
        <path
          d={pathThrough(points)}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(16, width)}
        />
      </>
    )
  }
  if (shape.type === 'arrow') {
    const g = arrowGeometry(p, editor.getArrowEndpoints(shape)),
      labelPosition = p.labelPosition ?? 0.5,
      label = labelPosition === 0 ? g.start : g.label
    return (
      <>
        <path d={g.d} fill="none" {...stroke} />
        <ArrowHead
          point={g.start}
          angle={g.startAngle + Math.PI}
          kind={p.arrowheadStart || 'none'}
          size={sw}
          color={color}
        />
        <ArrowHead
          point={g.end}
          angle={g.endAngle}
          kind={p.arrowheadEnd || 'arrow'}
          size={sw}
          color={color}
        />
        <path d={g.d} fill="none" stroke="transparent" strokeWidth="18" />
        <TextLabel
          wrap={editor.preferences.wrap}
          shape={shape}
          box={b}
          arrow={{ x: label.x, y: label.y - fontSize(p) - 8 }}
        />
      </>
    )
  }
  if (shape.type === 'text' || shape.type === 'note')
    return (
      <>
        {shape.type === 'note' ? (
          <rect
            width={b.w}
            height={b.h}
            rx="3"
            fill={color}
            fillOpacity=".18"
            stroke={color}
            strokeOpacity=".3"
          />
        ) : (
          <rect width={b.w} height={b.h} fill="transparent" />
        )}
        <TextLabel wrap={editor.preferences.wrap} shape={shape} box={b} />
      </>
    )
  if (shape.type === 'bookmark' || shape.type === 'embed')
    return (
      <>
        <rect width={b.w} height={b.h} rx="8" fill="#172b22" stroke={color} />
        <text x="12" y="30" fill={color} fontSize="16">
          {String(p.title || p.url || '链接').slice(
            0,
            Math.max(5, Math.floor(b.w / 9) - 3),
          )}
        </text>
        <text x="12" y="55" fill="#a2b6ab" fontSize="12">
          {String(p.url || '').slice(0, Math.max(5, Math.floor(b.w / 7) - 3))}
        </text>
        {shape.type === 'embed' &&
          editor.activeEmbed === shape.id &&
          safeLink(p.url)?.startsWith('https://') && (
            <foreignObject
              width={b.w}
              height={b.h}
              data-embed-interactive="true"
            >
              <iframe
                xmlns="http://www.w3.org/1999/xhtml"
                src={safeLink(p.url)}
                title={p.title || '嵌入内容'}
                sandbox="allow-scripts allow-forms allow-presentation"
                referrerPolicy="no-referrer"
                style={{
                  width: '100%',
                  height: '100%',
                  border: 0,
                  background: '#fff',
                }}
              />
            </foreignObject>
          )}
      </>
    )
  return (
    <>
      <rect
        width={b.w}
        height={b.h}
        fill="#403a28"
        fillOpacity=".4"
        stroke="#cfbc79"
        strokeDasharray="5 5"
      />
      <text x="10" y="25" fill="#e8d797" fontSize="13">
        旧元素 · {String(shape.type)}（保留）
      </text>
    </>
  )
}

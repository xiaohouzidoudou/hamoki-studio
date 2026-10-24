// A deliberately small rich-text interchange layer: data is parsed as records,
// never interpolated into HTML. Unknown source fields stay in the document until
// the user explicitly edits the corresponding text.
export function safeLink(value) {
  try {
    const u = new URL(value)
    return ['https:', 'http:', 'mailto:'].includes(u.protocol) ? u.href : null
  } catch {
    return null
  }
}
export function richBlocks(doc) {
  const blocks = []
  function walk(node, marks = [], depth = 0, prefix = '') {
    if (!node || depth > 24) return
    if (node.type === 'text')
      return [
        {
          text: String(node.text || ''),
          marks: [...marks, ...(node.marks || [])],
        },
      ]
    if (node.type === 'hardBreak') return [{ text: '\n', marks }]
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      ;(node.content || []).forEach((item, i) =>
        walk(
          item,
          marks,
          depth + 1,
          node.type === 'bulletList'
            ? '• '
            : `${(node.attrs?.start || 1) + i}. `,
        ),
      )
      return
    }
    if (node.type === 'paragraph' || node.type === 'heading') {
      const runs = (node.content || []).flatMap(
        (n) => walk(n, marks, depth + 1) || [],
      )
      if (prefix) runs.unshift({ text: prefix, marks: [] })
      blocks.push(runs)
      return
    }
    for (const child of node.content || [])
      walk(child, marks, depth + 1, prefix)
  }
  walk(doc)
  return blocks.length ? blocks : [[]]
}
export function richToDOM(doc, root) {
  root.replaceChildren()
  for (const runs of richBlocks(doc)) {
    const p = document.createElement('div')
    for (const run of runs) {
      let el = document.createTextNode(run.text)
      for (const mark of run.marks) {
        const tag =
          {
            bold: 'strong',
            italic: 'em',
            underline: 'u',
            strike: 's',
            code: 'code',
          }[mark.type] ||
          (mark.type === 'link' && safeLink(mark.attrs?.href) ? 'a' : null)
        if (!tag) continue
        const span = document.createElement(tag)
        if (tag === 'a') span.href = safeLink(mark.attrs.href)
        span.append(el)
        el = span
      }
      p.append(el)
    }
    if (!runs.length) p.append(document.createElement('br'))
    root.append(p)
  }
}
export function domToRich(root) {
  const content = []
  function read(node, marks = [], depth = 0) {
    if (depth > 24) return []
    if (node.nodeType === 3)
      return node.textContent
        ? [
            {
              type: 'text',
              text: node.textContent,
              ...(marks.length ? { marks } : {}),
            },
          ]
        : []
    if (node.nodeType !== 1) return []
    const mark = {
      B: 'bold',
      STRONG: 'bold',
      I: 'italic',
      EM: 'italic',
      U: 'underline',
      S: 'strike',
      STRIKE: 'strike',
      CODE: 'code',
    }[node.tagName]
    let next = mark ? [...marks, { type: mark }] : marks
    if (node.tagName === 'A' && safeLink(node.getAttribute('href')))
      next = [
        ...next,
        { type: 'link', attrs: { href: safeLink(node.getAttribute('href')) } },
      ]
    if (node.tagName === 'BR') return [{ type: 'hardBreak' }]
    return [...node.childNodes].flatMap((child) => read(child, next, depth + 1))
  }
  let inline = []
  const flush = () => {
    if (inline.length) {
      content.push({ type: 'paragraph', content: inline })
      inline = []
    }
  }
  for (const child of root.childNodes) {
    if (['DIV', 'P', 'H1', 'H2', 'H3', 'LI'].includes(child.tagName)) {
      flush()
      content.push({ type: 'paragraph', content: read(child) })
    } else if (child.tagName === 'UL' || child.tagName === 'OL') {
      flush()
      content.push({
        type: child.tagName === 'UL' ? 'bulletList' : 'orderedList',
        content: [...child.children].map((li) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: read(li) }],
        })),
      })
    } else inline.push(...read(child))
  }
  flush()
  return {
    type: 'doc',
    content: content.length ? content : [{ type: 'paragraph', content: [] }],
  }
}
let measureContext
export function layoutRich(doc, width, font, wrap = true) {
  if (typeof document !== 'undefined')
    measureContext ||= document.createElement('canvas').getContext('2d')
  if (measureContext) measureContext.font = font
  const measure = (text) =>
    measureContext
      ? measureContext.measureText(text).width
      : [...text].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 20 : 11), 0)
  const lines = []
  for (const block of richBlocks(doc)) {
    let runs = [],
      used = 0
    const flush = () => {
      lines.push(runs)
      runs = []
      used = 0
    }
    for (const run of block) {
      let chunk = ''
      for (const c of [...run.text]) {
        const w = measure(c)
        if (c === '\n' || (wrap && used + w > Math.max(20, width))) {
          if (chunk) runs.push({ ...run, text: chunk })
          chunk = ''
          flush()
          if (c === '\n') continue
        }
        chunk += c
        used += w
      }
      if (chunk) runs.push({ ...run, text: chunk })
    }
    flush()
  }
  return lines
}
export function richWidth(doc, font) {
  if (typeof document !== 'undefined')
    measureContext ||= document.createElement('canvas').getContext('2d')
  if (measureContext) measureContext.font = font
  return Math.max(
    1,
    ...richBlocks(doc).map((runs) => {
      const text = runs.map((r) => r.text).join('')
      return measureContext
        ? measureContext.measureText(text).width
        : [...text].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 20 : 11), 0)
    }),
  )
}

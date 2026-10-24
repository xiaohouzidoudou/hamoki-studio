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
  const build = (node, depth = 0) => {
    if (!node || depth > 24) return document.createTextNode('')
    if (node.type === 'text') {
      let el = document.createTextNode(String(node.text || ''))
      for (const mark of node.marks || []) {
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
        const wrapper = document.createElement(tag)
        if (tag === 'a') wrapper.href = safeLink(mark.attrs.href)
        wrapper.append(el)
        el = wrapper
      }
      return el
    }
    if (node.type === 'hardBreak') return document.createElement('br')
    const tag =
        {
          bulletList: 'ul',
          orderedList: 'ol',
          listItem: 'li',
          paragraph: 'div',
          heading: 'div',
        }[node.type] || 'div',
      el = document.createElement(tag)
    if (node.type === 'orderedList' && Number.isInteger(node.attrs?.start))
      el.start = node.attrs.start
    for (const child of node.content || []) el.append(build(child, depth + 1))
    if (!el.childNodes.length) el.append(document.createElement('br'))
    return el
  }
  root.replaceChildren(...(doc?.content || []).map((node) => build(node)))
  if (!root.childNodes.length) root.append(document.createElement('br'))
}
export function domToRich(root) {
  const read = (node, marks = [], depth = 0) => {
    if (depth > 24) return []
    if (node.nodeType === 3) {
      const text = node.textContent.replace(/\u200b/g, '')
      return text
        ? [{ type: 'text', text, ...(marks.length ? { marks } : {}) }]
        : []
    }
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
      }[node.tagName],
      next = [...marks]
    if (mark) next.push({ type: mark })
    if (
      node.style?.fontWeight === 'bold' ||
      Number(node.style?.fontWeight) >= 600
    )
      next.push({ type: 'bold' })
    if (node.style?.fontStyle === 'italic') next.push({ type: 'italic' })
    if (node.style?.textDecoration?.includes('underline'))
      next.push({ type: 'underline' })
    if (node.style?.textDecoration?.includes('line-through'))
      next.push({ type: 'strike' })
    if (node.tagName === 'A' && safeLink(node.getAttribute('href')))
      next.push({
        type: 'link',
        attrs: { href: safeLink(node.getAttribute('href')) },
      })
    if (node.tagName === 'BR') return [{ type: 'hardBreak' }]
    return [...node.childNodes].flatMap((child) => read(child, next, depth + 1))
  }
  const blocks = (container, depth = 0) => {
    if (depth > 24) return []
    const content = []
    let inline = []
    const flush = () => {
      if (inline.length) {
        content.push({ type: 'paragraph', content: inline })
        inline = []
      }
    }
    for (const child of container.childNodes) {
      if (child.tagName === 'UL' || child.tagName === 'OL') {
        flush()
        content.push({
          type: child.tagName === 'UL' ? 'bulletList' : 'orderedList',
          ...(child.tagName === 'OL'
            ? { attrs: { start: Number(child.getAttribute('start')) || 1 } }
            : {}),
          content: [...child.children]
            .filter((el) => el.tagName === 'LI')
            .map((li) => ({
              type: 'listItem',
              content: blocks(li, depth + 1),
            })),
        })
      } else if (
        ['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'LI'].includes(child.tagName)
      ) {
        flush()
        if (
          [...child.children].some((el) =>
            ['DIV', 'P', 'UL', 'OL'].includes(el.tagName),
          )
        )
          content.push(...blocks(child, depth + 1))
        else content.push({ type: 'paragraph', content: read(child) })
      } else inline.push(...read(child))
    }
    flush()
    return content.length ? content : [{ type: 'paragraph', content: [] }]
  }
  return { type: 'doc', content: blocks(root) }
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

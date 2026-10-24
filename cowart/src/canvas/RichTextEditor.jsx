import { useEffect, useRef, useImperativeHandle } from 'react'
import { richToDOM, domToRich, safeLink } from './richText.js'
export default function RichTextEditor({
  shape,
  style,
  onCommit,
  onCancel,
  ref,
}) {
  const root = useRef(null),
    dirty = useRef(false),
    committed = useRef(false)
  useEffect(() => {
    richToDOM(
      shape.props.richText || {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: shape.props.text || '' }],
          },
        ],
      },
      root.current,
    )
    root.current.focus()
    const selection = getSelection(),
      range = document.createRange()
    range.selectNodeContents(root.current)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [shape.id])
  useImperativeHandle(ref, () => ({ commit }))
  function commit() {
    if (committed.current) return
    committed.current = true
    onCommit(dirty.current ? domToRich(root.current) : shape.props.richText)
  }
  function format(tag, attrs = {}) {
    const selection = getSelection()
    if (!selection?.rangeCount) return
    const range = selection.getRangeAt(0)
    if (!root.current.contains(range.commonAncestorContainer)) return
    if (range.collapsed) return
    const el = document.createElement(tag)
    for (const [key, value] of Object.entries(attrs))
      el.setAttribute(key, value)
    el.append(range.extractContents())
    range.insertNode(el)
    selection.removeAllRanges()
    const selected = document.createRange()
    selected.selectNodeContents(el)
    selection.addRange(selected)
    dirty.current = true
    root.current.focus()
  }
  return (
    <div
      className="hamoki-rich-editor"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="hamoki-rich-toolbar"
        role="toolbar"
        aria-label="文字格式"
        onMouseDown={(e) => e.preventDefault()}
      >
        {[
          ['strong', '粗体'],
          ['em', '斜体'],
          ['u', '下划线'],
          ['s', '删除线'],
          ['code', '代码'],
        ].map(([tag, label]) => (
          <button
            key={tag}
            title={label}
            aria-label={'文字' + label}
            onClick={() => format(tag)}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => {
            const url = prompt('链接地址（https://…）')
            if (url && safeLink(url)) format('a', { href: safeLink(url) })
          }}
        >
          链接
        </button>
        <button
          onClick={() => {
            const selection = getSelection()
            if (!selection?.rangeCount) return
            const range = selection.getRangeAt(0)
            if (!root.current.contains(range.commonAncestorContainer)) return
            const ul = document.createElement('ul'),
              li = document.createElement('li')
            li.append(range.extractContents())
            ul.append(li)
            range.insertNode(ul)
            dirty.current = true
          }}
        >
          列表
        </button>
        <button onClick={commit}>完成</button>
      </div>
      <div
        ref={root}
        role="textbox"
        aria-label="编辑标注文字"
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        className="hamoki-text-editor"
        onInput={() => {
          dirty.current = true
        }}
        onPaste={(e) => {
          e.preventDefault()
          const value = e.clipboardData.getData('text/plain')
          const selection = getSelection()
          if (selection?.rangeCount) {
            const range = selection.getRangeAt(0)
            range.deleteContents()
            const text = document.createTextNode(value.slice(0, 10000))
            range.insertNode(text)
            range.setStartAfter(text)
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
            dirty.current = true
          }
        }}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement.contains(e.relatedTarget)) commit()
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            committed.current = true
            onCancel()
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            commit()
          }
        }}
      />
    </div>
  )
}

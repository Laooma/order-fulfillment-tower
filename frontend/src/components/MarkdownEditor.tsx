import { useState, useRef, useCallback, useEffect } from 'react'
import Prism from 'prismjs'
import 'prismjs/components/prism-markdown'
import 'prismjs/themes/prism.css'
import { marked } from 'marked'

marked.setOptions({ breaks: true, gfm: true })

export default function MarkdownEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [leftWidth, setLeftWidth] = useState(50) // percentage
  const dragging = useRef(false)

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current
    if (ta) {
      setScrollTop(ta.scrollTop)
      setScrollLeft(ta.scrollLeft)
    }
  }, [])

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value)
      syncScroll()
    },
    [onChange, syncScroll],
  )

  useEffect(() => {
    const hl = highlightRef.current
    if (hl) {
      hl.scrollTop = scrollTop
      hl.scrollLeft = scrollLeft
    }
  }, [scrollTop, scrollLeft, value])

  // Draggable splitter
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setLeftWidth(Math.max(15, Math.min(85, pct)))
    }
    const handleMouseUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const onSplitterDown = () => {
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const highlighted = Prism.highlight(value, Prism.languages.markdown, 'markdown')

  const previewHtml = (() => {
    try {
      const content = value.replace(/^---[\s\S]*?---\s*\n?/, '')
      return marked.parse(content) as string
    } catch {
      return value
    }
  })()

  return (
    <div className="skill-editor-panes" ref={containerRef}>
      <div className="skill-editor-pane" style={{ width: `${leftWidth}%`, flex: 'none' }}>
        <div className="skill-editor-pane-header">编辑</div>
        <div className="md-editor-wrap">
          <pre
            ref={highlightRef}
            className="md-editor-highlight language-markdown"
            aria-hidden="true"
          >
            <code dangerouslySetInnerHTML={{ __html: highlighted + '\n' }} />
          </pre>
          <textarea
            ref={textareaRef}
            className="md-editor-textarea"
            value={value}
            onChange={handleInput}
            onScroll={syncScroll}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
      </div>
      <div className="pane-splitter" onMouseDown={onSplitterDown} />
      <div className="skill-editor-pane" style={{ flex: 1 }}>
        <div className="skill-editor-pane-header">预览</div>
        <div
          className="md-preview"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </div>
    </div>
  )
}

import { useRef, useCallback, useEffect, useState } from 'react'
import Prism from 'prismjs'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-javascript'

const LANG_MAP: Record<string, string> = {
  bash: 'bash',
  python: 'python',
  js: 'javascript',
}

const LANG_LABEL: Record<string, string> = {
  bash: 'Bash',
  python: 'Python',
  js: 'JavaScript',
}

export default function ScriptEditor({
  value,
  onChange,
  language,
  minHeight,
}: {
  value: string
  onChange: (v: string) => void
  language: 'bash' | 'python' | 'js'
  minHeight?: string
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)

  const prismLang = LANG_MAP[language] || 'bash'

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

  const highlighted = (() => {
    try {
      return Prism.highlight(value, Prism.languages[prismLang], prismLang)
    } catch {
      return value
    }
  })()

  // Basic syntax check via Prism tokenization
  const syntaxOk = (() => {
    if (!value.trim()) return true
    try {
      Prism.tokenize(value, Prism.languages[prismLang])
      return true
    } catch {
      return false
    }
  })()

  return (
    <div className="script-editor-wrap" style={{ minHeight: minHeight || '320px' }}>
      <div className="script-editor-header">
        <span className="script-editor-lang">{LANG_LABEL[language] || language}</span>
        {!syntaxOk && (
          <span className="script-editor-warning">语法可能有误，请检查</span>
        )}
      </div>
      <div className="script-editor-body">
        <pre ref={highlightRef} className="script-editor-highlight" aria-hidden="true">
          <code dangerouslySetInnerHTML={{ __html: highlighted + '\n' }} />
        </pre>
        <textarea
          ref={textareaRef}
          className="script-editor-textarea"
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
  )
}

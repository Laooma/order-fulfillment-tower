import { useMemo } from 'react'
import { marked } from 'marked'
import Prism from 'prismjs'

// Language plugins for syntax highlighting in code blocks
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-yaml'
import 'prismjs/themes/prism-tomorrow.css'

// Normalize language identifiers to Prism language names
const LANG_ALIAS: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  yml: 'yaml',
}

marked.setOptions({
  breaks: true,
  gfm: true,
  highlight(code: string, lang: string) {
    const prismLang = LANG_ALIAS[lang] || lang
    if (Prism.languages[prismLang]) {
      try {
        return Prism.highlight(code, Prism.languages[prismLang], prismLang)
      } catch {
        return code
      }
    }
    return code
  },
})

export default function MarkdownRenderer({ content }: { content: string }) {
  const html = useMemo(() => {
    if (!content) return ''
    try {
      return marked.parse(content) as string
    } catch {
      return content
    }
  }, [content])

  return (
    <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
  )
}

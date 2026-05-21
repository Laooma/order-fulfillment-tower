import { A2uiRenderer } from '../components/A2uiRenderer'
import { useA2uiStore } from '../stores/a2uiStore'

export default function A2uiPage() {
  const { title, messages } = useA2uiStore()

  return (
    <div className="a2ui-page">
      <div className="a2ui-page-header">
        <span>{title || 'AI分析结果'}</span>
      </div>
      <div className="a2ui-page-body">
        <A2uiRenderer messages={messages} />
      </div>
    </div>
  )
}

import { A2uiRenderer } from '../components/A2uiRenderer'
import { useA2uiStore } from '../stores/a2uiStore'

export default function A2uiPage() {
  const { title, messages } = useA2uiStore()

  const handleAction = (action: { name: string; context?: Record<string, unknown> }) => {
    console.log('[A2UI Action]', action.name, action.context)
    // TODO: wire to real action handling (e.g. refresh data, navigate, etc.)
  }

  return (
    <div className="a2ui-page">
      <div className="a2ui-page-header">
        <span>{title || 'AI分析结果'}</span>
      </div>
      <div className="a2ui-page-body">
        <A2uiRenderer messages={messages} onAction={handleAction} />
      </div>
    </div>
  )
}

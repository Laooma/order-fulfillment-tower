interface SubNavItem {
  key: string
  label: string
  count?: number
  hidden?: boolean
}

interface SubNavProps {
  items: SubNavItem[]
  activeKey: string
  onChange: (key: string) => void
  onTabDragStart?: (key: string) => void
}

export default function SubNav({ items, activeKey, onChange, onTabDragStart }: SubNavProps) {
  const visibleItems = items.filter((item) => !item.hidden)
  return (
    <div className="sub-nav">
      {visibleItems.map((item) => (
        <button
          key={item.key}
          onClick={() => onChange(item.key)}
          draggable={!!onTabDragStart}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', item.key)
            onTabDragStart?.(item.key)
          }}
          className={`sub-nav-tab ${activeKey === item.key ? 'active' : ''}`}
        >
          <span style={{ pointerEvents: 'none' }}>{item.label}</span>
          {item.count != null && (
            <span className="sub-nav-count">
              {item.count}
            </span>
          )}
        </button>
      ))}
      <div className="sub-nav-spacer" />
    </div>
  )
}

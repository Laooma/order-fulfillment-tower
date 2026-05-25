import React, { useMemo } from 'react'

// A2UI v0.9 Message types
interface A2uiCreateSurface {
  surfaceId: string
  catalogId: string
}

interface A2uiUpdateComponents {
  surfaceId: string
  components: A2uiComponent[]
}

interface A2uiUpdateDataModel {
  surfaceId: string
  path?: string
  value: unknown
}

interface A2uiMessageBase {
  version?: string
  createSurface?: A2uiCreateSurface
  updateComponents?: A2uiUpdateComponents
  updateDataModel?: A2uiUpdateDataModel
  deleteSurface?: { surfaceId: string }
}

// Dynamic value types — can be literal, data binding path, or function call
type DynamicValue<T> = T | { path: string } | { call: string; args: Record<string, unknown>; returnType: string }

// Component definition
interface A2uiComponent {
  id: string
  component: string
  // Layout
  children?: string[] | { componentId: string; path: string }
  child?: string
  // Content
  text?: DynamicValue<string>
  url?: DynamicValue<string>
  name?: DynamicValue<string>
  variant?: string
  fit?: string
  description?: DynamicValue<string>
  // Styling
  align?: string
  justify?: string
  gap?: number
  padding?: number
  // Actions
  action?: { name: string; context?: Record<string, unknown> }
  // Layout children: use DynamicStringList
  [key: string]: unknown
}

// Surface state
interface SurfaceState {
  components: Map<string, A2uiComponent>
  dataModel: Record<string, unknown>
}

interface A2uiRendererProps {
  messages: A2uiMessageBase[]
  onAction?: (action: { name: string; context?: Record<string, unknown> }) => void
}

// Resolve a dynamic value against the data model
function resolveValue<T>(dv: DynamicValue<T> | undefined, dataModel: Record<string, unknown>): T | undefined {
  if (dv === undefined || dv === null) return undefined
  if (typeof dv === 'object' && dv !== null && !Array.isArray(dv)) {
    if ('path' in dv && typeof dv.path === 'string') {
      return getByPath(dataModel, dv.path) as T
    }
    if ('call' in dv && typeof dv.call === 'string') {
      // Simple function support — only formatString-like
      if (dv.call === 'formatString' && dv.args) {
        const template = String(resolveValue(dv.args.template as DynamicValue<string>, dataModel) || '')
        // Simple template replacement: ${/path} → value at path
        return template.replace(/\$\{([^}]+)\}/g, (_, path: string) => {
          return String(getByPath(dataModel, path) ?? '')
        }) as unknown as T
      }
      return dv as unknown as T
    }
    return dv as unknown as T
  }
  return dv as unknown as T
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  if (path === '/' || path === '') return obj
  const parts = path.replace(/^\//, '').split('/')
  let current: unknown = obj
  for (const part of parts) {
    if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[part]
    } else return undefined
  }
  return current
}

// Process A2UI messages into a surface state
function processMessages(messages: A2uiMessageBase[]): Map<string, SurfaceState> {
  const surfaces = new Map<string, SurfaceState>()

  for (const msg of messages) {
    if (msg.createSurface) {
      const { surfaceId } = msg.createSurface
      if (!surfaces.has(surfaceId)) {
        surfaces.set(surfaceId, { components: new Map(), dataModel: {} })
      }
    }

    if (msg.updateComponents) {
      const { surfaceId, components } = msg.updateComponents
      let surface = surfaces.get(surfaceId)
      if (!surface) {
        surface = { components: new Map(), dataModel: {} }
        surfaces.set(surfaceId, surface)
      }
      for (const comp of components) {
        surface.components.set(comp.id, comp)
      }
    }

    if (msg.updateDataModel) {
      const { surfaceId, path, value } = msg.updateDataModel
      let surface = surfaces.get(surfaceId)
      if (!surface) {
        surface = { components: new Map(), dataModel: {} }
        surfaces.set(surfaceId, surface)
      }
      if (!path || path === '/') {
        surface.dataModel = value as Record<string, unknown>
      } else {
        setByPath(surface.dataModel, path, value)
      }
    }

    if (msg.deleteSurface) {
      surfaces.delete(msg.deleteSurface.surfaceId)
    }
  }

  return surfaces
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.replace(/^\//, '').split('/')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {}
    current = current[parts[i]] as Record<string, unknown>
  }
  if (value === undefined) {
    delete current[parts[parts.length - 1]]
  } else {
    current[parts[parts.length - 1]] = value
  }
}

// Icon mapping: A2UI icon name → SVG path
const iconMap: Record<string, React.ReactNode> = {
  trending_up: <path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6h-6z" />,
  arrow_upward: <path d="M13 19V7.83l4.88 5.07 1.42-1.41L12 4.16l-7.3 7.33 1.42 1.41L11 7.83V19h2z" />,
  send: <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2 .01 7z" />,
  check: <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />,
  close: <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />,
  warning: <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />,
  info: <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />,
  error: <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />,
  calendarToday: <><path d="M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V10h16v11zm0-13H4V5h16v3z" /></>,
  person: <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />,
  star: <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27z" />,
  settings: <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />,
  search: <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />,
  folder: <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />,
  download: <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />,
  upload: <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z" />,
  edit: <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />,
  delete: <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />,
  home: <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />,
  menu: <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />,
  moreVert: <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />,
  mail: <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />,
  phone: <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />,
  add: <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />,
  lock: <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z" />,
  visibility: <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />,
  event: <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z" />,
  shoppingCart: <path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z" />,
  share: <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" />,
}

// --- Component Renderers ---

function IconView({ name }: { name: string }) {
  const svgContent = iconMap[name] || iconMap.info
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
      {svgContent || <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />}
    </svg>
  )
}

function TextView({ text, variant, color }: { text: string; variant?: string; color?: string }) {
  const style: React.CSSProperties = { color: color || undefined }
  switch (variant) {
    case 'h1': return <h1 style={{ ...style, fontSize: 28, fontWeight: 700, margin: '4px 0', lineHeight: 1.3 }}>{text}</h1>
    case 'h2': return <h2 style={{ ...style, fontSize: 22, fontWeight: 700, margin: '4px 0', lineHeight: 1.3 }}>{text}</h2>
    case 'h3': return <h3 style={{ ...style, fontSize: 18, fontWeight: 600, margin: '2px 0', lineHeight: 1.3 }}>{text}</h3>
    case 'h4': return <h4 style={{ ...style, fontSize: 16, fontWeight: 600, margin: '2px 0' }}>{text}</h4>
    case 'h5': return <h5 style={{ ...style, fontSize: 14, fontWeight: 600, margin: '2px 0' }}>{text}</h5>
    case 'caption': return <span style={{ ...style, fontSize: 12, color: color || 'var(--color-muted)', letterSpacing: '0.03em' }}>{text}</span>
    case 'body':
    default: return <span style={{ ...style, fontSize: 14, lineHeight: 1.5 }}>{text}</span>
  }
}

function ButtonView({ text, variant, action: _action }: { text: string; variant?: string; action?: { name: string; context?: Record<string, unknown> } }) {
  const isPrimary = variant === 'primary'
  const isDanger = variant === 'danger'
  return (
    <button
      style={{
        padding: '6px 16px',
        borderRadius: 6,
        border: isPrimary ? 'none' : '1px solid var(--color-border)',
        background: isPrimary ? 'var(--color-primary)' : isDanger ? 'var(--color-danger, #e53e3e)' : 'transparent',
        color: isPrimary || isDanger ? '#fff' : 'var(--color-text)',
        fontSize: 14,
        fontWeight: 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </button>
  )
}

const SUPPORTED_COMPONENTS = new Set([
  'Text', 'Image', 'Icon', 'Video', 'AudioPlayer',
  'Row', 'Column', 'Card', 'Divider', 'Button',
  'List', 'Modal', 'CheckBox', 'TextField', 'Slider',
  'Tag', 'ProgressBar', 'Table', 'Chart',
  // Lowercase aliases — LLM often outputs these
  'text', 'row', 'column', 'card', 'divider', 'button',
  'list', 'tag', 'table', 'chart', 'image', 'icon',
])

// Recursive component renderer
function ComponentRenderer({
  compId,
  surface,
  onAction,
}: {
  compId: string
  surface: SurfaceState
  onAction?: (action: { name: string; context?: Record<string, unknown> }) => void
}) {
  const comp = surface.components.get(compId)
  if (!comp) {
    return null
  }

  if (!SUPPORTED_COMPONENTS.has(comp.component)) {
    return <div style={{ color: 'orange', padding: 4 }}>[Unknown: {comp.component}]</div>
  }

  const dm = surface.dataModel
  const resolve = <T,>(dv: DynamicValue<T> | undefined) => resolveValue(dv, dm)

  // Layout helpers
  const layoutStyle: React.CSSProperties = {}
  if (comp.justify) {
    if (comp.justify === 'spaceBetween') layoutStyle.justifyContent = 'space-between'
    else if (comp.justify === 'center') layoutStyle.justifyContent = 'center'
    else if (comp.justify === 'end' || comp.justify === 'flexEnd') layoutStyle.justifyContent = 'flex-end'
    else if (comp.justify === 'start' || comp.justify === 'flexStart') layoutStyle.justifyContent = 'flex-start'
  }
  if (comp.align) {
    if (comp.align === 'center') layoutStyle.alignItems = 'center'
    else if (comp.align === 'end') layoutStyle.alignItems = 'flex-end'
    else if (comp.align === 'start') layoutStyle.alignItems = 'flex-start'
    else if (comp.align === 'stretch') layoutStyle.alignItems = 'stretch'
  }
  if (typeof comp.gap === 'number') layoutStyle.gap = comp.gap
  if (typeof comp.padding === 'number') layoutStyle.padding = comp.padding

  // Render children array
  const renderChildren = (children: string[]) => (
    children.map(childId => (
      <ComponentRenderer key={childId} compId={childId} surface={surface} onAction={onAction} />
    ))
  )

  switch (comp.component) {
    case 'Text': {
      const text = resolve<string>(comp.text) ?? ''
      const variant = resolve<string>(comp.variant as DynamicValue<string>)
      return <TextView text={String(text)} variant={variant} />
    }

    case 'Icon': {
      const name = resolve<string>(comp.name) ?? ''
      return <IconView name={String(name)} />
    }

    case 'Image': {
      const url = resolve<string>(comp.url) ?? ''
      const desc = resolve<string>(comp.description)
      const fit = comp.fit || 'cover'
      return (
        <img
          src={String(url)}
          alt={String(desc || '')}
          style={{ width: '100%', objectFit: fit as 'cover' | 'contain' | 'fill' | 'none' | 'scale-down' }}
        />
      )
    }

    case 'Button': {
      const text = resolve<string>(comp.text) ?? ''
      const variant = comp.variant as string
      const action = comp.action
      return <ButtonView text={String(text)} variant={variant} action={action} />
    }

    case 'Divider':
      return <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', width: '100%', margin: '4px 0' }} />

    case 'Row': {
      const children = comp.children as string[] | undefined
      return (
        <div style={{ display: 'flex', flexDirection: 'row', ...layoutStyle, flexWrap: 'wrap' }}>
          {children ? renderChildren(children) : null}
        </div>
      )
    }

    case 'Column': {
      const children = comp.children as string[] | undefined
      return (
        <div style={{ display: 'flex', flexDirection: 'column', ...layoutStyle }}>
          {children ? renderChildren(children) : null}
        </div>
      )
    }

    case 'Card': {
      const child = comp.child as string | undefined
      const children = comp.children as string[] | undefined
      return (
        <div style={{
          background: 'var(--color-surface, #fff)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          padding: comp.padding || 16,
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}>
          {child ? <ComponentRenderer compId={child} surface={surface} onAction={onAction} /> : null}
          {!child && children ? renderChildren(children) : null}
        </div>
      )
    }

    case 'List': {
      // Children can be array of IDs or template with data binding
      const children = comp.children
      if (Array.isArray(children)) {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', ...layoutStyle }}>
            {renderChildren(children)}
          </div>
        )
      }
      // Template-based children: { componentId: "...", path: "..." }
      if (children && typeof children === 'object' && 'componentId' in children && 'path' in children) {
        const { componentId, path } = children as { componentId: string; path: string }
        const data = getByPath(dm, path) as unknown[]
        if (!Array.isArray(data)) return null
        return (
          <div style={{ display: 'flex', flexDirection: 'column', ...layoutStyle }}>
            {data.map((_, i) => (
              <ComponentRenderer
                key={`${componentId}-${i}`}
                compId={componentId}
                surface={surface}
                onAction={onAction}
              />
            ))}
          </div>
        )
      }
      return null
    }

    case 'TextField': {
      const label = resolve<string>(comp.text as DynamicValue<string>) ?? ''
      const value = resolve<string>(comp.value as DynamicValue<string>) ?? ''
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {label ? <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>{String(label)}</span> : null}
          <input
            type="text"
            value={String(value)}
            readOnly
            style={{
              padding: '8px 12px',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              fontSize: 14,
              background: 'var(--color-bg)',
            }}
          />
        </div>
      )
    }

    case 'CheckBox': {
      const label = resolve<string>(comp.text as DynamicValue<string>) ?? ''
      const checked = resolve<boolean>(comp.checked as DynamicValue<boolean>) ?? false
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={checked} readOnly />
          {String(label)}
        </label>
      )
    }

    // Custom extensions beyond basic catalog
    case 'Tag': {
      const text = resolve<string>(comp.text) ?? ''
      const color = (comp.color as string) || 'var(--color-primary)'
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '2px 10px',
          borderRadius: 99,
          fontSize: 12,
          fontWeight: 500,
          background: `${color}15`,
          color,
          border: `1px solid ${color}30`,
        }}>
          {String(text)}
        </span>
      )
    }

    case 'ProgressBar': {
      const value = Number(resolve<number>(comp.value as DynamicValue<number>) ?? 0)
      const max = Number(comp.max || 100)
      const label = resolve<string>(comp.text as DynamicValue<string>)
      const pct = Math.min(100, Math.max(0, (value / max) * 100))
      return (
        <div style={{ width: '100%' }}>
          {(label || typeof comp.value === 'number') && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12, color: 'var(--color-muted)' }}>
              {label ? <span>{String(label)}</span> : <span />}
              <span>{pct.toFixed(0)}%</span>
            </div>
          )}
          <div style={{ width: '100%', height: 8, borderRadius: 4, background: 'var(--color-neutral-bg)', overflow: 'hidden' }}>
            <div style={{
              width: `${pct}%`,
              height: '100%',
              borderRadius: 4,
              background: comp.color as string || 'var(--color-primary)',
              transition: 'width 0.3s',
            }} />
          </div>
        </div>
      )
    }

    case 'Table': {
      const columns = comp.columns as Array<{ key: string; label: string; width?: string; align?: string }> | undefined
      const rowsRaw = (comp.rows as DynamicValue<Record<string, unknown>[]>) || (comp.path as string)
      const rowsStr = typeof rowsRaw === 'string' ? rowsRaw : (rowsRaw && typeof rowsRaw === 'object' && 'path' in rowsRaw ? String((rowsRaw as any).path) : '')
      const data = Array.isArray(rowsRaw) ? rowsRaw : getByPath(dm, rowsStr) as Record<string, unknown>[]

      if (!columns || !Array.isArray(data)) return null

      return (
        <div style={{ width: '100%', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                {columns.map(col => (
                  <th
                    key={col.key}
                    style={{
                      padding: '8px 12px',
                      textAlign: (col.align as 'left' | 'right' | 'center') || 'left',
                      fontWeight: 600,
                      color: 'var(--color-muted)',
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                      ...(col.width ? { width: col.width } : {}),
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--color-border)', background: i % 2 === 0 ? 'transparent' : 'var(--color-neutral-bg)' }}>
                  {columns!.map(col => (
                    <td
                      key={col.key}
                      style={{
                        padding: '8px 12px',
                        textAlign: (col.align as 'left' | 'right' | 'center') || 'left',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {String(row[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    case 'Chart': {
      const chartType = (comp.chartType as string) || 'bar'
      const xKey = comp.xKey as string || 'date'
      const yKeys = comp.yKeys as string[] || []
      const colors = (comp.colors as string[]) || ['#3b82f6', '#ef4444', '#10b981', '#f59e0b']
      const labels = (comp.labels as string[]) || yKeys
      const height = (comp.rows as any)?.height || (comp.height as number) || 280
      const rowsRaw = comp.rows
      const data = Array.isArray(rowsRaw)
        ? rowsRaw as Record<string, unknown>[]
        : getByPath(dm, typeof rowsRaw === 'string' ? rowsRaw : String((rowsRaw as any)?.path || ''))

      if (!Array.isArray(data) || data.length === 0 || yKeys.length === 0) return null

      const svgW = 700
      const svgH = height
      const pad = { top: 30, right: 20, bottom: 50, left: 55 }
      const chartW = svgW - pad.left - pad.right
      const chartH = svgH - pad.top - pad.bottom

      // Find Y range
      let yMax = 0
      let yMin = 0
      for (const row of data) {
        for (const yk of yKeys) {
          const v = Number(row[yk]) || 0
          if (v > yMax) yMax = v
          if (v < yMin) yMin = v
        }
      }
      if (yMax === 0) yMax = 10
      const yRange = yMax - yMin || 1
      const yTicks = 5

      // X axis labels (show every Nth to avoid crowding)
      const xStep = Math.max(1, Math.floor(data.length / 12))

      return (
        <div style={{ width: '100%', overflow: 'auto' }}>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
            {yKeys.map((yk, i) => (
              <span key={yk} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: colors[i] || '#888', flexShrink: 0 }} />
                {labels[i] || yk}
              </span>
            ))}
          </div>
          <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', maxWidth: svgW, height: svgH, fontFamily: 'sans-serif' }}>
            {/* Y axis gridlines + labels */}
            {Array.from({ length: yTicks + 1 }, (_, i) => {
              const y = pad.top + (chartH * i) / yTicks
              const val = yMax - (yRange * i) / yTicks
              return (
                <g key={`y-${i}`}>
                  <line x1={pad.left} y1={y} x2={pad.left + chartW} y2={y} stroke="#e5e7eb" strokeWidth="1" />
                  <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#6b7280">{Math.round(val)}</text>
                </g>
              )
            })}

            {/* Bars, Lines, or Mixed */}
            {chartType === 'bar' || chartType === 'mixed' ? (
              // Bar layer: all yKeys for bar type, first yKey only for mixed
              (chartType === 'bar' ? yKeys : yKeys.slice(0, 1)).map((yk, yi) => (
                <g key={`bars-${yk}`}>
                  {data.map((row, ri) => {
                    const groupW = chartW / data.length
                    const barCount = chartType === 'bar' ? yKeys.length : 1
                    const barW = Math.max(2, (groupW * 0.7) / barCount)
                    const groupX = pad.left + ri * groupW
                    const v = Number(row[yk]) || 0
                    const barH = Math.max(0, (v / yRange) * chartH)
                    const barX = groupX + groupW * 0.15 + yi * barW
                    const barY = pad.top + chartH - barH
                    return (
                      <rect key={`bar-${ri}`} x={barX} y={barY} width={barW} height={barH} fill={colors[yi] || '#888'} rx="1">
                        <title>{`${labels[yi] || yk}: ${v}`}</title>
                      </rect>
                    )
                  })}
                </g>
              ))
            ) : null}
            {/* Line layer: all yKeys for line type, second yKey onward for mixed */}
            {(chartType === 'line' || chartType === 'mixed') ? (
              (chartType === 'line' ? yKeys : yKeys.slice(1)).map((yk, yi) => {
                const colorIdx = chartType === 'line' ? yi : yi + 1
                const points = data.map((row, ri) => {
                  const x = pad.left + (chartW * ri) / Math.max(1, data.length - 1)
                  const v = Number(row[yk]) || 0
                  const y = pad.top + chartH - ((v - yMin) / yRange) * chartH
                  return `${x},${y}`
                }).join(' ')
                return (
                  <g key={`line-${yk}`}>
                    <polyline points={points} fill="none" stroke={colors[colorIdx] || '#888'} strokeWidth="2" />
                    {data.map((row, ri) => {
                      const x = pad.left + (chartW * ri) / Math.max(1, data.length - 1)
                      const v = Number(row[yk]) || 0
                      const y = pad.top + chartH - ((v - yMin) / yRange) * chartH
                      return (
                        <circle key={`dot-${ri}`} cx={x} cy={y} r="3" fill={colors[colorIdx] || '#888'}>
                          <title>{`${labels[colorIdx] || yk}: ${v}`}</title>
                        </circle>
                      )
                    })}
                  </g>
                )
              })
            ) : null}
            {/* X axis labels — shared */}
            {data.map((row, ri) => {
              const groupW = chartW / data.length
              const x = pad.left + ri * groupW + groupW / 2
              if (ri % xStep !== 0 && ri !== data.length - 1) return null
              return (
                <text key={`xl-${ri}`} x={x} y={pad.top + chartH + 18} textAnchor="middle" fontSize="10" fill="#6b7280">
                  {String(row[xKey] || '').slice(5)}
                </text>
              )
            })}

            {/* X axis line */}
            <line x1={pad.left} y1={pad.top + chartH} x2={pad.left + chartW} y2={pad.top + chartH} stroke="#d1d5db" strokeWidth="1" />
            {/* Y axis line */}
            <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + chartH} stroke="#d1d5db" strokeWidth="1" />
          </svg>
        </div>
      )
    }

    default:
      return null
  }
}

export const A2uiRenderer: React.FC<A2uiRendererProps> = ({ messages, onAction }) => {
  const surfaces = useMemo(() => processMessages(messages), [messages])

  if (surfaces.size === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-muted)' }}>
        <p>等待 AI 生成分析结果...</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {Array.from(surfaces.entries()).map(([surfaceId, surface]) => {
        const hasRoot = surface.components.has('root')
        if (!hasRoot) {
          // Render all components in a column if no root
          return (
            <div key={surfaceId} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Array.from(surface.components.keys())
                .filter(id => !Array.from(surface.components.values()).some(
                  c => Array.isArray(c.children) && (c.children as string[]).includes(id)
                ))
                .map(id => (
                  <ComponentRenderer key={id} compId={id} surface={surface} onAction={onAction} />
                ))}
            </div>
          )
        }
        return (
          <div key={surfaceId}>
            <ComponentRenderer compId="root" surface={surface} onAction={onAction} />
          </div>
        )
      })}
    </div>
  )
}

export { processMessages }
export type { A2uiMessageBase, SurfaceState }

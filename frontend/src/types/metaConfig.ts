export interface MetaValueDef {
  /** Key in the task data object (e.g. "typeLabel", "statusLabel") */
  dataKey?: string
  /** Static fallback string, used when dataKey is missing from the task object */
  static?: string
  /** Render in monospace font */
  mono?: boolean
  /** Render in bold */
  bold?: boolean
  /** Override font size (px) */
  fontSize?: number
}

export interface MetaRowDef {
  label: string
  value: MetaValueDef
  /** Insert a horizontal divider before this row */
  dividerBefore?: boolean
  /** If set, renders a progress bar below the row. Value 0-100 */
  progressValue?: number
}

export interface MetaSectionDef {
  title: string
  rows: MetaRowDef[]
}

export interface MetaStatusBadge {
  label: string
  className: 'warn' | 'danger' | 'success'
}

export interface MetaPanelConfig {
  /** Key in task data for the contract/document ID */
  contractIdDataKey?: string
  /** Static company/organization name */
  companyName?: string
  /** Status badges shown at the top of the header */
  statusBadges?: MetaStatusBadge[]
  /** Ordered list of sections */
  sections: MetaSectionDef[]
}

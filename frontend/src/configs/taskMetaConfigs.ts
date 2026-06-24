import type { MetaPanelConfig } from '../types/metaConfig'

/**
 * Meta panel config for execution task detail page — contract info only.
 *
 * Task metadata (ID, assignee, supervisor, priority, status, due date)
 * is shown in the header bar and should NOT be duplicated here.
 */
export const defaultMetaConfig: MetaPanelConfig = {
  contractIdDataKey: 'contractId',
  companyName: '',
  statusBadges: [],
  sections: [
    {
      title: '基本信息',
      rows: [
        { label: '合同金额', value: { dataKey: 'contract_amount', mono: true } },
        { label: '下单日期', value: { dataKey: 'order_date' } },
        { label: '交货期', value: { dataKey: 'delivery_days' } },
        { label: '销售员', value: { dataKey: 'salesperson' } },
        { label: '采购员', value: { dataKey: 'purchaser' } },
      ],
    },
    {
      title: '履约进度',
      rows: [
        { label: '发货比例', value: { dataKey: 'shipment_ratio', mono: true }, progressValue: 0 },
        { label: '签收比例', value: { dataKey: 'receipt_ratio', mono: true }, progressValue: 0 },
      ],
    },
  ],
}

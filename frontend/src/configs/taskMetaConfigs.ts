import type { MetaPanelConfig } from '../types/metaConfig'

/**
 * Default meta panel config for execution task detail page.
 *
 * All field values are resolved dynamically from the task data object.
 * Fields with `dataKey` are looked up from the enriched task object.
 * `static` serves only as fallback when data is missing.
 */
export const defaultMetaConfig: MetaPanelConfig = {
  contractIdDataKey: 'contractId',
  companyName: '',
  statusBadges: [
    { label: '异常', className: 'danger' },
    { label: '紧急', className: 'warn' },
  ],
  sections: [
    {
      title: '任务信息',
      rows: [
        { label: '任务编号', value: { dataKey: 'id', mono: true, fontSize: 11 } },
        { label: '关联分析', value: { dataKey: 'analysisTaskId', mono: true } },
        { label: '优先级', value: { dataKey: 'priorityLabel' } },
        { label: '状态', value: { dataKey: 'statusLabel' } },
        { label: '截止日期', value: { dataKey: 'dueDate', mono: true } },
        { label: '', value: {}, dividerBefore: true },
        { label: '督办人', value: { dataKey: 'supervisor', bold: true } },
        { label: '执行人', value: { dataKey: 'assignee', bold: true } },
      ],
    },
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
    {
      title: '产品信息',
      rows: [
        { label: '产品型号', value: { dataKey: 'product_model' } },
        { label: '物料编号', value: { dataKey: 'material_code', mono: true } },
        { label: 'SKU 数量', value: { dataKey: 'sku_count', mono: true } },
        { label: '发货方式', value: { dataKey: 'ship_method' } },
      ],
    },
  ],
}

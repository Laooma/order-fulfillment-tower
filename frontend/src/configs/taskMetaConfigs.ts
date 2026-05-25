import type { MetaPanelConfig } from '../types/metaConfig'

/**
 * Default meta panel config — reproduces the hardcoded layout
 * previously in TaskDetailLayout's left sidebar.
 *
 * Fields with `dataKey` are resolved from the fetched task data.
 * Fields with only `static` are currently hardcoded (non-API fields).
 */
export const defaultMetaConfig: MetaPanelConfig = {
  contractIdDataKey: 'contractId',
  companyName: '中国铁制股份有限公司 · 华北大区 / 安徽',
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
        { label: '任务类型', value: { dataKey: 'typeLabel' } },
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
        { label: '合同金额', value: { static: '1,558.00 万元', mono: true } },
        { label: '下单日期', value: { static: '2024/11/14' } },
        { label: '交货期', value: { static: '47 天' } },
        { label: '销售员', value: { static: '李明' } },
        { label: '采购员', value: { static: '王芳' } },
      ],
    },
    {
      title: '履约进度',
      rows: [
        { label: '发货比例', value: { static: '65%', mono: true }, progressValue: 65 },
        { label: '签收比例', value: { static: '32%', mono: true }, progressValue: 32 },
      ],
    },
    {
      title: '产品信息',
      rows: [
        { label: '产品型号', value: { static: 'CCU-2000' } },
        { label: '物料编号', value: { static: 'HT001241', mono: true } },
        { label: 'SKU 数量', value: { static: '6', mono: true } },
        { label: '发货方式', value: { static: '直发客户' } },
      ],
    },
  ],
}

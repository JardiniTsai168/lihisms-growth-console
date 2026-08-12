import type { AppState, OptimizationRules, StrategyRecord } from './types'

const now = '2026-08-10T19:00:00.000Z'

const record = (
  id: string,
  kind: StrategyRecord['kind'],
  title: string,
  summary: string,
  standardTags: string[],
  notes = '',
): StrategyRecord => ({
  id,
  kind,
  title,
  summary,
  standardTags,
  freeformTags: [],
  status: 'active',
  notes,
  createdAt: now,
  updatedAt: now,
})

export const standardTagBank: Record<StrategyRecord['kind'], string[]> = {
  use_case: ['會員喚回', '新品上架', '限時促購', '沉睡顧客喚醒', 'VIP 專屬通知'],
  benefit: ['可追蹤點擊', 'lihi 短網址', '快速上架', '台灣發票', '成效可回溯'],
}

export const defaultRules: OptimizationRules = {
  minSpend: 40,
  ctrGoal: 1.8,
  maxCpa: 16,
  maxFrequency: 2.8,
}

const defaultAdsMcpGateway = {
  mode: 'demo' as const,
  endpointUrl: '',
  adAccountId: '',
  pixelId: '',
  authStrategy: 'none' as const,
  connectionStatus: 'disconnected' as const,
  businessName: null,
  availableAdAccounts: [],
  availablePixels: [],
  lastValidatedAt: null,
}

const library: StrategyRecord[] = [
  record(
    'use-member-winback',
    'use_case',
    '會員喚回',
    '針對已購買但沉默一段時間的會員，用 SMS 把流失注意力拉回品牌檔期。',
    ['會員喚回', '沉睡顧客喚醒'],
  ),
  record(
    'use-launch-day',
    'use_case',
    '新品上架',
    '新品開賣當天快速通知既有會員，讓簡訊和站內檔期在同一節奏引爆。',
    ['新品上架'],
  ),
  record(
    'use-flash-sale',
    'use_case',
    '限時促購',
    '為短時效的折扣活動建立高壓縮、強 CTA 的提醒節奏。',
    ['限時促購'],
  ),
  record(
    'benefit-trackable',
    'benefit',
    '可追蹤點擊與成效',
    '不是只把簡訊送出去，而是能回頭看每波活動帶來多少點擊與註冊。',
    ['可追蹤點擊', '成效可回溯'],
  ),
  record(
    'benefit-short-link',
    'benefit',
    '可搭配 lihi 短網址',
    '把品牌短網址與 SMS 綁在一起，讓訊息更乾淨也更容易回收數據。',
    ['lihi 短網址', '品牌短網址'],
  ),
  record(
    'benefit-invoice',
    'benefit',
    '可開台灣發票',
    '正式商用時不會卡採購與報帳流程，能更順利進入品牌年度工具名單。',
    ['台灣發票', '正式商用'],
  ),
]

export const initialState: AppState = {
  library,
  batches: [],
  creatives: [],
  drafts: [],
  metrics: [],
  rules: defaultRules,
  adsMcpGateway: defaultAdsMcpGateway,
}

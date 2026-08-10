import type {
  AppState,
  CreativeAsset,
  CreativeBatch,
  DraftAd,
  OptimizationRules,
  StrategyRecord,
} from './types'

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
  proof: ['台灣發票', '點擊報表', '品牌短網址', '正式商用', '電商可用'],
  template: ['Proof-first ledger', 'Promo burst', 'Signal board'],
}

export const defaultRules: OptimizationRules = {
  minSpend: 40,
  ctrGoal: 1.8,
  maxCpa: 16,
  maxFrequency: 2.8,
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
  record(
    'proof-reporting',
    'proof',
    '點擊報表可回看',
    '每波活動都能留下一條可追蹤的報表軌跡，方便 CRM 接續推進。',
    ['點擊報表'],
  ),
  record(
    'proof-taiwan-invoice',
    'proof',
    '台灣公司採購友善',
    '支援台灣發票與正式商業流程，讓品牌導入阻力更低。',
    ['台灣發票', '正式商用'],
  ),
  record(
    'template-ledger',
    'template',
    'Proof-first ledger',
    '強調證據、數字和品牌信任的廣告視覺模板。',
    ['Proof-first ledger'],
  ),
  record(
    'template-burst',
    'template',
    'Promo burst',
    '針對促購、檔期、時間壓力的爆發式視覺模板。',
    ['Promo burst'],
  ),
]

const exampleBatch: CreativeBatch = {
  id: 'batch-seed-001',
  useCaseId: 'use-member-winback',
  benefitIds: ['benefit-trackable', 'benefit-short-link'],
  proofIds: ['proof-reporting'],
  templateId: 'template-ledger',
  angleId: 'ANGLE-WINBACK-TRACK',
  promptVersion: 'v1.0.0-demo',
  createdAt: now,
  creativeIds: ['creative-seed-1', 'creative-seed-2', 'creative-seed-3'],
}

const exampleCreatives: CreativeAsset[] = [
  {
    id: 'creative-seed-1',
    batchId: exampleBatch.id,
    angleId: exampleBatch.angleId,
    creativeVersion: 'A1',
    headline: 'SMS 不只送出，還知道誰有回來',
    kicker: '會員喚回 / 電商品牌',
    body: '把 lihi 短網址放進簡訊裡，回頭看每波喚回帶來多少點擊、多少註冊、哪些人重新動起來。',
    proofLine: '搭配 lihi 短網址與點擊報表',
    visualMode: 'Signal board',
    metadata: {
      icp: '電商品牌',
      useCaseId: exampleBatch.useCaseId,
      benefitIds: exampleBatch.benefitIds,
      proofIds: exampleBatch.proofIds,
      templateId: exampleBatch.templateId,
      createdAt: now,
    },
    promptVersion: exampleBatch.promptVersion,
    reviewStatus: 'approved',
    rejectionReason: null,
  },
  {
    id: 'creative-seed-2',
    batchId: exampleBatch.id,
    angleId: exampleBatch.angleId,
    creativeVersion: 'A2',
    headline: '把沉睡會員拉回來，也把數據一起拉回來',
    kicker: '點擊成效清楚回看',
    body: '喚回簡訊不是憑感覺發。每次 CTA 都能對照點擊、頁面進站與註冊結果，讓 CRM 知道誰值得再推。',
    proofLine: '報表可回看，CRM 可接續',
    visualMode: 'Promo burst',
    metadata: {
      icp: '電商品牌',
      useCaseId: exampleBatch.useCaseId,
      benefitIds: exampleBatch.benefitIds,
      proofIds: exampleBatch.proofIds,
      templateId: exampleBatch.templateId,
      createdAt: now,
    },
    promptVersion: exampleBatch.promptVersion,
    reviewStatus: 'pending',
    rejectionReason: null,
  },
  {
    id: 'creative-seed-3',
    batchId: exampleBatch.id,
    angleId: exampleBatch.angleId,
    creativeVersion: 'A3',
    headline: '想喚回老會員，先別再發看不到成效的簡訊',
    kicker: '成效導向 SMS',
    body: '把點擊追蹤、品牌短網址與正式商用流程收進同一套節奏，讓每一次喚回活動都能被優化。',
    proofLine: '適合台灣品牌正式導入',
    visualMode: 'Proof ledger',
    metadata: {
      icp: '電商品牌',
      useCaseId: exampleBatch.useCaseId,
      benefitIds: exampleBatch.benefitIds,
      proofIds: exampleBatch.proofIds,
      templateId: exampleBatch.templateId,
      createdAt: now,
    },
    promptVersion: exampleBatch.promptVersion,
    reviewStatus: 'rejected',
    rejectionReason: '不像 lihi',
  },
]

const exampleDraft: DraftAd = {
  id: 'draft-seed-1',
  creativeId: 'creative-seed-1',
  batchId: exampleBatch.id,
  status: 'published',
  campaignName: 'lihiSMS | 電商品牌 | 會員喚回',
  adsetName: 'Winback / Trackable Clicks',
  adName: 'ANGLE-WINBACK-TRACK / A1',
  metadata: {
    icp: '電商品牌',
    useCaseId: exampleBatch.useCaseId,
    benefitIds: exampleBatch.benefitIds,
    proofIds: exampleBatch.proofIds,
    angleId: exampleBatch.angleId,
    creativeVersion: 'A1',
    createdAt: now,
  },
  createdAt: now,
  publishedAt: now,
}

export const initialState: AppState = {
  library,
  batches: [exampleBatch],
  creatives: exampleCreatives,
  drafts: [exampleDraft],
  metrics: [],
  rules: defaultRules,
}

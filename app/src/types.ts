export type LibraryKind = 'use_case' | 'benefit' | 'proof' | 'template'

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export type DraftStatus = 'draft' | 'published'

export type StrategyRecord = {
  id: string
  kind: LibraryKind
  title: string
  summary: string
  standardTags: string[]
  freeformTags: string[]
  status: 'active' | 'archived'
  notes: string
  createdAt: string
  updatedAt: string
}

export type CreativeAsset = {
  id: string
  batchId: string
  angleId: string
  creativeVersion: string
  headline: string
  kicker: string
  body: string
  proofLine: string
  visualMode: string
  metadata: {
    icp: string
    useCaseId: string
    benefitIds: string[]
    proofIds: string[]
    templateId: string
    createdAt: string
  }
  promptVersion: string
  reviewStatus: ReviewStatus
  rejectionReason: string | null
}

export type CreativeBatch = {
  id: string
  useCaseId: string
  benefitIds: string[]
  proofIds: string[]
  templateId: string
  angleId: string
  promptVersion: string
  createdAt: string
  creativeIds: string[]
}

export type DraftAd = {
  id: string
  creativeId: string
  batchId: string
  status: DraftStatus
  campaignName: string
  adsetName: string
  adName: string
  metadata: {
    icp: string
    useCaseId: string
    benefitIds: string[]
    proofIds: string[]
    angleId: string
    creativeVersion: string
    createdAt: string
  }
  createdAt: string
  publishedAt: string | null
}

export type AnalyticsMetric = {
  id: string
  draftId: string
  creativeId: string
  spend: number
  impressions: number
  frequency: number
  clicks: number
  ctr: number
  cpc: number
  landingPageViews: number
  registerSubmitted: number
  emailVerifiedSignups: number
  costPerVerifiedSignup: number | null
  syncedAt: string
}

export type OptimizationRules = {
  minSpend: number
  ctrGoal: number
  maxCpa: number
  maxFrequency: number
}

export type AppState = {
  library: StrategyRecord[]
  batches: CreativeBatch[]
  creatives: CreativeAsset[]
  drafts: DraftAd[]
  metrics: AnalyticsMetric[]
  rules: OptimizationRules
}

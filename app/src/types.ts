export type LibraryKind = 'use_case' | 'benefit'

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export type DraftStatus = 'draft' | 'published'

export type Platform = 'Facebook' | 'Instagram' | 'Threads' | 'Google Ads'

export type CampaignObjective = 'conversions' | 'leads'

export type FunnelStage = 'prospecting' | 'retargeting' | 'winback'

export type AudienceType =
  | 'broad'
  | 'interest_stack'
  | 'lookalike'
  | 'site_visitors'
  | 'engaged_clickers'
  | 'lp_view_no_signup'
  | 'old_leads'
  | 'dormant_customers'
  | 'crm_high_intent'

export type BudgetStrategy = 'lowest_cost' | 'cost_cap'

export type OptimizationGoal = 'conversions' | 'landing_page_views' | 'leads'

export type PlacementStrategy = 'advantage_plus' | 'feeds_only' | 'stories_and_reels'

export type AdAngleFamily = 'benefit' | 'use_case'

export type CopyDeliverables = {
  meta_ad?: {
    primaryText: string
    headline: string
    description: string
    destinationUrl: string
  }
  google_ads?: {
    headline: string
    description: string
    path1: string
    path2: string
    destinationUrl: string
  }
}

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
  sourceCreativeId: string
  batchId: string
  angleId: string
  creativeVersion: string
  stylePreset: string
  talent: string
  tone: 'brand' | 'conversion'
  voiceBalance: number
  headline: string
  kicker: string
  body: string
  deliveryNote: string
  visualMode: string
  squareAsset: string
  formatStatus: 'square_only' | 'formats_ready'
  selectedPlatforms: Platform[]
  copyMode: '品牌' | '轉單'
  emotionalIntensity: number
  modelSetting: string
  finalCopy: {
    primaryText: string
    headline: string
    description: string
    destinationUrl: string
  } | null
  copyDeliverables: CopyDeliverables | null
  assetDeliverables: Array<{
    platform: string
    surface: string
    aspectRatio: string
    url: string
    width: number
    height: number
    mimeType: string
  }>
  metadata: {
    icp: string
    useCaseId: string
    productName: string
    benefitIds: string[]
    productLink: string
    logoAsset: string
    productAsset: string
    additionalNotes: string
    createdAt: string
  }
  promptVersion: string
  reviewStatus: ReviewStatus
  rejectionReason: string | null
}

export type CreativeBatch = {
  id: string
  useCaseId: string
  productName: string
  benefitIds: string[]
  angleId: string
  promptVersion: string
  productLink: string
  logoAsset: string
  productAsset: string
  additionalNotes: string
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
  primaryText: string
  headline: string
  description: string
  destinationUrl: string
  assetDeliverables: string[]
  adsPlan: {
    campaign: {
      objective: CampaignObjective
      funnelStage: FunnelStage
      productLine: string
      market: string
      campaignName: string
    }
    adSet: {
      audienceType: AudienceType
      audienceWindowDays: number | null
      geo: string
      ageRange: string
      budgetStrategy: BudgetStrategy
      optimizationGoal: OptimizationGoal
      placementStrategy: PlacementStrategy
      adsetName: string
    }
    ad: {
      angleFamily: AdAngleFamily
      angleLabel: string
      copyMode: CreativeAsset['copyMode']
      adName: string
    }
  }
  metadata: {
    icp: string
    useCaseId: string
    productName: string
    benefitIds: string[]
    angleId: string
    creativeVersion: string
    selectedPlatforms: Platform[]
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

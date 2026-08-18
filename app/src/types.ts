export type LibraryKind = 'use_case' | 'benefit'

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export type Platform = 'Facebook' | 'Instagram' | 'Threads' | 'Google Ads'

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

export type AssetDeliverable = {
  platform: string
  surface: string
  aspectRatio: string
  url: string
  width: number
  height: number
  mimeType: string
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
  assetDeliverables: AssetDeliverable[]
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

export type ApprovedArchiveItem = {
  id: string
  creativeId: string
  batchId: string
  creativeVersion: string
  angleId: string
  approvedAt: string
  selectedPlatforms: Platform[]
  productName: string
  useCaseId: string
  benefitIds: string[]
  promptVersion: string
  copyMode: CreativeAsset['copyMode']
  headline: string
  kicker: string
  body: string
  squareAsset: string
  finalCopy: {
    primaryText: string
    headline: string
    description: string
    destinationUrl: string
  } | null
  copyDeliverables: CopyDeliverables | null
  assetDeliverables: AssetDeliverable[]
  metadata: CreativeAsset['metadata']
}

export type AppState = {
  library: StrategyRecord[]
  batches: CreativeBatch[]
  creatives: CreativeAsset[]
}

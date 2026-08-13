import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { initialState, standardTagBank } from './seed'
import { buildRecommendations } from './recommendations'
import type {
  AdAngleFamily,
  AnalyticsMetric,
  AdsMcpGatewayConfig,
  AdsMcpGatewayRequest,
  AdsMcpGatewayResponse,
  AppState,
  AdsPageOption,
  AudienceType,
  BudgetStrategy,
  CampaignObjective,
  CreativeAsset,
  CreativeBatch,
  CopyDeliverables,
  DraftAd,
  FunnelStage,
  LibraryKind,
  OptimizationGoal,
  PlacementStrategy,
  AdsMcpPayloadPreview,
  PublishAssetSelection,
  PublishBundle,
  OptimizationRules,
  Platform,
  StrategyRecord,
} from './types'
import { usePersistentState } from './usePersistentState'

const STORAGE_KEY = 'lihisms-growth-console-v7'
const CREATIVE_API_BASE = 'https://creative.bktsai.link/internal'
const META_ADS_MCP_SERVER = 'https://mcp.facebook.com/ads'
const META_ADS_MCP_RELAY = `${CREATIVE_API_BASE}/meta-ads-mcp`
const DEMO_PUBLISH_LATENCY_MS = 900
const DEFAULT_DAILY_BUDGET_MINOR = 10000

type ReviewResponse = {
  batchId: string
  promptVersion: string
  creatives: Array<{
    creativeId: string
    creativeVersion: string
    stylePreset?: string
    talent?: string
    tone?: 'brand' | 'conversion'
    voiceBalance?: number
    headline: string
    kicker: string
    body: string
    deliveryNote: string
    visualMode: string
    copyMode: CreativeAsset['copyMode']
    emotionalIntensity: number
    modelSetting: string
    squareAsset: {
      url: string
      width: number
      height: number
      mimeType: string
    }
  }>
}

type FormatsResponse = {
  creativeId: string
  copyDeliverables?: CopyDeliverables
  finalCopy?: {
    primaryText: string
    headline: string
    description: string
    destinationUrl: string
  }
  assetDeliverables: Array<{
    platform: string
    surface: string
    aspectRatio: string
    url: string
    width: number
    height: number
    mimeType: string
  }>
}

type AdsMcpPublishResult = {
  requestId: string
  responseCode: number
  responseBody: string
  externalCampaignId: string
  externalAdSetId: string
  externalAdId: string
}

type AdsGatewayContractPreview = {
  request: AdsMcpGatewayRequest
  response: AdsMcpGatewayResponse
}

type FacebookCampaignSnapshot = {
  id: string
  name: string
  status: string
  effectiveStatus: string
  objective: string
}

type FacebookAdSetSnapshot = {
  id: string
  campaignId: string
  name: string
  status: string
  effectiveStatus: string
  optimizationGoal: string
  dailyBudget: string | null
  lifetimeBudget: string | null
}

type FacebookAdSnapshot = {
  id: string
  campaignId: string
  adSetId: string
  name: string
  status: string
  effectiveStatus: string
}

type FacebookAccountStructureSnapshot = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  campaigns: FacebookCampaignSnapshot[]
  adSets: FacebookAdSetSnapshot[]
  ads: FacebookAdSnapshot[]
  lastSyncedAt: string | null
  error: string | null
}

const rejectionReasons = [
  '賣點不對',
  '文案太弱',
  '視覺不佳',
  '不像 lihi',
  '不適合投放',
  '其他',
]

const platformOptions: Platform[] = ['Facebook', 'Instagram', 'Threads', 'Google Ads']

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const buildEmptyForm = () => ({
  kind: 'use_case' as LibraryKind,
  title: '',
  summary: '',
  notes: '',
  standardTags: [] as string[],
  freeformTags: '',
})

const buildBatchForm = (library: StrategyRecord[]) => {
  const useCase = library.find((record) => record.kind === 'use_case' && record.status === 'active')
  const benefits = library.filter((record) => record.kind === 'benefit' && record.status === 'active')

  return {
    useCaseId: useCase?.id ?? '',
    productName: 'lihiSMS',
    benefitIds: benefits.slice(0, 3).map((item) => item.id),
    productLink: '',
    logoAsset: '',
    productAsset: '',
    additionalNotes: '',
  }
}

const toneLabelMap = {
  brand: '品牌向',
  conversion: '轉單向',
} as const

function formatStylePreset(stylePreset?: string) {
  if (!stylePreset?.trim()) {
    return '未指定風格'
  }

  return stylePreset
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatTalentLabel(talent?: string, modelSetting?: string) {
  if (modelSetting?.trim()) {
    return modelSetting
  }

  return talent || '未提供'
}

function getToneLabel(tone?: 'brand' | 'conversion') {
  if (!tone) {
    return '未指定方向'
  }

  return toneLabelMap[tone]
}

function getPrimaryCopy(creative: CreativeAsset) {
  return creative.copyDeliverables?.meta_ad ?? creative.finalCopy
}

function getDestinationUrl(creative: CreativeAsset) {
  return (
    creative.copyDeliverables?.meta_ad?.destinationUrl ||
    creative.copyDeliverables?.google_ads?.destinationUrl ||
    creative.finalCopy?.destinationUrl ||
    creative.metadata.productLink ||
    'https://lihi.io/products/sms'
  )
}

function getPlatformLabel(platform: string) {
  const normalized = platform.trim()
  if (normalized === 'IG Reels' || normalized === 'IG Stories') {
    return normalized
  }
  return normalized
}

function detectFunnelStage(creative: CreativeAsset): FunnelStage {
  const useCaseId = creative.metadata.useCaseId

  if (useCaseId.includes('member') || useCaseId.includes('winback')) {
    return 'winback'
  }

  return 'prospecting'
}

function detectAudienceType(funnelStage: FunnelStage, creative: CreativeAsset): AudienceType {
  if (funnelStage === 'winback') {
    return 'old_leads'
  }

  if (creative.copyMode === '轉單') {
    return 'interest_stack'
  }

  return 'broad'
}

function getAudienceWindowDays(audienceType: AudienceType) {
  switch (audienceType) {
    case 'site_visitors':
      return 30
    case 'engaged_clickers':
    case 'lp_view_no_signup':
      return 14
    case 'old_leads':
    case 'dormant_customers':
      return 180
    default:
      return null
  }
}

function getCampaignObjective(platforms: Platform[]): CampaignObjective {
  return platforms.includes('Google Ads') ? 'leads' : 'conversions'
}

function getBudgetStrategy(funnelStage: FunnelStage): BudgetStrategy {
  return funnelStage === 'prospecting' ? 'lowest_cost' : 'cost_cap'
}

function getOptimizationGoal(
  funnelStage: FunnelStage,
  objective: CampaignObjective,
): OptimizationGoal {
  if (objective === 'leads') {
    return 'leads'
  }

  return funnelStage === 'prospecting' ? 'landing_page_views' : 'conversions'
}

function getPlacementStrategy(platforms: Platform[]): PlacementStrategy {
  if (platforms.includes('Instagram') || platforms.includes('Threads')) {
    return 'stories_and_reels'
  }

  return 'advantage_plus'
}

function getAngleFamily(creative: CreativeAsset): AdAngleFamily {
  return creative.metadata.useCaseId.startsWith('use-') ? 'use_case' : 'benefit'
}

function buildCampaignName(productName: string, funnelStage: FunnelStage, objective: CampaignObjective) {
  return `${productName} | ${capitalizeToken(funnelStage)} | ${capitalizeToken(objective)}`
}

function resolveFacebookCountryCode(value?: string | null) {
  const normalized = (value ?? '').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(normalized) ? normalized : 'TW'
}

function buildAdSetName(
  audienceType: AudienceType,
  creative: CreativeAsset,
  audienceWindowDays: number | null,
) {
  const productGeo = resolveFacebookCountryCode(creative.metadata.icp)
  const audienceLabel = audienceTypeLabelMap[audienceType]
  const windowLabel = audienceWindowDays ? ` | ${audienceWindowDays}D` : ''

  if (audienceType === 'broad') {
    return `P01 | ${audienceLabel} | ${productGeo} | 25-45`
  }

  return `A01 | ${audienceLabel}${windowLabel} | ${productGeo}`
}

function buildAdName(
  creative: CreativeAsset,
  angleFamily: AdAngleFamily,
) {
  const familyLabel = angleFamily === 'benefit' ? 'Benefit' : 'UseCase'
  const copyModeLabel = creative.copyMode === '品牌' ? 'Brand' : 'Conversion'

  return `A01 | ${familyLabel}_${creative.angleId} | ${copyModeLabel} | ${creative.creativeVersion}`
}

function capitalizeToken(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

const audienceTypeLabelMap: Record<AudienceType, string> = {
  broad: 'Broad',
  interest_stack: 'Interest',
  lookalike: 'LAL',
  site_visitors: 'Visitors',
  engaged_clickers: 'EngagedClickers',
  lp_view_no_signup: 'LPViewNoSignup',
  old_leads: 'OldLeads',
  dormant_customers: 'DormantCustomers',
  crm_high_intent: 'CRMHighIntent',
}

function buildAdsPlan(creative: CreativeAsset): DraftAd['adsPlan'] {
  const funnelStage = detectFunnelStage(creative)
  const audienceType = detectAudienceType(funnelStage, creative)
  const audienceWindowDays = getAudienceWindowDays(audienceType)
  const objective = getCampaignObjective(creative.selectedPlatforms)
  const budgetStrategy = getBudgetStrategy(funnelStage)
  const optimizationGoal = getOptimizationGoal(funnelStage, objective)
  const placementStrategy = getPlacementStrategy(creative.selectedPlatforms)
  const angleFamily = getAngleFamily(creative)
  const campaignName = buildCampaignName(creative.metadata.productName, funnelStage, objective)
  const adsetName = buildAdSetName(audienceType, creative, audienceWindowDays)
  const adName = buildAdName(creative, angleFamily)

  return {
    campaign: {
      objective,
      funnelStage,
      productLine: creative.metadata.productName,
      market: creative.metadata.icp || 'TW',
      campaignName,
    },
    adSet: {
      audienceType,
      audienceWindowDays,
      geo: resolveFacebookCountryCode(creative.metadata.icp),
      ageRange: '25-45',
      budgetStrategy,
      optimizationGoal,
      placementStrategy,
      adsetName,
    },
    ad: {
      angleFamily,
      angleLabel: creative.angleId,
      copyMode: creative.copyMode,
      adName,
    },
  }
}

function buildPublishChecklist(bundle: {
  copyPayload: PublishBundle['copyPayload']
  assetSelections: PublishAssetSelection[]
}): PublishBundle['checklist'] {
  const hasCopy =
    Boolean(bundle.copyPayload.primaryText.trim()) && Boolean(bundle.copyPayload.headline.trim())
  const hasDestinationUrl = Boolean(bundle.copyPayload.destinationUrl.trim())
  const selectedAssets = bundle.assetSelections.filter((asset) => asset.selected)

  return {
    hasCopy,
    hasDestinationUrl,
    hasSelectedAssets: selectedAssets.length > 0,
    hasMetaAsset: selectedAssets.some((asset) => isMetaPlatform(asset.platform)),
  }
}

function buildSubmissionRecord(): PublishBundle['submission'] {
  return {
    mode: 'demo',
    requestId: null,
    submittedAt: null,
    completedAt: null,
    responseCode: null,
    responseBody: null,
    externalCampaignId: null,
    externalAdSetId: null,
    externalAdId: null,
  }
}

function buildDefaultAdsMcpGateway(): AdsMcpGatewayConfig {
  const configuredEndpointUrl = import.meta.env.VITE_ADS_MCP_GATEWAY_URL ?? ''
  const endpointUrl = configuredEndpointUrl.trim() || META_ADS_MCP_RELAY
  const appId = import.meta.env.VITE_FACEBOOK_APP_ID ?? ''
  const graphVersion = import.meta.env.VITE_FACEBOOK_GRAPH_VERSION ?? 'v26.0'

  return {
    mode: endpointUrl.trim() ? 'remote' : 'demo',
    endpointUrl,
    appId,
    graphVersion,
    adAccountId: '',
    pixelId: '',
    pageId: '',
    authStrategy: endpointUrl.trim() ? 'bearer' : 'none',
    accessToken: null,
    tokenExpiresAt: null,
    grantedScopes: [],
    oauthState: null,
    connectionStatus: 'disconnected',
    businessName: null,
    availableAdAccounts: [],
    availablePixels: [],
    availablePages: [],
    lastError: null,
    lastValidatedAt: null,
  }
}

function buildFacebookRedirectUri() {
  return `${window.location.origin}${window.location.pathname}`
}

function buildFacebookOauthUrl(gateway: AdsMcpGatewayConfig, oauthState: string) {
  const params = new URLSearchParams({
    client_id: gateway.appId,
    redirect_uri: buildFacebookRedirectUri(),
    response_type: 'token',
    scope: 'ads_management,ads_read,business_management,ads_mcp_management,pages_show_list',
    return_scopes: 'true',
    auth_type: 'rerequest',
    state: oauthState,
  })

  return `https://www.facebook.com/${gateway.graphVersion}/dialog/oauth?${params.toString()}`
}

function normalizeFacebookAdAccountId(id?: string | null, accountId?: string | null) {
  const value = (accountId ?? id ?? '').trim()
  if (!value) {
    return ''
  }

  return value.startsWith('act_') ? value : `act_${value}`
}

function extractFacebookAdAccountNumber(id?: string | null, accountId?: string | null) {
  const normalizedId = normalizeFacebookAdAccountId(id, accountId)
  return normalizedId.replace(/^act_/, '')
}

function parseOauthHash(hash: string) {
  const normalized = hash.startsWith('#') ? hash.slice(1) : hash
  const params = new URLSearchParams(normalized)

  return {
    accessToken: params.get('access_token'),
    expiresIn: params.get('expires_in'),
    state: params.get('state'),
    grantedScopes: params.get('granted_scopes'),
    error: params.get('error') ?? params.get('error_reason'),
    errorDescription: params.get('error_description'),
  }
}

async function fetchFacebookAdAccounts(gateway: AdsMcpGatewayConfig) {
  if (!gateway.accessToken) {
    throw new Error('Missing Facebook access token.')
  }

  const accounts = new Map<string, { id: string; accountId: string; name: string; currency: string }>()
  const upsertAccount = (account: {
    id: string
    accountId: string
    name: string
    currency: string
  }) => {
    const canonicalAccountId = extractFacebookAdAccountNumber(account.id, account.accountId)
    const normalizedId = normalizeFacebookAdAccountId(account.id, account.accountId)
    accounts.set(canonicalAccountId, {
      id: normalizedId,
      accountId: canonicalAccountId,
      name: account.name,
      currency: account.currency,
    })
  }
  const params = new URLSearchParams({
    fields: 'id,name,account_id,currency',
    limit: '100',
    access_token: gateway.accessToken,
  })

  const directAccounts = await fetchFacebookGraphCollection<{
    id: string
    name?: string
    account_id?: string
    currency?: string
  }>(gateway, `/me/adaccounts?${params.toString()}`)

  for (const account of directAccounts) {
    upsertAccount({
      id: account.id ?? '',
      accountId: account.account_id ?? '',
      name:
        account.name ??
        account.account_id ??
        account.id ??
        normalizeFacebookAdAccountId(account.id, account.account_id),
      currency: account.currency ?? 'USD',
    })
  }

  const businesses = await fetchFacebookBusinesses(gateway)

  for (const business of businesses) {
    const ownedAccounts = await fetchFacebookBusinessAdAccounts(gateway, business.id, 'owned')
    for (const account of ownedAccounts) {
      upsertAccount(account)
    }

    const clientAccounts = await fetchFacebookBusinessAdAccounts(gateway, business.id, 'client')
    for (const account of clientAccounts) {
      upsertAccount(account)
    }
  }

  return Array.from(accounts.values()).map((account) => ({
    id: account.id,
    accountId: account.accountId,
    name: account.name,
    currency: account.currency,
  })).sort((left, right) => {
    const nameComparison = left.name.localeCompare(right.name, 'zh-Hant')
    if (nameComparison !== 0) {
      return nameComparison
    }

    return left.accountId.localeCompare(right.accountId)
  })
}

async function fetchFacebookBusinesses(gateway: AdsMcpGatewayConfig) {
  if (!gateway.accessToken) {
    throw new Error('Missing Facebook access token.')
  }

  const params = new URLSearchParams({
    fields: 'id,name',
    limit: '100',
    access_token: gateway.accessToken,
  })

  return fetchFacebookGraphCollection<{ id: string; name?: string }>(
    gateway,
    `/me/businesses?${params.toString()}`,
  )
}

async function fetchFacebookBusinessAdAccounts(
  gateway: AdsMcpGatewayConfig,
  businessId: string,
  relationship: 'owned' | 'client',
) {
  if (!gateway.accessToken) {
    throw new Error('Missing Facebook access token.')
  }

  const edge = relationship === 'owned' ? 'owned_ad_accounts' : 'client_ad_accounts'
  const params = new URLSearchParams({
    fields: 'id,name,account_id,currency',
    limit: '100',
    access_token: gateway.accessToken,
  })

  const accounts = await fetchFacebookGraphCollection<{
    id: string
    name?: string
    account_id?: string
    currency?: string
  }>(gateway, `/${businessId}/${edge}?${params.toString()}`)

  return accounts.map((account) => ({
    id: normalizeFacebookAdAccountId(account.id, account.account_id),
    accountId: extractFacebookAdAccountNumber(account.id, account.account_id),
    name: account.name ?? account.account_id ?? account.id ?? '',
    currency: account.currency ?? 'USD',
  }))
}

async function fetchFacebookGraphCollection<T>(
  gateway: AdsMcpGatewayConfig,
  initialPath: string,
): Promise<T[]> {
  const records: T[] = []
  let nextUrl = `https://graph.facebook.com/${gateway.graphVersion}${initialPath}`

  while (nextUrl) {
    const response = await fetch(nextUrl)
    const payload = (await response.json()) as {
      data?: T[]
      paging?: { next?: string }
      error?: { message?: string }
    }

    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message ?? `Failed to fetch Facebook assets (${response.status})`)
    }

    records.push(...(payload.data ?? []))
    nextUrl = payload.paging?.next ?? ''
  }

  return records
}

async function fetchFacebookPixels(gateway: AdsMcpGatewayConfig, adAccountId: string) {
  if (!gateway.accessToken) {
    throw new Error('Missing Facebook access token.')
  }

  const normalizedAdAccountId = normalizeFacebookAdAccountId(adAccountId)
  const params = new URLSearchParams({
    fields: 'id,name',
    access_token: gateway.accessToken,
  })
  const response = await fetch(
    `https://graph.facebook.com/${gateway.graphVersion}/${normalizedAdAccountId}/adspixels?${params.toString()}`,
  )
  const payload = (await response.json()) as {
    data?: Array<{ id: string; name?: string }>
    error?: { message?: string }
  }

  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message ?? `Failed to fetch pixels (${response.status})`)
  }

  return (payload.data ?? []).map((pixel) => ({
    id: pixel.id,
    name: pixel.name ?? pixel.id,
  }))
}

async function fetchFacebookPages(gateway: AdsMcpGatewayConfig): Promise<AdsPageOption[]> {
  if (!gateway.accessToken) {
    throw new Error('Missing Facebook access token.')
  }

  const params = new URLSearchParams({
    fields: 'id,name',
    limit: '100',
    access_token: gateway.accessToken,
  })

  const pages = await fetchFacebookGraphCollection<{ id: string; name?: string }>(
    gateway,
    `/me/accounts?${params.toString()}`,
  )

  return pages
    .map((page) => ({
      id: page.id,
      name: page.name?.trim() || page.id,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant'))
}

async function fetchFacebookAccountStructure(
  gateway: AdsMcpGatewayConfig,
  adAccountId: string,
): Promise<{
  campaigns: FacebookCampaignSnapshot[]
  adSets: FacebookAdSetSnapshot[]
  ads: FacebookAdSnapshot[]
}> {
  if (!gateway.accessToken) {
    throw new Error('Missing Facebook access token.')
  }

  const normalizedAdAccountId = normalizeFacebookAdAccountId(adAccountId)
  const buildCollectionPath = (edge: 'campaigns' | 'adsets' | 'ads', fields: string) => {
    const params = new URLSearchParams({
      fields,
      limit: '200',
      access_token: gateway.accessToken!,
    })
    return `/${normalizedAdAccountId}/${edge}?${params.toString()}`
  }

  const [campaigns, adSets, ads] = await Promise.all([
    fetchFacebookGraphCollection<{
      id: string
      name?: string
      objective?: string
      status?: string
      effective_status?: string
    }>(
      gateway,
      buildCollectionPath('campaigns', 'id,name,objective,status,effective_status'),
    ),
    fetchFacebookGraphCollection<{
      id: string
      name?: string
      campaign_id?: string
      optimization_goal?: string
      status?: string
      effective_status?: string
      daily_budget?: string
      lifetime_budget?: string
    }>(
      gateway,
      buildCollectionPath(
        'adsets',
        'id,name,campaign_id,optimization_goal,status,effective_status,daily_budget,lifetime_budget',
      ),
    ),
    fetchFacebookGraphCollection<{
      id: string
      name?: string
      campaign_id?: string
      adset_id?: string
      status?: string
      effective_status?: string
    }>(
      gateway,
      buildCollectionPath('ads', 'id,name,campaign_id,adset_id,status,effective_status'),
    ),
  ])

  return {
    campaigns: campaigns
      .map((campaign) => ({
        id: campaign.id,
        name: campaign.name ?? campaign.id,
        status: campaign.status ?? 'UNKNOWN',
        effectiveStatus: campaign.effective_status ?? campaign.status ?? 'UNKNOWN',
        objective: campaign.objective ?? 'UNKNOWN',
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant')),
    adSets: adSets
      .map((adSet) => ({
        id: adSet.id,
        campaignId: adSet.campaign_id ?? '',
        name: adSet.name ?? adSet.id,
        status: adSet.status ?? 'UNKNOWN',
        effectiveStatus: adSet.effective_status ?? adSet.status ?? 'UNKNOWN',
        optimizationGoal: adSet.optimization_goal ?? 'UNKNOWN',
        dailyBudget: adSet.daily_budget ?? null,
        lifetimeBudget: adSet.lifetime_budget ?? null,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant')),
    ads: ads
      .map((ad) => ({
        id: ad.id,
        campaignId: ad.campaign_id ?? '',
        adSetId: ad.adset_id ?? '',
        name: ad.name ?? ad.id,
        status: ad.status ?? 'UNKNOWN',
        effectiveStatus: ad.effective_status ?? ad.status ?? 'UNKNOWN',
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant')),
  }
}

function buildAdsMcpGatewayRequest(payload: AdsMcpPayloadPreview): AdsMcpGatewayRequest {
  return {
    server: META_ADS_MCP_SERVER,
    operation: 'ads_mcp_tool_sequence_preview',
    payload,
  }
}

function buildAdsGatewayContractPreview(payload: AdsMcpPayloadPreview): AdsGatewayContractPreview {
  return {
    request: buildAdsMcpGatewayRequest(payload),
    response: {
      requestId: 'req_demo_123456',
      campaignId: 'cmp_abc123',
      adSetId: 'adset_def456',
      adId: 'ad_xyz789',
      status: 'accepted',
    },
  }
}

function buildAdsMcpPayloadPreview(bundle: {
  gateway: AdsMcpGatewayConfig
  campaignPayload: PublishBundle['campaignPayload']
  adSetPayload: PublishBundle['adSetPayload']
  adPayload: PublishBundle['adPayload']
  copyPayload: PublishBundle['copyPayload']
  assetSelections: PublishAssetSelection[]
  status: DraftAd['status']
}): AdsMcpPayloadPreview {
  return {
    server: 'meta_ads_mcp',
    version: 'draft_v1',
    operation: 'ads_mcp_tool_sequence_preview',
    connection: {
      endpoint: bundle.gateway.endpointUrl.trim() || META_ADS_MCP_SERVER,
      mode: bundle.gateway.mode,
      adAccountId: bundle.gateway.adAccountId.trim(),
      pixelId: bundle.gateway.pixelId.trim(),
    },
    campaign: {
      name: bundle.campaignPayload.name,
      objective: bundle.campaignPayload.objective,
      buyingType: bundle.campaignPayload.buyingType,
      status: 'paused',
    },
    adSet: {
      name: bundle.adSetPayload.name,
      optimizationGoal: bundle.adSetPayload.optimizationGoal,
      budgetStrategy: bundle.adSetPayload.budgetStrategy,
      placementStrategy: bundle.adSetPayload.placementStrategy,
      audience: {
        type: bundle.adSetPayload.audienceType,
        geo: bundle.adSetPayload.geo,
        ageRange: bundle.adSetPayload.ageRange,
        windowDays: bundle.adSetPayload.audienceWindowDays,
      },
    },
    creative: {
      name: bundle.adPayload.name,
      primaryText: bundle.copyPayload.primaryText,
      headline: bundle.copyPayload.headline,
      description: bundle.copyPayload.description,
      destinationUrl: bundle.copyPayload.destinationUrl,
      assetUrls: bundle.assetSelections.filter((asset) => asset.selected).map((asset) => asset.url),
      selectedPlatforms: bundle.adPayload.selectedPlatforms,
    },
    ad: {
      name: bundle.adPayload.name,
      reviewState: bundle.status,
    },
  }
}

function buildPublishBundle(
  creative: CreativeAsset,
  adsPlan: DraftAd['adsPlan'],
  gateway: AdsMcpGatewayConfig,
): PublishBundle {
  const copyPayload = {
    primaryText: getPrimaryCopy(creative)?.primaryText ?? creative.body,
    headline: getPrimaryCopy(creative)?.headline ?? creative.headline,
    description:
      getPrimaryCopy(creative)?.description ??
      'creative.bktsai.link 已依勾選平台回傳正確尺寸素材。',
    destinationUrl: getDestinationUrl(creative),
  }

  const assetSelections: PublishAssetSelection[] =
    creative.assetDeliverables.length > 0
      ? creative.assetDeliverables.map((asset) => ({
          platform: asset.platform,
          surface: asset.surface,
          aspectRatio: asset.aspectRatio,
          url: asset.url,
          width: asset.width,
          height: asset.height,
          mimeType: asset.mimeType,
          label: `${asset.platform} · ${asset.surface} · ${asset.aspectRatio}`,
          priority: isMetaPlatform(asset.platform) ? 'meta_primary' : 'secondary',
          selected: isMetaPlatform(asset.platform),
        }))
      : creative.selectedPlatforms.map((platform) => ({
          platform,
          surface: 'returned by creative.bktsai.link',
          aspectRatio: 'pending',
          url: '',
          width: null,
          height: null,
          mimeType: null,
          label: `${platform} · pending asset`,
          priority: isMetaPlatform(platform) ? 'meta_primary' : 'secondary',
          selected: isMetaPlatform(platform),
        }))

  const campaignPayload = {
    name: adsPlan.campaign.campaignName,
    objective: adsPlan.campaign.objective,
    funnelStage: adsPlan.campaign.funnelStage,
    market: adsPlan.campaign.market,
    buyingType: 'auction' as const,
  }
  const adSetPayload = {
    name: adsPlan.adSet.adsetName,
    audienceType: adsPlan.adSet.audienceType,
    audienceWindowDays: adsPlan.adSet.audienceWindowDays,
    budgetStrategy: adsPlan.adSet.budgetStrategy,
    optimizationGoal: adsPlan.adSet.optimizationGoal,
    placementStrategy: adsPlan.adSet.placementStrategy,
    geo: adsPlan.adSet.geo,
    ageRange: adsPlan.adSet.ageRange,
  }
  const adPayload = {
    name: adsPlan.ad.adName,
    angleFamily: adsPlan.ad.angleFamily,
    angleLabel: adsPlan.ad.angleLabel,
    copyMode: adsPlan.ad.copyMode,
    selectedPlatforms: creative.selectedPlatforms,
  }
  const checklist = buildPublishChecklist({ copyPayload, assetSelections })

  return {
    campaignPayload,
    adSetPayload,
    adPayload,
    copyPayload,
    assetSelections,
    adsMcpPayload: buildAdsMcpPayloadPreview({
      gateway,
      campaignPayload,
      adSetPayload,
      adPayload,
      copyPayload,
      assetSelections,
      status: 'draft',
    }),
    submission: {
      ...buildSubmissionRecord(),
      mode: gateway.mode,
    },
    checklist,
    lastError: null,
    preparedAt: null,
  }
}

function buildLegacyDraftAdsPlan(
  draft: Pick<DraftAd, 'campaignName' | 'adsetName' | 'adName' | 'metadata'>,
): DraftAd['adsPlan'] {
  const funnelStage: FunnelStage = draft.metadata.useCaseId.includes('member')
    ? 'winback'
    : 'prospecting'
  const objective: CampaignObjective = 'conversions'
  const audienceType: AudienceType = funnelStage === 'winback' ? 'old_leads' : 'broad'
  const audienceWindowDays = getAudienceWindowDays(audienceType)

  return {
    campaign: {
      objective,
      funnelStage,
      productLine: draft.metadata.productName,
      market: draft.metadata.icp || 'TW',
      campaignName: draft.campaignName,
    },
    adSet: {
      audienceType,
      audienceWindowDays,
      geo: resolveFacebookCountryCode(draft.metadata.icp),
      ageRange: '25-45',
      budgetStrategy: getBudgetStrategy(funnelStage),
      optimizationGoal: getOptimizationGoal(funnelStage, objective),
      placementStrategy: 'advantage_plus',
      adsetName: draft.adsetName,
    },
    ad: {
      angleFamily: draft.metadata.useCaseId.startsWith('use-') ? 'use_case' : 'benefit',
      angleLabel: draft.metadata.angleId,
      copyMode:
        draft.adName.includes('Brand') || draft.campaignName.includes('Brand')
          ? '品牌'
          : '轉單',
      adName: draft.adName,
    },
  }
}

function migrateAppState(state: AppState) {
  let changed = false
  const defaultGateway = buildDefaultAdsMcpGateway()
  const storedGateway = state.adsMcpGateway
  const appId = storedGateway?.appId?.trim() ? storedGateway.appId : defaultGateway.appId
  const graphVersion = storedGateway?.graphVersion?.trim()
    ? storedGateway.graphVersion
    : defaultGateway.graphVersion
  const storedEndpointUrl = storedGateway?.endpointUrl?.trim() || ''
  const shouldMigrateLegacyMetaEndpoint =
    storedEndpointUrl === '' || storedEndpointUrl === META_ADS_MCP_SERVER
  const adsMcpGateway = {
    ...defaultGateway,
    ...storedGateway,
    appId,
    graphVersion,
    mode:
      storedGateway?.mode === 'graph_api'
        ? 'remote'
        : storedGateway?.mode === 'demo' && !storedGateway?.endpointUrl?.trim()
          ? defaultGateway.mode
        : (storedGateway?.mode ?? defaultGateway.mode),
    endpointUrl: shouldMigrateLegacyMetaEndpoint
      ? defaultGateway.endpointUrl
      : storedEndpointUrl,
    accessToken: storedGateway?.accessToken ?? null,
    tokenExpiresAt: storedGateway?.tokenExpiresAt ?? null,
    grantedScopes: storedGateway?.grantedScopes ?? [],
    oauthState: storedGateway?.oauthState ?? null,
    connectionStatus: storedGateway?.connectionStatus ?? 'disconnected',
    businessName: storedGateway?.businessName ?? null,
    availableAdAccounts: storedGateway?.availableAdAccounts ?? [],
    availablePixels: storedGateway?.availablePixels ?? [],
    pageId: storedGateway?.pageId ?? '',
    availablePages: storedGateway?.availablePages ?? [],
    lastError: storedGateway?.lastError ?? null,
  }

  if (!storedGateway) {
    changed = true
  }

  if (
    !storedGateway?.connectionStatus ||
    storedGateway?.accessToken === undefined ||
    !storedGateway?.availableAdAccounts ||
    !storedGateway?.availablePixels ||
    storedGateway?.pageId === undefined ||
    !storedGateway?.availablePages ||
    storedGateway?.lastError === undefined ||
    storedGateway?.appId !== appId ||
    storedGateway?.graphVersion !== graphVersion ||
    adsMcpGateway.mode !== storedGateway?.mode ||
    adsMcpGateway.endpointUrl !== storedEndpointUrl
  ) {
    changed = true
  }

  const drafts = state.drafts.map((draft) => {
    const nextDraft: DraftAd = { ...draft } as DraftAd

    if (!nextDraft.adsPlan) {
      changed = true
      nextDraft.adsPlan = buildLegacyDraftAdsPlan(draft)
    }

    if (!nextDraft.publishBundle) {
      changed = true
      const assetSelections: PublishAssetSelection[] = nextDraft.assetDeliverables.map((asset) => ({
        platform: asset.split(':')[0] ?? 'Facebook',
        surface: asset.includes(':') ? asset.split(':').slice(1).join(':').trim() : asset,
        aspectRatio: 'unknown',
        url: '',
        width: null,
        height: null,
        mimeType: null,
        label: asset,
        priority: asset.includes('Facebook') || asset.includes('Instagram') ? 'meta_primary' : 'secondary',
        selected: asset.includes('Facebook') || asset.includes('Instagram'),
      }))
      const copyPayload = {
        primaryText: nextDraft.primaryText,
        headline: nextDraft.headline,
        description: nextDraft.description,
        destinationUrl: nextDraft.destinationUrl,
      }
      nextDraft.publishBundle = {
        campaignPayload: {
          name: nextDraft.campaignName,
          objective: nextDraft.adsPlan.campaign.objective,
          funnelStage: nextDraft.adsPlan.campaign.funnelStage,
          market: nextDraft.metadata.icp || 'TW',
          buyingType: 'auction',
        },
        adSetPayload: {
          name: nextDraft.adsetName,
          audienceType: nextDraft.adsPlan.adSet.audienceType,
          audienceWindowDays: nextDraft.adsPlan.adSet.audienceWindowDays,
          budgetStrategy: nextDraft.adsPlan.adSet.budgetStrategy,
          optimizationGoal: nextDraft.adsPlan.adSet.optimizationGoal,
          placementStrategy: nextDraft.adsPlan.adSet.placementStrategy,
          geo: resolveFacebookCountryCode(nextDraft.metadata.icp),
          ageRange: nextDraft.adsPlan.adSet.ageRange,
        },
        adPayload: {
          name: nextDraft.adName,
          angleFamily: nextDraft.adsPlan.ad.angleFamily,
          angleLabel: nextDraft.adsPlan.ad.angleLabel,
          copyMode: nextDraft.adsPlan.ad.copyMode,
          selectedPlatforms: nextDraft.metadata.selectedPlatforms,
        },
        copyPayload,
        assetSelections,
        adsMcpPayload: buildAdsMcpPayloadPreview({
          gateway: adsMcpGateway,
          campaignPayload: {
            name: nextDraft.campaignName,
            objective: nextDraft.adsPlan.campaign.objective,
            funnelStage: nextDraft.adsPlan.campaign.funnelStage,
            market: nextDraft.metadata.icp || 'TW',
            buyingType: 'auction',
          },
          adSetPayload: {
            name: nextDraft.adsetName,
            audienceType: nextDraft.adsPlan.adSet.audienceType,
            audienceWindowDays: nextDraft.adsPlan.adSet.audienceWindowDays,
            budgetStrategy: nextDraft.adsPlan.adSet.budgetStrategy,
            optimizationGoal: nextDraft.adsPlan.adSet.optimizationGoal,
            placementStrategy: nextDraft.adsPlan.adSet.placementStrategy,
            geo: resolveFacebookCountryCode(nextDraft.metadata.icp),
            ageRange: nextDraft.adsPlan.adSet.ageRange,
          },
          adPayload: {
            name: nextDraft.adName,
            angleFamily: nextDraft.adsPlan.ad.angleFamily,
            angleLabel: nextDraft.adsPlan.ad.angleLabel,
            copyMode: nextDraft.adsPlan.ad.copyMode,
            selectedPlatforms: nextDraft.metadata.selectedPlatforms,
          },
          copyPayload,
          assetSelections,
          status: nextDraft.status,
        }),
        submission: {
          ...buildSubmissionRecord(),
          mode: adsMcpGateway.mode,
        },
        checklist: buildPublishChecklist({ copyPayload, assetSelections }),
        lastError: null,
        preparedAt: nextDraft.status === 'draft' ? null : nextDraft.createdAt,
      }
    }

    if (!nextDraft.publishBundle.submission) {
      changed = true
      nextDraft.publishBundle = {
        ...nextDraft.publishBundle,
        submission: {
          ...buildSubmissionRecord(),
          mode: adsMcpGateway.mode,
        },
      }
    }

    if (
      !nextDraft.publishBundle.adsMcpPayload.connection ||
      !nextDraft.publishBundle.adsMcpPayload.operation
    ) {
      changed = true
      nextDraft.publishBundle = {
        ...nextDraft.publishBundle,
        adsMcpPayload: buildAdsMcpPayloadPreview({
          gateway: adsMcpGateway,
          campaignPayload: nextDraft.publishBundle.campaignPayload,
          adSetPayload: nextDraft.publishBundle.adSetPayload,
          adPayload: nextDraft.publishBundle.adPayload,
          copyPayload: nextDraft.publishBundle.copyPayload,
          assetSelections: nextDraft.publishBundle.assetSelections,
          status: nextDraft.status,
        }),
      }
    }

    if (nextDraft.adsPlan.adSet.geo !== resolveFacebookCountryCode(nextDraft.adsPlan.adSet.geo)) {
      changed = true
      nextDraft.adsPlan = {
        ...nextDraft.adsPlan,
        adSet: {
          ...nextDraft.adsPlan.adSet,
          geo: resolveFacebookCountryCode(nextDraft.adsPlan.adSet.geo),
        },
      }
    }

    if (
      nextDraft.publishBundle.adSetPayload.geo !==
      resolveFacebookCountryCode(nextDraft.publishBundle.adSetPayload.geo)
    ) {
      changed = true
      nextDraft.publishBundle = {
        ...nextDraft.publishBundle,
        adSetPayload: {
          ...nextDraft.publishBundle.adSetPayload,
          geo: resolveFacebookCountryCode(nextDraft.publishBundle.adSetPayload.geo),
        },
      }
    }

    if (nextDraft.publishAttempts === undefined) {
      changed = true
      nextDraft.publishAttempts = nextDraft.status === 'published' ? 1 : 0
    }

    if (nextDraft.status === 'published' && !nextDraft.publishedAt) {
      changed = true
      nextDraft.publishedAt = nextDraft.createdAt
    }

    return nextDraft
  })

  if (!changed) {
    return state
  }

  return {
    ...state,
    adsMcpGateway,
    drafts,
  }
}

function parseAgeRange(ageRange: string) {
  const [min, max] = ageRange.split('-').map((part) => Number.parseInt(part.trim(), 10))
  return {
    ageMin: Number.isFinite(min) ? min : 25,
    ageMax: Number.isFinite(max) ? max : 45,
  }
}

function getCountryCode(geo: string) {
  return resolveFacebookCountryCode(geo)
}

type McpJsonRpcError = {
  code: number
  message: string
  data?: unknown
}

type McpJsonRpcResponse<T> = {
  id?: string | number | null
  jsonrpc?: string
  result?: T
  error?: McpJsonRpcError
}

type MetaErrorPayload = {
  title?: string
  detail?: string
  status?: number
}

type ServerSentEventBlock = {
  event?: string
  data: string[]
}

type McpToolDefinition = {
  name: string
  description?: string
  inputSchema?: {
    type?: string
    required?: string[]
    properties?: Record<string, unknown>
  }
}

type McpToolCallResult = {
  content?: Array<{ type?: string; text?: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

function getAdsMcpEndpoint(gateway: AdsMcpGatewayConfig) {
  return gateway.endpointUrl.trim() || META_ADS_MCP_SERVER
}

function buildAdsMcpHeaders(
  gateway: AdsMcpGatewayConfig,
  sessionId?: string | null,
) {
  return {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    ...(gateway.accessToken ? { Authorization: `Bearer ${gateway.accessToken}` } : {}),
    ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
  }
}

function hasGrantedScope(grantedScopes: string[], scope: string) {
  return grantedScopes.some((item) => item.trim() === scope)
}

async function postAdsMcpRpc<T>(
  gateway: AdsMcpGatewayConfig,
  body: Record<string, unknown>,
  sessionId?: string | null,
): Promise<{ response: McpJsonRpcResponse<T>; sessionId: string | null }> {
  let httpResponse: Response
  try {
    httpResponse = await fetch(getAdsMcpEndpoint(gateway), {
      method: 'POST',
      headers: buildAdsMcpHeaders(gateway, sessionId),
      body: JSON.stringify(body),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Ads MCP relay 無法連線：${message}. 請確認目前 endpoint 是可跨網域的 relay，而不是瀏覽器直連 Meta MCP。`,
    )
  }
  const text = await httpResponse.text()
  const parsed = parseMcpJsonRpcResponse<T>(text)
  const metaError = safeJsonParse<MetaErrorPayload>(text)

  if (!httpResponse.ok) {
    if (
      httpResponse.status === 403 &&
      (metaError?.title === 'Unauthorized Access' || metaError?.detail === 'Unauthorized Access')
    ) {
      throw new Error(
        'Meta Ads MCP 拒絕授權。這通常代表目前 access token 沒有真的取得 `ads_mcp_management`，或這個 Meta app / 使用者尚未被允許使用 Ads MCP。',
      )
    }

    throw new Error(
      metaError?.detail || metaError?.title || text || `Ads MCP request failed with ${httpResponse.status}`,
    )
  }

  if (!parsed) {
    throw new Error(`Ads MCP returned a non-JSON response. Preview: ${buildResponsePreview(text)}`)
  }

  if (parsed.error) {
    throw new Error(parsed.error.message || 'Ads MCP returned an error.')
  }

  return {
    response: parsed,
    sessionId: httpResponse.headers.get('mcp-session-id'),
  }
}

async function initializeAdsMcpSession(gateway: AdsMcpGatewayConfig) {
  if (!gateway.accessToken) {
    throw new Error('Missing Facebook access token.')
  }

  const initialize = await postAdsMcpRpc<{ protocolVersion?: string }>(gateway, {
    jsonrpc: '2.0',
    id: 'initialize',
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: {
        name: 'lihisms-growth-console',
        version: '1.0.0',
      },
    },
  })

  await postAdsMcpRpc(
    gateway,
    {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    },
    initialize.sessionId,
  )

  const toolsList = await postAdsMcpRpc<{ tools?: McpToolDefinition[] }>(
    gateway,
    {
      jsonrpc: '2.0',
      id: 'tools-list',
      method: 'tools/list',
      params: {},
    },
    initialize.sessionId,
  )

  return {
    sessionId: toolsList.sessionId ?? initialize.sessionId,
    tools: toolsList.response.result?.tools ?? [],
  }
}

async function callAdsMcpTool(
  gateway: AdsMcpGatewayConfig,
  sessionId: string | null,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await postAdsMcpRpc<McpToolCallResult>(
    gateway,
    {
      jsonrpc: '2.0',
      id: `tool-${name}`,
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    },
    sessionId,
  )

  return result.response.result ?? {}
}

function mapObjectiveToAdsMcpObjective(objective: CampaignObjective) {
  return objective === 'leads' ? 'OUTCOME_LEADS' : 'OUTCOME_SALES'
}

function mapOptimizationGoalToAdsMcpOptimizationGoal(goal: OptimizationGoal) {
  switch (goal) {
    case 'leads':
      return 'LEAD_GENERATION'
    case 'conversions':
      return 'OFFSITE_CONVERSIONS'
    default:
      return 'LANDING_PAGE_VIEWS'
  }
}

function shapeValueForSchema(value: unknown, schema: unknown): unknown {
  if (!schema || value === undefined) {
    return value
  }

  const typedSchema = schema as {
    type?: string
    properties?: Record<string, unknown>
    items?: unknown
  }

  if (typedSchema.type === 'object' && typedSchema.properties && value && typeof value === 'object') {
    const shaped: Record<string, unknown> = {}
    for (const [key, propertySchema] of Object.entries(typedSchema.properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const nextValue = shapeValueForSchema(
          (value as Record<string, unknown>)[key],
          propertySchema,
        )
        if (nextValue !== undefined) {
          shaped[key] = nextValue
        }
      }
    }
    return shaped
  }

  if (typedSchema.type === 'array' && Array.isArray(value)) {
    return value.map((item) => shapeValueForSchema(item, typedSchema.items))
  }

  return value
}

function buildArgsFromSchema(
  tool: McpToolDefinition | undefined,
  candidates: Record<string, unknown>,
) {
  if (!tool?.inputSchema?.properties) {
    return candidates
  }

  const args: Record<string, unknown> = {}
  const missing: string[] = []

  for (const [propertyName, propertySchema] of Object.entries(tool.inputSchema.properties)) {
    if (Object.prototype.hasOwnProperty.call(candidates, propertyName)) {
      const nextValue = shapeValueForSchema(candidates[propertyName], propertySchema)
      if (nextValue !== undefined) {
        args[propertyName] = nextValue
      }
    }
  }

  for (const requiredName of tool.inputSchema.required ?? []) {
    if (args[requiredName] === undefined) {
      missing.push(requiredName)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `${tool.name} 缺少必要欄位：${missing.join(', ')}。Schema keys: ${Object.keys(
        tool.inputSchema.properties,
      ).join(', ')}`,
    )
  }

  return args
}

function buildAdsMcpPlacements(placementStrategy: PlacementStrategy) {
  if (placementStrategy === 'stories_and_reels') {
    return {
      publisher_platforms: ['facebook', 'instagram'],
      facebook_positions: ['story', 'facebook_reels'],
      instagram_positions: ['story', 'reels'],
    }
  }

  return {
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: ['feed'],
    instagram_positions: ['stream'],
  }
}

function extractMcpStructuredData(result: McpToolCallResult) {
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent
  }

  const textBlock = result.content?.find((item) => item.text?.trim())
  if (!textBlock?.text) {
    return null
  }

  return safeJsonParse<Record<string, unknown>>(textBlock.text) ?? { text: textBlock.text }
}

function extractEntityId(
  data: Record<string, unknown> | null,
  keys: string[],
) {
  if (!data) {
    return null
  }

  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }

  return null
}

function buildFacebookTargeting(bundle: PublishBundle) {
  const { ageMin, ageMax } = parseAgeRange(bundle.adSetPayload.ageRange)
  const targeting: Record<string, unknown> = {
    geo_locations: {
      countries: [getCountryCode(bundle.adSetPayload.geo)],
    },
    age_min: ageMin,
    age_max: ageMax,
    publisher_platforms: ['facebook'],
    facebook_positions:
      bundle.adSetPayload.placementStrategy === 'stories_and_reels'
        ? ['story', 'facebook_reels']
        : ['feed'],
    device_platforms: ['mobile', 'desktop'],
  }

  return targeting
}

async function executeAdsMcpPublish(
  gateway: AdsMcpGatewayConfig,
  payload: AdsMcpPayloadPreview,
): Promise<AdsMcpPublishResult> {
  const requestId = `req_${Math.random().toString(36).slice(2, 10)}`
  const externalCampaignId = `cmp_${Math.abs(stringScore(payload.campaign.name)).toString(36)}`
  const externalAdSetId = `adset_${Math.abs(stringScore(payload.adSet.name)).toString(36)}`
  const externalAdId = `ad_${Math.abs(stringScore(payload.ad.name)).toString(36)}`

  if (gateway.mode === 'demo') {
    await waitAtLeast(DEMO_PUBLISH_LATENCY_MS)

    return {
      requestId,
      responseCode: 200,
      responseBody: JSON.stringify(
        {
          ok: true,
          mode: 'demo',
          endpoint: payload.connection.endpoint,
          ids: {
            campaignId: externalCampaignId,
            adSetId: externalAdSetId,
            adId: externalAdId,
          },
        },
        null,
        2,
      ),
      externalCampaignId,
      externalAdSetId,
      externalAdId,
    }
  }

  const { sessionId, tools } = await initializeAdsMcpSession(gateway)
  const campaignTool = tools.find((tool) => tool.name === 'ads_create_campaign')
  const adSetTool = tools.find((tool) => tool.name === 'ads_create_ad_set')
  const adTool = tools.find((tool) => tool.name === 'ads_create_ad')

  if (!campaignTool || !adSetTool || !adTool) {
    throw new Error(
      `Ads MCP 缺少必要工具。找到: ${tools.map((tool) => tool.name).join(', ') || 'none'}`,
    )
  }

  const selectedImageUrl = payload.creative.assetUrls[0]

  if (!selectedImageUrl) {
    throw new Error('這份 draft 還沒有可投放的 Meta 素材 URL。')
  }

  const campaignArgs = buildArgsFromSchema(campaignTool, {
    ad_account_id: gateway.adAccountId,
    account_id: gateway.adAccountId,
    name: payload.campaign.name,
    objective: mapObjectiveToAdsMcpObjective(payload.campaign.objective),
    special_ad_category: 'NONE',
    special_ad_categories: ['NONE'],
    status: 'PAUSED',
    buying_type: 'AUCTION',
  })
  const campaignResult = await callAdsMcpTool(
    gateway,
    sessionId,
    campaignTool.name,
    campaignArgs,
  )
  const campaignData = extractMcpStructuredData(campaignResult)
  const campaignId =
    extractEntityId(campaignData, ['campaign_id', 'id', 'entity_id']) ?? externalCampaignId

  const adSetArgs = buildArgsFromSchema(adSetTool, {
    ad_account_id: gateway.adAccountId,
    account_id: gateway.adAccountId,
    campaign_id: campaignId,
    name: payload.adSet.name,
    status: 'PAUSED',
    daily_budget: DEFAULT_DAILY_BUDGET_MINOR,
    billing_event: 'IMPRESSIONS',
    optimization_goal: mapOptimizationGoalToAdsMcpOptimizationGoal(payload.adSet.optimizationGoal),
    destination_type: 'WEBSITE',
    page_id: gateway.pageId,
    pixel_id: gateway.pixelId,
    promoted_object: {
      pixel_id: gateway.pixelId,
      custom_event_type:
        payload.campaign.objective === 'leads' ? 'LEAD' : 'COMPLETE_REGISTRATION',
    },
    targeting: {
      ...buildFacebookTargeting({
        campaignPayload: {
          name: payload.campaign.name,
          objective: payload.campaign.objective,
          funnelStage: 'prospecting',
          market: payload.adSet.audience.geo,
          buyingType: 'auction',
        },
        adSetPayload: {
          name: payload.adSet.name,
          audienceType: payload.adSet.audience.type,
          audienceWindowDays: payload.adSet.audience.windowDays,
          budgetStrategy: payload.adSet.budgetStrategy,
          optimizationGoal: payload.adSet.optimizationGoal,
          placementStrategy: payload.adSet.placementStrategy,
          geo: payload.adSet.audience.geo,
          ageRange: payload.adSet.audience.ageRange,
        },
        adPayload: {
          name: payload.ad.name,
          angleFamily: 'benefit',
          angleLabel: payload.ad.name,
          copyMode: '品牌',
          selectedPlatforms: payload.creative.selectedPlatforms,
        },
        copyPayload: {
          primaryText: payload.creative.primaryText,
          headline: payload.creative.headline,
          description: payload.creative.description,
          destinationUrl: payload.creative.destinationUrl,
        },
        assetSelections: [],
        adsMcpPayload: payload,
        submission: buildSubmissionRecord(),
        checklist: {
          hasCopy: true,
          hasDestinationUrl: true,
          hasSelectedAssets: true,
          hasMetaAsset: true,
        },
        lastError: null,
        preparedAt: null,
      }),
      ...buildAdsMcpPlacements(payload.adSet.placementStrategy),
    },
    selected_platforms: payload.creative.selectedPlatforms,
    destination_url: payload.creative.destinationUrl,
  })
  const adSetResult = await callAdsMcpTool(gateway, sessionId, adSetTool.name, adSetArgs)
  const adSetData = extractMcpStructuredData(adSetResult)
  const createdAdSetId =
    extractEntityId(adSetData, ['ad_set_id', 'adset_id', 'id', 'entity_id']) ??
    externalAdSetId

  const adArgs = buildArgsFromSchema(adTool, {
    ad_account_id: gateway.adAccountId,
    account_id: gateway.adAccountId,
    ad_set_id: createdAdSetId,
    adset_id: createdAdSetId,
    page_id: gateway.pageId,
    name: payload.ad.name,
    status: 'PAUSED',
    destination_url: payload.creative.destinationUrl,
    image_url: selectedImageUrl,
    primary_text: payload.creative.primaryText,
    headline: payload.creative.headline,
    description: payload.creative.description,
    creative: {
      page_id: gateway.pageId,
      primary_text: payload.creative.primaryText,
      headline: payload.creative.headline,
      description: payload.creative.description,
      destination_url: payload.creative.destinationUrl,
      link: payload.creative.destinationUrl,
      image_url: selectedImageUrl,
      call_to_action: {
        type: 'LEARN_MORE',
        value: {
          link: payload.creative.destinationUrl,
        },
      },
    },
    object_story_spec: {
      page_id: gateway.pageId,
      link_data: {
        message: payload.creative.primaryText,
        name: payload.creative.headline,
        description: payload.creative.description,
        link: payload.creative.destinationUrl,
        image_url: selectedImageUrl,
        call_to_action: {
          type: 'LEARN_MORE',
          value: {
            link: payload.creative.destinationUrl,
          },
        },
      },
    },
  })
  const adResult = await callAdsMcpTool(gateway, sessionId, adTool.name, adArgs)
  const adData = extractMcpStructuredData(adResult)
  const createdAdId =
    extractEntityId(adData, ['ad_id', 'id', 'entity_id']) ?? externalAdId

  return {
    requestId,
    responseCode: 200,
    responseBody: JSON.stringify(
      {
        ok: true,
        mode: 'remote',
        endpoint: getAdsMcpEndpoint(gateway),
        tools: {
          campaign: campaignTool.name,
          adSet: adSetTool.name,
          ad: adTool.name,
        },
        args: {
          campaign: campaignArgs,
          adSet: adSetArgs,
          ad: adArgs,
        },
        result: {
          campaign: campaignData,
          adSet: adSetData,
          ad: adData,
        },
      },
      null,
      2,
    ),
    externalCampaignId: campaignId,
    externalAdSetId: createdAdSetId,
    externalAdId: createdAdId,
  }
}

function App() {
  const logoUrl = `${import.meta.env.BASE_URL}lihi-logo-primary.png`
  const [persistedState, setState] = usePersistentState<AppState>(STORAGE_KEY, initialState)
  const state = useMemo(() => migrateAppState(persistedState), [persistedState])
  const reviewSectionRef = useRef<HTMLElement | null>(null)
  const structureSectionRef = useRef<HTMLDivElement | null>(null)
  const [selectedKind, setSelectedKind] = useState<LibraryKind>('use_case')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(buildEmptyForm)
  const [batchForm, setBatchForm] = useState(() => buildBatchForm(initialState.library))
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [productImageFile, setProductImageFile] = useState<File | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [batchStatusMessage, setBatchStatusMessage] = useState<string | null>(null)
  const [isGeneratingBatch, setIsGeneratingBatch] = useState(false)
  const [approvingCreativeId, setApprovingCreativeId] = useState<string | null>(null)
  const [isApprovingBatch, setIsApprovingBatch] = useState(false)
  const [publishingDraftId, setPublishingDraftId] = useState<string | null>(null)
  const [publishStatusMessage, setPublishStatusMessage] = useState<string | null>(null)
  const [isConnectingFacebook, setIsConnectingFacebook] = useState(false)
  const [adAccountQuery, setAdAccountQuery] = useState('')
  const [accountStructureSnapshot, setAccountStructureSnapshot] =
    useState<FacebookAccountStructureSnapshot>({
      status: 'idle',
      campaigns: [],
      adSets: [],
      ads: [],
      lastSyncedAt: null,
      error: null,
    })
  const [selectedCampaignId, setSelectedCampaignId] = useState('')
  const [selectedAdSetId, setSelectedAdSetId] = useState('')
  const [structureRefreshKey, setStructureRefreshKey] = useState(0)

  const jumpToStructureSection = () => {
    structureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    if (state !== persistedState) {
      setState(state)
    }
  }, [persistedState, setState, state])

  useEffect(() => {
    if (accountStructureSnapshot.status !== 'ready') {
      return
    }

    jumpToStructureSection()
  }, [accountStructureSnapshot.status])

  useEffect(() => {
    const oauthResult = parseOauthHash(window.location.hash)
    if (
      !oauthResult.accessToken &&
      !oauthResult.error &&
      !oauthResult.grantedScopes &&
      !oauthResult.expiresIn
    ) {
      return
    }

    window.history.replaceState({}, document.title, window.location.pathname + window.location.search)

    if (oauthResult.error) {
      setState((current) => ({
        ...current,
        adsMcpGateway: {
          ...current.adsMcpGateway,
          connectionStatus: 'error',
          lastError: oauthResult.errorDescription || oauthResult.error,
          accessToken: null,
        },
      }))
      setPublishStatusMessage(`Facebook OAuth 失敗：${oauthResult.errorDescription || oauthResult.error}`)
      return
    }

    if (
      state.adsMcpGateway.oauthState &&
      oauthResult.state &&
      state.adsMcpGateway.oauthState !== oauthResult.state
    ) {
      setState((current) => ({
        ...current,
        adsMcpGateway: {
          ...current.adsMcpGateway,
          connectionStatus: 'error',
          lastError: 'OAuth state mismatch.',
          accessToken: null,
        },
      }))
      setPublishStatusMessage('Facebook OAuth 驗證失敗，state mismatch。')
      return
    }

    if (!oauthResult.accessToken) {
      return
    }

    const expiresInSeconds = Number(oauthResult.expiresIn ?? '0')
    const tokenExpiresAt =
      expiresInSeconds > 0 ? new Date(Date.now() + expiresInSeconds * 1000).toISOString() : null
    const grantedScopes = oauthResult.grantedScopes
      ? oauthResult.grantedScopes
          .split(',')
          .map((scope) => scope.trim())
          .filter(Boolean)
      : []

    setState((current) => ({
      ...current,
      adsMcpGateway: {
        ...current.adsMcpGateway,
        accessToken: oauthResult.accessToken,
        tokenExpiresAt,
        grantedScopes,
        connectionStatus: 'fetching_assets',
        lastError: null,
      },
    }))
    setPublishStatusMessage('Facebook OAuth 成功，正在抓取 ad accounts / pages...')
  }, [setState, state.adsMcpGateway.oauthState])

  useEffect(() => {
    if (
      state.adsMcpGateway.connectionStatus !== 'fetching_assets' ||
      !state.adsMcpGateway.accessToken
    ) {
      return
    }

    let cancelled = false

    const run = async () => {
      try {
        let pageFetchError: string | null = null
        const [availableAdAccounts, availablePages] = await Promise.all([
          fetchFacebookAdAccounts(state.adsMcpGateway),
          fetchFacebookPages(state.adsMcpGateway).catch((error) => {
            pageFetchError =
              error instanceof Error ? error.message : 'Failed to fetch Facebook pages.'
            return []
          }),
        ])
        if (cancelled) {
          return
        }

        const nextAdAccountId =
          state.adsMcpGateway.adAccountId || availableAdAccounts[0]?.id || ''
        const nextPageId = state.adsMcpGateway.pageId || availablePages[0]?.id || ''

        setState((current) => ({
          ...current,
          adsMcpGateway: {
            ...current.adsMcpGateway,
            connectionStatus: 'connected',
            businessName: 'Facebook Ads OAuth',
            mode: current.adsMcpGateway.endpointUrl.trim() ? 'remote' : 'demo',
            availableAdAccounts,
            availablePixels: current.adsMcpGateway.availablePixels,
            availablePages,
            adAccountId: nextAdAccountId,
            pixelId: current.adsMcpGateway.pixelId,
            pageId: nextPageId,
            lastError: pageFetchError,
          },
        }))

        let availablePixels: AdsMcpGatewayConfig['availablePixels'] = []
        let pixelFetchError: string | null = null

        if (nextAdAccountId) {
          try {
            availablePixels = await fetchFacebookPixels(state.adsMcpGateway, nextAdAccountId)
          } catch (error) {
            pixelFetchError =
              error instanceof Error ? error.message : 'Failed to fetch Facebook pixels.'
          }
        }

        if (cancelled) {
          return
        }

        setState((current) => ({
          ...current,
          adsMcpGateway: {
            ...current.adsMcpGateway,
            connectionStatus: 'connected',
            businessName: 'Facebook Ads OAuth',
            mode: current.adsMcpGateway.endpointUrl.trim() ? 'remote' : 'demo',
            availableAdAccounts,
            availablePixels:
              availablePixels.length > 0 ? availablePixels : current.adsMcpGateway.availablePixels,
            availablePages,
            adAccountId: nextAdAccountId,
            pixelId:
              current.adsMcpGateway.pixelId ||
              availablePixels[0]?.id ||
              current.adsMcpGateway.availablePixels[0]?.id ||
              '',
            pageId: current.adsMcpGateway.pageId || availablePages[0]?.id || '',
            lastError: pixelFetchError ?? pageFetchError,
          },
        }))
        setPublishStatusMessage(
          pixelFetchError || pageFetchError
            ? `Facebook 已連線，已抓回 ${availableAdAccounts.length} 個 ad account / ${availablePixels.length} 個 pixel / ${availablePages.length} 個 pages，但還有錯誤：${
                pixelFetchError ?? pageFetchError
              }`
            : `Facebook 已連線，已抓回 ${availableAdAccounts.length} 個 ad account / ${availablePixels.length} 個 pixel / ${availablePages.length} 個 pages。`,
        )
      } catch (error) {
        if (cancelled) {
          return
        }

        const message = error instanceof Error ? error.message : 'Failed to fetch Facebook assets.'
        setState((current) => ({
          ...current,
          adsMcpGateway: {
            ...current.adsMcpGateway,
            connectionStatus: 'error',
            lastError: message,
            availableAdAccounts: [],
            availablePixels: [],
            availablePages: [],
            adAccountId: '',
            pixelId: '',
            pageId: '',
          },
        }))
        setPublishStatusMessage(`Facebook account fetch 失敗：${message}`)
      } finally {
        if (!cancelled) {
          setIsConnectingFacebook(false)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [setState, state.adsMcpGateway])

  useEffect(() => {
    if (
      state.adsMcpGateway.connectionStatus !== 'connected' ||
      !state.adsMcpGateway.accessToken ||
      !state.adsMcpGateway.adAccountId
    ) {
      setAccountStructureSnapshot({
        status: 'idle',
        campaigns: [],
        adSets: [],
        ads: [],
        lastSyncedAt: null,
        error: null,
      })
      setSelectedCampaignId('')
      setSelectedAdSetId('')
      return
    }

    let cancelled = false

    setAccountStructureSnapshot((current) => ({
      ...current,
      status: 'loading',
      error: null,
    }))

    const run = async () => {
      try {
        const snapshot = await fetchFacebookAccountStructure(
          state.adsMcpGateway,
          state.adsMcpGateway.adAccountId,
        )

        if (cancelled) {
          return
        }

        const lastSyncedAt = new Date().toISOString()
        setAccountStructureSnapshot({
          status: 'ready',
          campaigns: snapshot.campaigns,
          adSets: snapshot.adSets,
          ads: snapshot.ads,
          lastSyncedAt,
          error: null,
        })
        setSelectedCampaignId((current) =>
          snapshot.campaigns.some((campaign) => campaign.id === current)
            ? current
            : snapshot.campaigns[0]?.id ?? '',
        )
        setSelectedAdSetId((current) =>
          snapshot.adSets.some((adSet) => adSet.id === current) ? current : '',
        )
      } catch (error) {
        if (cancelled) {
          return
        }

        setAccountStructureSnapshot({
          status: 'error',
          campaigns: [],
          adSets: [],
          ads: [],
          lastSyncedAt: null,
          error:
            error instanceof Error ? error.message : 'Failed to fetch Facebook account structure.',
        })
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [
    state.adsMcpGateway.accessToken,
    state.adsMcpGateway.adAccountId,
    state.adsMcpGateway.connectionStatus,
    state.adsMcpGateway.graphVersion,
    structureRefreshKey,
  ])

  const activeLibrary = state.library.filter((record) => record.status === 'active')
  const latestBatch = state.batches[0]

  const batchCreatives = useMemo(() => {
    if (!latestBatch) {
      return []
    }
    return latestBatch.creativeIds
      .map((id) => state.creatives.find((creative) => creative.id === id))
      .filter((creative): creative is CreativeAsset => Boolean(creative))
  }, [latestBatch, state.creatives])

  const approvedReadyForDraft = state.creatives.filter((creative) => {
    const alreadyDrafted = state.drafts.some((draft) => draft.creativeId === creative.id)
    return (
      creative.reviewStatus === 'approved' &&
      creative.formatStatus === 'formats_ready' &&
      creative.selectedPlatforms.length > 0 &&
      !alreadyDrafted
    )
  })

  const funnelTotals = useMemo(() => {
    return state.metrics.reduce(
      (totals, metric) => ({
        spend: totals.spend + metric.spend,
        clicks: totals.clicks + metric.clicks,
        landingPageViews: totals.landingPageViews + metric.landingPageViews,
        registerSubmitted: totals.registerSubmitted + metric.registerSubmitted,
        emailVerifiedSignups:
          totals.emailVerifiedSignups + metric.emailVerifiedSignups,
      }),
      {
        spend: 0,
        clicks: 0,
        landingPageViews: 0,
        registerSubmitted: 0,
        emailVerifiedSignups: 0,
      },
    )
  }, [state.metrics])

  const recommendations = useMemo(
    () => buildRecommendations(state.drafts, state.metrics, state.rules),
    [state.drafts, state.metrics, state.rules],
  )

  const selectedBatchPlatforms = Array.from(
    new Set(batchCreatives.flatMap((creative) => creative.selectedPlatforms)),
  )
  const pendingBatchCreatives = batchCreatives.filter(
    (creative) => creative.selectedPlatforms.length > 0 && creative.assetDeliverables.length === 0,
  )
  const latestBatchDrafts = latestBatch
    ? state.drafts.filter((draft) => draft.batchId === latestBatch.id)
    : []
  const filteredAdAccounts = useMemo(() => {
    const query = adAccountQuery.trim().toLowerCase()
    if (!query) {
      return state.adsMcpGateway.availableAdAccounts
    }

    return state.adsMcpGateway.availableAdAccounts.filter((account) => {
      const haystack = [account.name, account.id, account.accountId, account.currency]
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [adAccountQuery, state.adsMcpGateway.availableAdAccounts])
  const visibleAdAccounts = useMemo(() => {
    if (!state.adsMcpGateway.adAccountId) {
      return filteredAdAccounts
    }

    const normalizedSelectedAdAccountId = normalizeFacebookAdAccountId(state.adsMcpGateway.adAccountId)
    const selectedAccount = state.adsMcpGateway.availableAdAccounts.find(
      (account) => account.id === normalizedSelectedAdAccountId,
    )

    if (
      !selectedAccount ||
      filteredAdAccounts.some((account) => account.id === selectedAccount.id)
    ) {
      return filteredAdAccounts
    }

    return [selectedAccount, ...filteredAdAccounts]
  }, [
    filteredAdAccounts,
    state.adsMcpGateway.adAccountId,
    state.adsMcpGateway.availableAdAccounts,
  ])
  const selectedAdAccount = useMemo(() => {
    const normalizedSelectedAdAccountId = normalizeFacebookAdAccountId(state.adsMcpGateway.adAccountId)
    return state.adsMcpGateway.availableAdAccounts.find(
      (account) => account.id === normalizedSelectedAdAccountId,
    )
  }, [state.adsMcpGateway.adAccountId, state.adsMcpGateway.availableAdAccounts])
  const selectedPixel = useMemo(() => {
    return state.adsMcpGateway.availablePixels.find((pixel) => pixel.id === state.adsMcpGateway.pixelId)
  }, [state.adsMcpGateway.availablePixels, state.adsMcpGateway.pixelId])
  const selectedPage = useMemo(() => {
    return state.adsMcpGateway.availablePages.find((page) => page.id === state.adsMcpGateway.pageId)
  }, [state.adsMcpGateway.availablePages, state.adsMcpGateway.pageId])
  const activeCampaignId = useMemo(() => {
    if (accountStructureSnapshot.campaigns.some((campaign) => campaign.id === selectedCampaignId)) {
      return selectedCampaignId
    }

    return accountStructureSnapshot.campaigns[0]?.id ?? ''
  }, [accountStructureSnapshot.campaigns, selectedCampaignId])
  const campaignScopedAdSets = useMemo(() => {
    return accountStructureSnapshot.adSets.filter((adSet) => adSet.campaignId === activeCampaignId)
  }, [accountStructureSnapshot.adSets, activeCampaignId])
  const activeAdSetId = useMemo(() => {
    if (campaignScopedAdSets.some((adSet) => adSet.id === selectedAdSetId)) {
      return selectedAdSetId
    }

    return campaignScopedAdSets[0]?.id ?? ''
  }, [campaignScopedAdSets, selectedAdSetId])
  const adSetScopedAds = useMemo(() => {
    return accountStructureSnapshot.ads.filter((ad) => ad.adSetId === activeAdSetId)
  }, [accountStructureSnapshot.ads, activeAdSetId])
  const campaignStats = useMemo(() => {
    return new Map(
      accountStructureSnapshot.campaigns.map((campaign) => [
        campaign.id,
        {
          adSetCount: accountStructureSnapshot.adSets.filter(
            (adSet) => adSet.campaignId === campaign.id,
          ).length,
          adCount: accountStructureSnapshot.ads.filter((ad) => ad.campaignId === campaign.id).length,
        },
      ]),
    )
  }, [accountStructureSnapshot.adSets, accountStructureSnapshot.ads, accountStructureSnapshot.campaigns])
  const adSetStats = useMemo(() => {
    return new Map(
      campaignScopedAdSets.map((adSet) => [
        adSet.id,
        accountStructureSnapshot.ads.filter((ad) => ad.adSetId === adSet.id).length,
      ]),
    )
  }, [accountStructureSnapshot.ads, campaignScopedAdSets])
  const publishableDrafts = state.drafts.filter(
    (draft) => draft.status === 'ready_to_publish' || draft.status === 'publishing',
  )
  const gatewayContractPreview = publishableDrafts[0]
    ? buildAdsGatewayContractPreview(publishableDrafts[0].publishBundle.adsMcpPayload)
    : null
  const metaBundleCreatives = useMemo(() => {
    return batchCreatives
      .filter((creative) => creative.reviewStatus === 'approved')
      .map((creative) => {
        const prioritizedAssets = [...creative.assetDeliverables].sort((left, right) => {
          return Number(isMetaPlatform(right.platform)) - Number(isMetaPlatform(left.platform))
        })
        const metaAssetCount = creative.assetDeliverables.filter((asset) =>
          isMetaPlatform(asset.platform),
        ).length
        const metaCopy = creative.copyDeliverables?.meta_ad ?? creative.finalCopy

        return {
          creative,
          prioritizedAssets,
          metaAssetCount,
          metaCopy,
        }
      })
      .filter((entry) => entry.metaCopy || entry.prioritizedAssets.length > 0)
  }, [batchCreatives])
  const validationChecks = useMemo(() => {
    const reviewReturned = batchCreatives.length > 0
    const allPlatformsSelected =
      batchCreatives.length > 0 &&
      batchCreatives.every((creative) => creative.selectedPlatforms.length > 0)
    const allFormatsReady =
      batchCreatives.length > 0 &&
      batchCreatives.every(
        (creative) =>
          creative.reviewStatus === 'approved' &&
          creative.assetDeliverables.length > 0 &&
          Boolean(creative.copyDeliverables?.meta_ad ?? creative.finalCopy),
      )
    const draftsBuilt = latestBatch
      ? latestBatchDrafts.length === batchCreatives.length && batchCreatives.length > 0
      : false

    return [
      {
        label: 'Stage 1 review 已回來',
        detail: reviewReturned
          ? `${batchCreatives.length} 組 creative 已回傳`
          : '還沒有 review creatives',
        done: reviewReturned,
      },
      {
        label: '平台已選齊',
        detail: allPlatformsSelected
          ? '這一批每張 creative 都已有平台'
          : '還有 creative 尚未選平台',
        done: allPlatformsSelected,
      },
      {
        label: 'Meta 版位與文案已回來',
        detail: allFormatsReady
          ? '每張 creative 都已有 Meta copy 與展開版位'
          : '還有 creative 尚未完成 generate-formats',
        done: allFormatsReady,
      },
      {
        label: 'Draft 已建好',
        detail: draftsBuilt
          ? `${latestBatchDrafts.length} 組 draft 已建立`
          : '還沒把這批 approved creatives 建成 draft',
        done: draftsBuilt,
      },
    ]
  }, [batchCreatives, latestBatch, latestBatchDrafts])

  useEffect(() => {
    if (!isGeneratingBatch && batchCreatives.length === 0) {
      return
    }

    reviewSectionRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }, [batchCreatives.length, isGeneratingBatch])

  const handleSaveRecord = () => {
    if (!form.title.trim() || !form.summary.trim()) {
      return
    }

    const timestamp = new Date().toISOString()
    const nextRecord: StrategyRecord = {
      id: editingId ?? `record-${timestamp}`,
      kind: form.kind,
      title: form.title.trim(),
      summary: form.summary.trim(),
      notes: form.notes.trim(),
      standardTags: form.standardTags,
      freeformTags: form.freeformTags
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      status: 'active',
      createdAt:
        state.library.find((record) => record.id === editingId)?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }

    setState((current) => ({
      ...current,
      library: editingId
        ? current.library.map((record) =>
            record.id === editingId ? nextRecord : record,
          )
        : [nextRecord, ...current.library],
    }))

    setEditingId(null)
    setForm(buildEmptyForm())
  }

  const handleEditRecord = (record: StrategyRecord) => {
    setEditingId(record.id)
    setForm({
      kind: record.kind,
      title: record.title,
      summary: record.summary,
      notes: record.notes,
      standardTags: record.standardTags,
      freeformTags: record.freeformTags.join(', '),
    })
  }

  const handleArchiveRecord = (recordId: string) => {
    setState((current) => ({
      ...current,
      library: current.library.map((record) =>
        record.id === recordId ? { ...record, status: 'archived' } : record,
      ),
    }))
  }

  const handleUseCaseChange = (useCaseId: string) => {
    setBatchForm((current) => ({
      ...current,
      useCaseId,
    }))
  }

  const handleAssetUpload = (
    field: 'logoAsset' | 'productAsset',
    fileList: FileList | null,
  ) => {
    const file = fileList?.[0]

    if (field === 'logoAsset') {
      setLogoFile(file ?? null)
      return setBatchForm((current) => ({
        ...current,
        logoAsset: file?.name ?? '',
      }))
    }

    setProductImageFile(file ?? null)

    setBatchForm((current) => ({
      ...current,
      productAsset: file?.name ?? '',
    }))
  }

  const handleGenerateBatch = async () => {
    if (
      !batchForm.useCaseId ||
      !batchForm.productName.trim() ||
      batchForm.benefitIds.length < 3 ||
      !logoFile
    ) {
      setRequestError('請填完產品名稱、至少 3 個 benefits，並上傳 logo。')
      return
    }

    const timestamp = new Date().toISOString()
    const useCase = activeLibrary.find((record) => record.id === batchForm.useCaseId)
    const benefits = batchForm.benefitIds
      .map((id) => activeLibrary.find((record) => record.id === id))
      .filter((record): record is StrategyRecord => Boolean(record))

    if (!useCase || benefits.length < 3) {
      setRequestError('目前的 use case / benefits 不完整，請重新確認。')
      return
    }

    const angleId = `ANGLE-${slugify(useCase.title)}-${slugify(benefits[0].title)}`
      .toUpperCase()
      .slice(0, 28)
    const productName = batchForm.productName.trim()
    const productLink = batchForm.productLink.trim()
    const logoAsset = logoFile.name
    const productAsset = productImageFile?.name ?? ''
    const additionalNotes = batchForm.additionalNotes.trim()

    const payload = new FormData()
    payload.append('productName', productName)
    payload.append('useCaseId', useCase.id)
    payload.append('useCaseTitle', useCase.title)
    payload.append('benefitIds', JSON.stringify(batchForm.benefitIds))
    payload.append('benefitTitles', JSON.stringify(benefits.map((benefit) => benefit.title)))
    payload.append('productLink', productLink)
    payload.append('additionalNotes', additionalNotes)
    payload.append('logo', logoFile)

    if (productImageFile) {
      payload.append('productImage', productImageFile)
    }

    setRequestError(null)
    setBatchStatusMessage('正在送到 creative.bktsai.link，等待 3 組審稿素材回傳…')
    setIsGeneratingBatch(true)

    try {
      const [response] = await Promise.all([
        fetch(`${CREATIVE_API_BASE}/generate-review`, {
          method: 'POST',
          body: payload,
        }),
        waitAtLeast(900),
      ])

      if (!response.ok) {
        throw new Error(await readErrorMessage(response))
      }

      const result = (await response.json()) as ReviewResponse
      const creativeIds = result.creatives.map((creative) => `${result.batchId}:${creative.creativeId}`)
      const batch: CreativeBatch = {
        id: result.batchId,
        useCaseId: useCase.id,
        productName,
        benefitIds: batchForm.benefitIds,
        angleId,
        promptVersion: result.promptVersion,
        productLink,
        logoAsset,
        productAsset,
        additionalNotes,
        createdAt: timestamp,
        creativeIds,
      }

      const creatives: CreativeAsset[] = result.creatives.map((creative) => ({
        id: `${result.batchId}:${creative.creativeId}`,
        sourceCreativeId: creative.creativeId,
        batchId: result.batchId,
        angleId,
        creativeVersion: creative.creativeVersion,
        stylePreset: creative.stylePreset ?? creative.visualMode,
        talent: creative.talent ?? 'none',
        tone: creative.tone ?? (creative.copyMode === '轉單' ? 'conversion' : 'brand'),
        voiceBalance: creative.voiceBalance ?? Math.max(1, Math.min(5, 6 - creative.emotionalIntensity)),
        headline: creative.headline,
        kicker: creative.kicker,
        body: creative.body,
        deliveryNote: creative.deliveryNote,
        visualMode: creative.visualMode,
        squareAsset: creative.squareAsset.url,
        formatStatus: 'square_only',
        selectedPlatforms: [],
        copyMode: creative.copyMode,
        emotionalIntensity: creative.emotionalIntensity,
        modelSetting: creative.modelSetting,
        finalCopy: null,
        copyDeliverables: null,
        assetDeliverables: [],
        metadata: {
          icp: '電商品牌',
          useCaseId: useCase.id,
          productName,
          benefitIds: batchForm.benefitIds,
          productLink,
          logoAsset,
          productAsset,
          additionalNotes,
          createdAt: timestamp,
        },
        promptVersion: result.promptVersion,
        reviewStatus: 'pending',
        rejectionReason: null,
      }))

      setState((current) => ({
        ...current,
        batches: [batch, ...current.batches],
        creatives: [...creatives, ...current.creatives],
      }))
      setBatchStatusMessage(`已回傳 ${result.creatives.length} 組審稿素材，請先人工審核再選平台。`)
    } catch (error) {
      setBatchStatusMessage(null)
      setRequestError(error instanceof Error ? error.message : '批次生成失敗。')
    } finally {
      setIsGeneratingBatch(false)
    }
  }

  const rejectCreative = (creativeId: string, reason: string) => {
    setState((current) => ({
      ...current,
      creatives: current.creatives.map((creative) =>
        creative.id === creativeId
          ? {
              ...creative,
              reviewStatus: 'rejected',
              rejectionReason: reason,
              formatStatus: 'square_only',
            }
          : creative,
      ),
    }))
  }

  const toggleBatchPlatform = (platform: Platform) => {
    if (!latestBatch) {
      return
    }

    setState((current) => ({
      ...current,
      creatives: current.creatives.map((creative) => {
        if (!latestBatch.creativeIds.includes(creative.id)) {
          return creative
        }

        const selectedPlatforms = creative.selectedPlatforms.includes(platform)
          ? creative.selectedPlatforms.filter((item) => item !== platform)
          : [...creative.selectedPlatforms, platform]

        return {
          ...creative,
          selectedPlatforms,
          formatStatus:
            creative.reviewStatus === 'approved' && selectedPlatforms.length > 0
              ? 'formats_ready'
              : 'square_only',
        }
      }),
    }))
  }

  const requestFormatsForCreative = async (creative: CreativeAsset) => {
    let response: Response

    try {
      response = await fetch(`${CREATIVE_API_BASE}/generate-formats`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          batchId: creative.batchId,
          creativeId: creative.sourceCreativeId,
          selectedPlatforms: creative.selectedPlatforms,
        }),
      })
    } catch (error) {
      throw new Error(
        `素材 ${creative.creativeVersion} 連線失敗，請再試一次。${
          error instanceof Error && error.message ? ` (${error.message})` : ''
        }`,
      )
    }

    if (!response.ok) {
      throw new Error(await readErrorMessage(response))
    }

    return (await response.json()) as FormatsResponse
  }

  const applyFormatsResult = (creativeId: string, result: FormatsResponse) => {
    const primaryCopy = result.copyDeliverables?.meta_ad ?? result.finalCopy ?? null

    setState((current) => ({
      ...current,
      creatives: current.creatives.map((item) =>
        item.id === creativeId
          ? {
              ...item,
              reviewStatus: 'approved',
              rejectionReason: null,
              formatStatus: 'formats_ready',
              finalCopy: primaryCopy,
              copyDeliverables: result.copyDeliverables ?? null,
              assetDeliverables: result.assetDeliverables,
            }
          : item,
      ),
    }))
  }

  const approveCreative = async (creativeId: string) => {
    const creative = state.creatives.find((item) => item.id === creativeId)
    if (!creative || creative.selectedPlatforms.length === 0) {
      setRequestError('請先選至少 1 個平台，再按 Approved。')
      return
    }

    setRequestError(null)
    setApprovingCreativeId(creativeId)

    try {
      const result = await requestFormatsForCreative(creative)
      applyFormatsResult(creativeId, result)
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : '版位生成失敗。')
    } finally {
      setApprovingCreativeId(null)
    }
  }

  const approveBatchCreatives = async () => {
    if (pendingBatchCreatives.length === 0) {
      setRequestError('請先選至少 1 個平台，再按 Approve all。')
      return
    }

    setRequestError(null)
    setIsApprovingBatch(true)

    try {
      const failures: string[] = []
      let successCount = 0

      for (const creative of pendingBatchCreatives) {
        try {
          const result = await requestFormatsForCreative(creative)
          applyFormatsResult(creative.id, result)
          successCount += 1
        } catch (error) {
          failures.push(
            error instanceof Error
              ? `${creative.creativeVersion}: ${error.message}`
              : `${creative.creativeVersion}: 版位生成失敗。`,
          )
        }
      }

      if (successCount > 0 && failures.length === 0) {
        setBatchStatusMessage(`已完成 ${successCount} 組版位素材。`)
      } else if (successCount > 0) {
        setBatchStatusMessage(`已完成 ${successCount} 組版位素材，${failures.length} 組失敗。`)
        setRequestError(failures.join(' | '))
      } else if (failures.length > 0) {
        setRequestError(failures.join(' | '))
      }
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : '整批版位生成失敗。')
    } finally {
      setIsApprovingBatch(false)
    }
  }

  const createDraftAds = () => {
    if (approvedReadyForDraft.length === 0) {
      return
    }

    const createdAt = new Date().toISOString()

    const newDrafts: DraftAd[] = approvedReadyForDraft.map((creative) => {
      const adsPlan = buildAdsPlan(creative)
      const publishBundle = buildPublishBundle(creative, adsPlan, state.adsMcpGateway)

      return {
        id: `draft-${creative.id}`,
        creativeId: creative.id,
        batchId: creative.batchId,
        status: 'draft',
        campaignName: adsPlan.campaign.campaignName,
        adsetName: adsPlan.adSet.adsetName,
        adName: adsPlan.ad.adName,
        primaryText: getPrimaryCopy(creative)?.primaryText ?? creative.body,
        headline: getPrimaryCopy(creative)?.headline ?? creative.headline,
        description:
          getPrimaryCopy(creative)?.description ??
          'creative.bktsai.link 已依勾選平台回傳正確尺寸素材。',
        destinationUrl: getDestinationUrl(creative),
        assetDeliverables: buildAssetDeliverables(creative),
        publishBundle,
        adsPlan,
        metadata: {
          icp: creative.metadata.icp,
          useCaseId: creative.metadata.useCaseId,
          productName: creative.metadata.productName,
          benefitIds: creative.metadata.benefitIds,
          angleId: creative.angleId,
          creativeVersion: creative.creativeVersion,
          selectedPlatforms: creative.selectedPlatforms,
          createdAt,
        },
        createdAt,
        publishAttempts: 0,
        publishedAt: null,
      }
    })

    setState((current) => ({
      ...current,
      drafts: [...newDrafts, ...current.drafts],
    }))
  }

  const updateAdsMcpGateway = (patch: Partial<AdsMcpGatewayConfig>) => {
    setState((current) => {
      const nextGateway = {
        ...current.adsMcpGateway,
        ...patch,
      }

      return {
        ...current,
        adsMcpGateway: nextGateway,
        drafts: current.drafts.map((draft) => ({
          ...draft,
          publishBundle: {
            ...draft.publishBundle,
            adsMcpPayload: buildAdsMcpPayloadPreview({
              gateway: nextGateway,
              campaignPayload: draft.publishBundle.campaignPayload,
              adSetPayload: draft.publishBundle.adSetPayload,
              adPayload: draft.publishBundle.adPayload,
              copyPayload: draft.publishBundle.copyPayload,
              assetSelections: draft.publishBundle.assetSelections,
              status: draft.status,
            }),
            submission: draft.publishBundle.submission.requestId
              ? draft.publishBundle.submission
              : {
                  ...draft.publishBundle.submission,
                  mode: nextGateway.mode,
                },
          },
        })),
      }
    })
  }

  const connectFacebookAds = async () => {
    if (!state.adsMcpGateway.appId.trim()) {
      setPublishStatusMessage('缺少 VITE_FACEBOOK_APP_ID，還不能啟動 Facebook OAuth。')
      return
    }

    const oauthState = `fb_${Math.random().toString(36).slice(2, 12)}`
    setIsConnectingFacebook(true)
    setState((current) => ({
      ...current,
      adsMcpGateway: {
        ...current.adsMcpGateway,
        oauthState,
        connectionStatus: 'authorizing',
        lastError: null,
      },
    }))
    window.location.assign(buildFacebookOauthUrl(state.adsMcpGateway, oauthState))
  }

  const disconnectFacebookAds = () => {
    setState((current) => ({
      ...current,
      adsMcpGateway: {
        ...current.adsMcpGateway,
        mode: current.adsMcpGateway.endpointUrl.trim() ? 'remote' : 'demo',
        connectionStatus: 'disconnected',
        businessName: null,
        availableAdAccounts: [],
        availablePixels: [],
        availablePages: [],
        adAccountId: '',
        pixelId: '',
        pageId: '',
        accessToken: null,
        tokenExpiresAt: null,
        grantedScopes: [],
        oauthState: null,
        lastError: null,
      },
    }))
    setIsConnectingFacebook(false)
    setPublishStatusMessage('已清除 Facebook 連線。')
  }

  const selectFacebookAdAccount = async (adAccountId: string) => {
    setIsConnectingFacebook(true)
    updateAdsMcpGateway({
      adAccountId,
      pixelId: '',
      availablePixels: [],
      lastError: null,
    })

    try {
      const availablePixels = await fetchFacebookPixels(
        {
          ...state.adsMcpGateway,
          adAccountId,
        },
        adAccountId,
      )

      updateAdsMcpGateway({
        adAccountId,
        availablePixels,
        pixelId: availablePixels[0]?.id ?? '',
        connectionStatus: 'connected',
      })
      setPublishStatusMessage('已更新 ad account，並重新抓回 pixels。')
    } catch (error) {
      updateAdsMcpGateway({
        connectionStatus: 'error',
        lastError: error instanceof Error ? error.message : 'Failed to fetch pixels.',
      })
      setPublishStatusMessage(
        `Pixel 抓取失敗：${error instanceof Error ? error.message : 'unknown error'}`,
      )
    } finally {
      setIsConnectingFacebook(false)
    }
  }

  const selectFacebookPage = (pageId: string) => {
    updateAdsMcpGateway({
      pageId,
      lastError: null,
    })
    setPublishStatusMessage('已更新 Facebook Page，之後 publish 會用這個 Page 建 ad creative。')
  }

  const prepareDraftForPublish = (draftId: string) => {
    const timestamp = new Date().toISOString()
    setState((current) => ({
      ...current,
      drafts: current.drafts.map((draft) => {
        if (draft.id !== draftId) {
          return draft
        }

        const checklist = buildPublishChecklist({
          copyPayload: draft.publishBundle.copyPayload,
          assetSelections: draft.publishBundle.assetSelections,
        })

        return {
          ...draft,
          status:
            checklist.hasCopy &&
            checklist.hasDestinationUrl &&
            checklist.hasSelectedAssets
              ? 'ready_to_publish'
              : 'failed',
          publishBundle: {
            ...draft.publishBundle,
            adsMcpPayload: buildAdsMcpPayloadPreview({
              gateway: current.adsMcpGateway,
              campaignPayload: draft.publishBundle.campaignPayload,
              adSetPayload: draft.publishBundle.adSetPayload,
              adPayload: draft.publishBundle.adPayload,
              copyPayload: draft.publishBundle.copyPayload,
              assetSelections: draft.publishBundle.assetSelections,
              status:
                checklist.hasCopy &&
                checklist.hasDestinationUrl &&
                checklist.hasSelectedAssets
                  ? 'ready_to_publish'
                  : 'failed',
            }),
            submission: {
              ...buildSubmissionRecord(),
              mode: current.adsMcpGateway.mode,
            },
            checklist,
            preparedAt: timestamp,
            lastError:
              checklist.hasCopy &&
              checklist.hasDestinationUrl &&
              checklist.hasSelectedAssets
                ? null
                : 'Publish bundle 缺少必要 copy、URL 或素材選擇。',
          },
        }
      }),
    }))
  }

  const publishDraftToAdsMcp = async (draftId: string) => {
    const draft = state.drafts.find((item) => item.id === draftId)
    if (!draft) {
      return
    }

    if (state.adsMcpGateway.connectionStatus !== 'connected') {
      setPublishStatusMessage('請先完成 Facebook 連線，再送出 publish。')
      return
    }

    if (
      state.adsMcpGateway.mode === 'remote' &&
      !hasGrantedScope(state.adsMcpGateway.grantedScopes, 'ads_mcp_management')
    ) {
      setPublishStatusMessage(
        `目前 token 沒有拿到 ads_mcp_management。請先 Reconnect Facebook，並確認授權 scopes 真的包含 ads_mcp_management。現在拿到的是：${
          state.adsMcpGateway.grantedScopes.join(', ') || 'none'
        }`,
      )
      return
    }

    if (
      !state.adsMcpGateway.adAccountId.trim() ||
      !state.adsMcpGateway.pixelId.trim() ||
      !state.adsMcpGateway.pageId.trim()
    ) {
      setPublishStatusMessage('請先選擇 ad account、pixel 與 Facebook Page。')
      return
    }

    if (
      state.adsMcpGateway.mode === 'remote' &&
      (!state.adsMcpGateway.endpointUrl.trim() ||
        !state.adsMcpGateway.adAccountId.trim() ||
        !state.adsMcpGateway.pixelId.trim() ||
        !state.adsMcpGateway.pageId.trim())
    ) {
      setPublishStatusMessage('Remote mode 需要 endpoint、ad account id、pixel id、page id 才能送出。')
      return
    }

    const submittedAt = new Date().toISOString()
    setPublishingDraftId(draftId)
    setPublishStatusMessage(
      `正在送出 ${draft.publishBundle.adPayload.name} 到 ${
        state.adsMcpGateway.mode === 'demo'
          ? 'demo gateway'
          : 'Meta Ads MCP'
      }...`,
    )

    setState((current) => ({
      ...current,
      drafts: current.drafts.map((item) =>
        item.id === draftId
          ? {
              ...item,
              status: 'publishing',
              publishAttempts: item.publishAttempts + 1,
              publishBundle: {
                ...item.publishBundle,
                adsMcpPayload: buildAdsMcpPayloadPreview({
                  gateway: current.adsMcpGateway,
                  campaignPayload: item.publishBundle.campaignPayload,
                  adSetPayload: item.publishBundle.adSetPayload,
                  adPayload: item.publishBundle.adPayload,
                  copyPayload: item.publishBundle.copyPayload,
                  assetSelections: item.publishBundle.assetSelections,
                  status: 'publishing',
                }),
                submission: {
                  ...item.publishBundle.submission,
                  mode: current.adsMcpGateway.mode,
                  submittedAt,
                  completedAt: null,
                  responseCode: null,
                  responseBody: null,
                },
                lastError: null,
              },
            }
          : item,
      ),
    }))

    try {
      const payload = buildAdsMcpPayloadPreview({
        gateway: state.adsMcpGateway,
        campaignPayload: draft.publishBundle.campaignPayload,
        adSetPayload: draft.publishBundle.adSetPayload,
        adPayload: draft.publishBundle.adPayload,
        copyPayload: draft.publishBundle.copyPayload,
        assetSelections: draft.publishBundle.assetSelections,
        status: 'publishing',
      })
      const result = await executeAdsMcpPublish(state.adsMcpGateway, payload)
      const completedAt = new Date().toISOString()

      setState((current) => ({
        ...current,
        adsMcpGateway: {
          ...current.adsMcpGateway,
          lastValidatedAt: completedAt,
        },
        drafts: current.drafts.map((item) =>
          item.id === draftId
            ? {
                ...item,
                status: 'published',
                publishedAt: completedAt,
                publishBundle: {
                  ...item.publishBundle,
                  adsMcpPayload: buildAdsMcpPayloadPreview({
                    gateway: current.adsMcpGateway,
                    campaignPayload: item.publishBundle.campaignPayload,
                    adSetPayload: item.publishBundle.adSetPayload,
                    adPayload: item.publishBundle.adPayload,
                    copyPayload: item.publishBundle.copyPayload,
                    assetSelections: item.publishBundle.assetSelections,
                    status: 'published',
                  }),
                  submission: {
                    mode: current.adsMcpGateway.mode,
                    requestId: result.requestId,
                    submittedAt,
                    completedAt,
                    responseCode: result.responseCode,
                    responseBody: result.responseBody,
                    externalCampaignId: result.externalCampaignId,
                    externalAdSetId: result.externalAdSetId,
                    externalAdId: result.externalAdId,
                  },
                  preparedAt: item.publishBundle.preparedAt ?? submittedAt,
                  lastError: null,
                },
              }
            : item,
        ),
      }))

      setPublishStatusMessage(`已送出 ${draft.publishBundle.adPayload.name}，並回寫 published 狀態。`)
    } catch (error) {
      const completedAt = new Date().toISOString()
      const message = error instanceof Error ? error.message : 'Ads MCP publish failed'

      setState((current) => ({
        ...current,
        drafts: current.drafts.map((item) =>
          item.id === draftId
            ? {
                ...item,
                status: 'failed',
                publishBundle: {
                  ...item.publishBundle,
                  adsMcpPayload: buildAdsMcpPayloadPreview({
                    gateway: current.adsMcpGateway,
                    campaignPayload: item.publishBundle.campaignPayload,
                    adSetPayload: item.publishBundle.adSetPayload,
                    adPayload: item.publishBundle.adPayload,
                    copyPayload: item.publishBundle.copyPayload,
                    assetSelections: item.publishBundle.assetSelections,
                    status: 'failed',
                  }),
                  submission: {
                    ...item.publishBundle.submission,
                    mode: current.adsMcpGateway.mode,
                    submittedAt,
                    completedAt,
                    responseBody: message,
                  },
                  lastError: message,
                },
              }
            : item,
        ),
      }))
      setPublishStatusMessage(`送出失敗：${message}`)
    } finally {
      setPublishingDraftId(null)
    }
  }

  const syncAirbyteDemo = () => {
    const publishedDrafts = state.drafts.filter((draft) => draft.status === 'published')
    if (publishedDrafts.length === 0) {
      return
    }

    const syncedAt = new Date().toISOString()
    const metrics: AnalyticsMetric[] = publishedDrafts.map((draft) => {
      const useCaseTitle =
        lookupRecord(state.library, draft.metadata.useCaseId)?.title ?? '會員喚回'
      const benefitTitle =
        lookupRecord(state.library, draft.metadata.benefitIds[0])?.title ?? '可追蹤點擊'
      const seed = stringScore(
        `${draft.id}${useCaseTitle}${benefitTitle}${draft.metadata.selectedPlatforms.join('')}`,
      )
      const impressions = 2200 + (seed % 4200)
      const frequency = 1.2 + ((seed % 33) / 10)
      const ctr = 0.9 + ((seed % 30) / 10)
      const clicks = Math.round((impressions * ctr) / 100)
      const spend = 36 + ((seed % 1100) / 10)
      const landingPageViews = Math.max(18, Math.round(clicks * 0.72))
      const registerSubmitted = Math.max(6, Math.round(landingPageViews * 0.36))
      const emailVerifiedSignups = Math.max(2, Math.round(registerSubmitted * 0.62))
      const cpc = spend / Math.max(clicks, 1)
      const costPerVerifiedSignup = spend / Math.max(emailVerifiedSignups, 1)

      return {
        id: `metric-${draft.id}`,
        draftId: draft.id,
        creativeId: draft.creativeId,
        spend,
        impressions,
        frequency,
        clicks,
        ctr,
        cpc,
        landingPageViews,
        registerSubmitted,
        emailVerifiedSignups,
        costPerVerifiedSignup,
        syncedAt,
      }
    })

    setState((current) => ({
      ...current,
      metrics,
    }))
  }

  const updateRules = (patch: Partial<OptimizationRules>) => {
    setState((current) => ({
      ...current,
      rules: {
        ...current.rules,
        ...patch,
      },
    }))
  }

  const resetDemo = () => {
    setState(initialState)
    setEditingId(null)
    setForm(buildEmptyForm())
    setBatchForm(buildBatchForm(initialState.library))
    setLogoFile(null)
    setProductImageFile(null)
    setRequestError(null)
    setBatchStatusMessage(null)
    setIsGeneratingBatch(false)
    setApprovingCreativeId(null)
  }

  return (
    <div className="shell">
      <header className="hero-panel">
        <div className="brand-cluster">
          <img
            className="brand-mark"
            src={logoUrl}
            alt="lihi"
          />
          <div>
            <p className="eyebrow">lihiSMS growth operating console</p>
            <h1>把素材、draft、數據、建議，收進同一條可回溯的成長流水線。</h1>
            <p className="hero-note">
              系統先把 use case、benefits、產品連結與補充內容送進
              {' '}
              creative.bktsai.link，先回 1:1 審稿，再由你選平台與核准延伸版位。
            </p>
          </div>
          <div className="hero-metrics">
            <article>
              <span>Main KPI</span>
              <strong>email verified signup</strong>
            </article>
            <article>
              <span>Main ICP</span>
              <strong>電商品牌</strong>
            </article>
            <article>
              <span>Control mode</span>
              <strong>先審稿，再補齊版位與 draft</strong>
            </article>
          </div>
        </div>

        <section className="hero-contract" aria-label="Operating contract">
          <div className="hero-contract-header">
            <p className="eyebrow">Operating contract</p>
            <h2>第一版邊界</h2>
          </div>
          <ul>
            <li>每次送 1 個 use case，搭配 3 到 5 個 benefits。</li>
            <li>必帶產品或服務連結，logo 必填，產品圖可選填。</li>
            <li>creative.bktsai.link 先回傳文案與 1:1，審核通過再補其他尺寸。</li>
            <li>選好平台後按 Approved，最後再 Build drafts from approved creatives。</li>
          </ul>
        </section>
      </header>

      <main className="dashboard">
        <section className="panel span-two">
          <div className="panel-header">
            <div>
              <p className="eyebrow">01 / Strategy library</p>
              <h2>策略資料庫</h2>
            </div>
            <button className="ghost-button" type="button" onClick={resetDemo}>
              Reset demo state
            </button>
          </div>

          <div className="library-layout">
            <div className="library-stack">
              <div className="library-filters">
                {(['use_case', 'benefit'] as LibraryKind[]).map(
                  (kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={selectedKind === kind ? 'chip active' : 'chip'}
                      onClick={() => setSelectedKind(kind)}
                    >
                      {kind}
                    </button>
                  ),
                )}
              </div>

              <div className="library-list">
                {state.library
                  .filter((record) => record.kind === selectedKind)
                  .map((record) => (
                    <article key={record.id} className="library-card">
                      <div className="library-card-top">
                        <div>
                          <h3>{record.title}</h3>
                          <p>{record.summary}</p>
                        </div>
                        <span className={record.status === 'active' ? 'pill active' : 'pill muted'}>
                          {record.status}
                        </span>
                      </div>
                      <div className="tag-row">
                        {record.standardTags.map((tag) => (
                          <span key={tag} className="tag">
                            {tag}
                          </span>
                        ))}
                        {record.freeformTags.map((tag) => (
                          <span key={tag} className="tag subtle">
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="library-card-actions">
                        <button type="button" className="mini-button" onClick={() => handleEditRecord(record)}>
                          Edit
                        </button>
                        {record.status === 'active' ? (
                          <button
                            type="button"
                            className="mini-button danger"
                            onClick={() => handleArchiveRecord(record.id)}
                          >
                            Archive
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))}
              </div>
            </div>

            <aside className="editor-card">
              <p className="eyebrow">{editingId ? 'Edit record' : 'Add record'}</p>
              <label>
                Kind
                <select
                  value={form.kind}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      kind: event.target.value as LibraryKind,
                      standardTags: [],
                    }))
                  }
                >
                  <option value="use_case">use_case</option>
                  <option value="benefit">benefit</option>
                </select>
              </label>
              <label>
                Title
                <input
                  value={form.title}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </label>
              <label>
                Summary
                <textarea
                  rows={4}
                  value={form.summary}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      summary: event.target.value,
                    }))
                  }
                />
              </label>
              <div>
                <span className="field-label">Standard tags</span>
                <div className="checkbox-grid">
                  {standardTagBank[form.kind].map((tag) => (
                    <label key={tag} className="check-chip">
                      <input
                        type="checkbox"
                        checked={form.standardTags.includes(tag)}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            standardTags: event.target.checked
                              ? [...current.standardTags, tag]
                              : current.standardTags.filter((item) => item !== tag),
                          }))
                        }
                      />
                      <span>{tag}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label>
                Freeform tags
                <input
                  placeholder="comma, separated, notes"
                  value={form.freeformTags}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      freeformTags: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Notes
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, notes: event.target.value }))
                  }
                />
              </label>
              <button className="primary-button" type="button" onClick={handleSaveRecord}>
                {editingId ? 'Update record' : 'Save record'}
              </button>
            </aside>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">02 / Creative batch</p>
              <h2>素材批次生成</h2>
            </div>
            <span className="pill active">creative.bktsai.link live bridge</span>
          </div>

          <div className="builder-grid">
            <label>
              Use case
              <select
                value={batchForm.useCaseId}
                onChange={(event) => handleUseCaseChange(event.target.value)}
              >
                {activeLibrary
                  .filter((record) => record.kind === 'use_case')
                  .map((record) => (
                    <option key={record.id} value={record.id}>
                      {record.title}
                    </option>
                  ))}
              </select>
            </label>

            <div>
              <span className="field-label">Benefits (3-5)</span>
              <div className="checkbox-grid">
                {activeLibrary
                  .filter((record) => record.kind === 'benefit')
                  .map((record) => (
                    <label key={record.id} className="check-chip">
                      <input
                        type="checkbox"
                        checked={batchForm.benefitIds.includes(record.id)}
                        onChange={(event) =>
                          setBatchForm((current) => {
                            const next = event.target.checked
                              ? [...current.benefitIds, record.id].slice(0, 5)
                              : current.benefitIds.filter((id) => id !== record.id)
                            return { ...current, benefitIds: next }
                          })
                        }
                      />
                      <span>{record.title}</span>
                    </label>
                  ))}
              </div>
              <p className="helper-copy">最少選 3 個，最多 5 個 benefits。</p>
            </div>

            <label>
              產品名稱
              <input
                placeholder="例如 lihiSMS"
                value={batchForm.productName}
                onChange={(event) =>
                  setBatchForm((current) => ({
                    ...current,
                    productName: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              Product / service link
              <input
                placeholder="https://..."
                value={batchForm.productLink}
                onChange={(event) =>
                  setBatchForm((current) => ({
                    ...current,
                    productLink: event.target.value,
                  }))
                }
              />
            </label>

            <div className="asset-grid">
              <label>
                Logo required
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => handleAssetUpload('logoAsset', event.target.files)}
                />
                <span className="helper-copy">
                  {batchForm.logoAsset
                    ? `已上傳：${batchForm.logoAsset}`
                    : '請上傳 logo 圖檔'}
                </span>
              </label>
              <label>
                Product image optional
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => handleAssetUpload('productAsset', event.target.files)}
                />
                <span className="helper-copy">
                  {batchForm.productAsset
                    ? `已上傳：${batchForm.productAsset}`
                    : '可選填產品圖檔'}
                </span>
              </label>
            </div>

            <label>
              其他想補充內容
              <textarea
                rows={4}
                placeholder="例如想強調轉單、避免太硬銷、或指定某些產品賣點"
                value={batchForm.additionalNotes}
                onChange={(event) =>
                  setBatchForm((current) => ({
                    ...current,
                    additionalNotes: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <button
            className="primary-button"
            type="button"
            onClick={handleGenerateBatch}
            disabled={isGeneratingBatch}
          >
            {isGeneratingBatch ? 'Generating 3 creatives…' : 'Generate Ads'}
          </button>

          {batchStatusMessage ? <p className="helper-copy status-banner">{batchStatusMessage}</p> : null}
          {requestError ? <p className="helper-copy error-banner">{requestError}</p> : null}

          {latestBatch ? (
            <div className="metadata-strip">
              <span>批次：{latestBatch.id}</span>
              <span>版本：{latestBatch.promptVersion}</span>
              <span>建立時間：{formatDate(latestBatch.createdAt)}</span>
            </div>
          ) : null}
        </section>

        <section ref={reviewSectionRef} className="panel span-two">
          <div className="panel-header">
            <div>
              <p className="eyebrow">03 / Review + platform approval</p>
              <h2>人工審核、平台選擇、回傳剩餘版型</h2>
            </div>
            <span className="pill muted">平台整批共用</span>
          </div>

          {batchCreatives.length > 0 ? (
            <div className="batch-platform-picker">
              <span className="field-label">Platforms</span>
              <div className="platform-grid">
                {platformOptions.map((platform) => (
                  <button
                    key={platform}
                    type="button"
                    className={
                      selectedBatchPlatforms.includes(platform)
                        ? 'reason-chip active'
                        : 'reason-chip'
                    }
                    onClick={() => toggleBatchPlatform(platform)}
                  >
                    <PlatformBadge platform={platform} />
                  </button>
                ))}
              </div>
              <p className="helper-copy">
                {selectedBatchPlatforms.length > 0
                  ? `已選平台：${selectedBatchPlatforms.join(', ')}，下面每張素材按 Approved 都會用同一組平台。`
                  : '先選至少 1 個平台，下面每張素材都會共用這組平台。'}
              </p>
              <button
                type="button"
                className="primary-button"
                disabled={isApprovingBatch || pendingBatchCreatives.length === 0}
                onClick={approveBatchCreatives}
              >
                {isApprovingBatch ? `Approving ${pendingBatchCreatives.length} creatives…` : `Approve all ${pendingBatchCreatives.length} creatives`}
              </button>
            </div>
          ) : null}

          <div className="creative-grid">
            {isGeneratingBatch ? (
              <article className="creative-empty-state loading-state">
                <h3>素材生成中</h3>
                <p>請稍候，系統正在等待 creative.bktsai.link 回傳 3 組 1:1 審稿素材與文案。</p>
              </article>
            ) : batchCreatives.length === 0 ? (
              <article className="creative-empty-state">
                <h3>還沒有回傳素材</h3>
                <p>上傳 logo 後按 `Generate Ads`，這裡才會出現 creative.bktsai.link 回來的 1:1 素材與文案。</p>
              </article>
            ) : (
              batchCreatives.map((creative) => (
                <article key={creative.id} className={`creative-card mode-${slugify(creative.visualMode)}`}>
                  <div className="creative-preview-frame">
                    <img
                      className="creative-preview-image"
                      src={creative.squareAsset}
                      alt={`${creative.metadata.productName} ${creative.creativeVersion}`}
                    />
                  </div>
                  <div className="creative-poster">
                    <p className="poster-kicker">{creative.kicker}</p>
                    <h3>{creative.headline}</h3>
                    <p>{creative.body}</p>
                    <strong>{creative.deliveryNote}</strong>
                    <footer>
                      <span>版本 {creative.creativeVersion}</span>
                      <span>{formatStylePreset(creative.stylePreset)}</span>
                    </footer>
                  </div>
                  <div className="creative-meta">
                    <div className="tag-row">
                      <span className="tag">風格 {formatStylePreset(creative.stylePreset)}</span>
                      <span className="tag">模特兒 {formatTalentLabel(creative.talent, creative.modelSetting)}</span>
                      <span className="tag">{getToneLabel(creative.tone)}</span>
                      <span className="tag">感性 {creative.voiceBalance}/5</span>
                      <span className="tag subtle">1:1 {assetLabelFromUrl(creative.squareAsset)}</span>
                    </div>
                    <div className="creative-return">
                      <span>{creative.metadata.productName}</span>
                      <span>{creative.assetDeliverables.length > 0 ? `已回傳 ${creative.assetDeliverables.length} 個版位` : '等待平台版位'}</span>
                    </div>
                    <div className="review-actions">
                      <button
                        type="button"
                        className={creative.reviewStatus === 'approved' ? 'mini-button success' : 'mini-button'}
                        disabled={approvingCreativeId === creative.id || isApprovingBatch}
                        onClick={() => approveCreative(creative.id)}
                      >
                        {approvingCreativeId === creative.id ? 'Approving…' : 'Approved'}
                      </button>
                      <p className="helper-copy">
                        {creative.selectedPlatforms.length > 0
                          ? `已選平台：${creative.selectedPlatforms.join(', ')}，Approved 後會回傳這些平台需要的正確尺寸。`
                          : '先選至少 1 個平台，系統才會向 creative.bktsai.link 取回正確尺寸。'}
                      </p>
                      <div className="reason-wrap">
                        {rejectionReasons.map((reason) => (
                          <button
                            key={reason}
                            type="button"
                            className={
                              creative.reviewStatus === 'rejected' &&
                              creative.rejectionReason === reason
                                ? 'reason-chip active'
                                : 'reason-chip'
                            }
                            onClick={() => rejectCreative(creative.id, reason)}
                          >
                            {reason}
                          </button>
                        ))}
                      </div>
                    </div>
                    {creative.assetDeliverables.length > 0 || creative.copyDeliverables || creative.finalCopy ? (
                      <div className="returned-payload">
                        <p className="field-label">已回傳內容</p>
                        {creative.copyDeliverables?.meta_ad ? (
                          <div className="returned-copy">
                            <span>Meta primary text: {creative.copyDeliverables.meta_ad.primaryText}</span>
                            <span>Meta headline: {creative.copyDeliverables.meta_ad.headline}</span>
                            <span>Meta description: {creative.copyDeliverables.meta_ad.description || 'none'}</span>
                            <span>Meta URL: {creative.copyDeliverables.meta_ad.destinationUrl || 'none'}</span>
                          </div>
                        ) : null}
                        {creative.copyDeliverables?.google_ads ? (
                          <div className="returned-copy">
                            <span>Google headlines: {creative.copyDeliverables.google_ads.headline}</span>
                            <span>Google descriptions: {creative.copyDeliverables.google_ads.description}</span>
                            <span>Google paths: {creative.copyDeliverables.google_ads.path1} / {creative.copyDeliverables.google_ads.path2}</span>
                            <span>Google URL: {creative.copyDeliverables.google_ads.destinationUrl || 'none'}</span>
                          </div>
                        ) : null}
                        {creative.assetDeliverables.length > 0 ? (
                          <div className="returned-assets">
                            {creative.assetDeliverables.map((asset) => (
                              <a
                                key={`${asset.platform}-${asset.surface}-${asset.aspectRatio}-${asset.url}`}
                                className="returned-asset-card"
                                href={asset.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <strong>
                                  <PlatformBadge platform={getPlatformLabel(asset.platform)} compact />
                                </strong>
                                <span>{asset.surface}</span>
                                <span>{asset.aspectRatio}</span>
                                <span>{asset.width} × {asset.height}</span>
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">04 / Flow validation</p>
              <h2>完整流程驗收</h2>
            </div>
            <span className="pill muted">latest batch only</span>
          </div>

          <div className="validation-grid">
            {validationChecks.map((check) => (
              <article
                key={check.label}
                className={check.done ? 'validation-card is-done' : 'validation-card'}
              >
                <span className={check.done ? 'pill active' : 'pill muted'}>
                  {check.done ? 'done' : 'pending'}
                </span>
                <h3>{check.label}</h3>
                <p>{check.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="panel span-two">
          <div className="panel-header">
            <div>
              <p className="eyebrow">05 / Meta delivery bundle</p>
              <h2>素材交付檢查</h2>
            </div>
            <span className="pill active">Meta first, keep all assets</span>
          </div>

          {metaBundleCreatives.length === 0 ? (
            <article className="creative-empty-state">
              <h3>還沒有可交付的素材 bundle</h3>
              <p>先完成 Approved，讓 creative.bktsai.link 回文案與對應版位。</p>
            </article>
          ) : (
            <div className="meta-bundle-grid">
              {metaBundleCreatives.map(({ creative, prioritizedAssets, metaAssetCount, metaCopy }) => (
                <article key={`meta-bundle-${creative.id}`} className="draft-card">
                  <div>
                    <p className="eyebrow">{creative.creativeVersion}</p>
                    <h3>{creative.headline}</h3>
                    <p className="helper-copy">{creative.metadata.productName}</p>
                  </div>

                  <div className="tag-row">
                    <span className="tag">All assets {prioritizedAssets.length}</span>
                    <span className="tag">Meta assets {metaAssetCount}</span>
                    <span className="tag">已選平台 {creative.selectedPlatforms.join(', ')}</span>
                  </div>

                  {metaCopy ? (
                    <div className="draft-schema">
                      <span>Primary text: {metaCopy.primaryText}</span>
                      <span>Headline: {metaCopy.headline}</span>
                      <span>Description: {metaCopy.description || 'none'}</span>
                      <span>URL: {metaCopy.destinationUrl || 'none'}</span>
                    </div>
                  ) : (
                    <p className="helper-copy">尚未回傳 Meta 文案。</p>
                  )}

                  <div className="returned-assets">
                    {prioritizedAssets.map((asset) => (
                      <a
                        key={`meta-${creative.id}-${asset.platform}-${asset.surface}-${asset.aspectRatio}`}
                        className="returned-asset-card"
                        href={asset.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <strong>
                          <PlatformBadge platform={getPlatformLabel(asset.platform)} compact />
                        </strong>
                        <span>{isMetaPlatform(asset.platform) ? 'Meta priority' : 'Other placement'}</span>
                        <span>{asset.surface}</span>
                        <span>{asset.aspectRatio}</span>
                        <span>{asset.width} × {asset.height}</span>
                      </a>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">06 / Draft builder</p>
              <h2>Draft ad studio</h2>
            </div>
            <button className="primary-button" type="button" onClick={createDraftAds}>
              Build drafts from approved creatives
            </button>
          </div>

          <p className="helper-copy">
            Ready for draft: {approvedReadyForDraft.length} approved creatives with platforms selected
          </p>

          <div className="draft-list">
            {state.drafts.map((draft) => (
              <article key={draft.id} className="draft-card">
                <div>
                  <p className="eyebrow">{draft.status}</p>
                  <h3>{draft.adName}</h3>
                  <p>{draft.adsetName}</p>
                  <p className="helper-copy">{draft.campaignName}</p>
                  <div className="draft-overview-grid">
                    <span>Product: {draft.metadata.productName}</span>
                    <span>Objective: {draft.adsPlan.campaign.objective}</span>
                    <span>Audience: {draft.adsPlan.adSet.audienceType}</span>
                    <span>Optimize for: {draft.adsPlan.adSet.optimizationGoal}</span>
                  </div>
                  <details className="inline-details">
                    <summary>看投放設定與文案</summary>
                    <div className="draft-schema">
                      <span>Funnel: {draft.adsPlan.campaign.funnelStage}</span>
                      <span>
                        Window:{' '}
                        {draft.adsPlan.adSet.audienceWindowDays
                          ? `${draft.adsPlan.adSet.audienceWindowDays}D`
                          : 'none'}
                      </span>
                      <span>Budget: {draft.adsPlan.adSet.budgetStrategy}</span>
                      <span>Placement: {draft.adsPlan.adSet.placementStrategy}</span>
                      <span>Angle family: {draft.adsPlan.ad.angleFamily}</span>
                      <span>Angle: {draft.adsPlan.ad.angleLabel}</span>
                      <span>Primary text: {draft.primaryText}</span>
                      <span>Headline: {draft.headline}</span>
                      <span>Description: {draft.description}</span>
                      <span>URL: {draft.destinationUrl}</span>
                    </div>
                  </details>
                </div>
                <div className="draft-actions">
                  <span className="pill active">{draft.metadata.angleId}</span>
                  {draft.metadata.selectedPlatforms.map((platform) => (
                    <span key={platform} className="pill muted">
                      {platform}
                    </span>
                  ))}
                  {draft.assetDeliverables.map((asset) => (
                    <span key={asset} className="pill muted">
                      {asset}
                    </span>
                  ))}
                  {draft.status === 'draft' ? (
                    <button
                      type="button"
                      className="mini-button success"
                      onClick={() => prepareDraftForPublish(draft.id)}
                    >
                      Prepare publish bundle
                    </button>
                  ) : null}
                  {draft.status === 'ready_to_publish' ? (
                    <button
                      type="button"
                      className="mini-button success"
                      onClick={() => publishDraftToAdsMcp(draft.id)}
                      disabled={publishingDraftId === draft.id}
                    >
                      {publishingDraftId === draft.id ? 'Publishing…' : 'Publish to Facebook'}
                    </button>
                  ) : null}
                  {draft.status === 'publishing' ? (
                    <span className="helper-copy">Publishing in progress…</span>
                  ) : null}
                  {draft.status === 'published' ? (
                    <span className="helper-copy">
                      Published {draft.publishedAt ? formatDate(draft.publishedAt) : ''}
                    </span>
                  ) : null}
                  {draft.status === 'failed' ? (
                    <>
                      <span className="helper-copy">
                        Failed: {draft.publishBundle.lastError ?? 'unknown error'}
                      </span>
                      <button
                        type="button"
                        className="mini-button"
                        onClick={() => prepareDraftForPublish(draft.id)}
                      >
                        Rebuild bundle
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel span-two">
          <div className="panel-header">
            <div>
              <p className="eyebrow">07 / Ads MCP gateway</p>
              <h2>Facebook delivery setup</h2>
            </div>
            <span className="pill active">{state.adsMcpGateway.connectionStatus}</span>
          </div>

          <div className="gateway-auth-card">
            <div>
              <p className="eyebrow">facebook ads access</p>
              <h3>
                {state.adsMcpGateway.connectionStatus === 'connected'
                  ? state.adsMcpGateway.businessName ?? 'Facebook connected'
                  : '還沒連上 Facebook Ads'}
              </h3>
              <p className="helper-copy">
                {state.adsMcpGateway.connectionStatus === 'connected'
                  ? '先選 ad account、pixel、Page，再往下看 live structure。'
                  : '按下後會直接跳 Meta OAuth；授權完成後，系統會自動抓回可用的 ad account、pixel、Page。'}
              </p>
            </div>
            <div className="draft-actions">
              {state.adsMcpGateway.connectionStatus !== 'connected' ? (
                <button
                  type="button"
                  className="primary-button"
                  onClick={connectFacebookAds}
                  disabled={isConnectingFacebook}
                >
                  {isConnectingFacebook ? 'Connecting…' : 'Connect Facebook'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="mini-button"
                    onClick={connectFacebookAds}
                    disabled={isConnectingFacebook}
                  >
                    Reconnect
                  </button>
                  <button
                    type="button"
                    className="mini-button"
                    onClick={disconnectFacebookAds}
                  >
                    Disconnect
                  </button>
                  <button
                    type="button"
                    className="mini-button"
                    onClick={() => setStructureRefreshKey((current) => current + 1)}
                    disabled={accountStructureSnapshot.status === 'loading'}
                  >
                    {accountStructureSnapshot.status === 'loading'
                      ? 'Syncing structure…'
                      : 'Refresh structure'}
                  </button>
                  <button
                    type="button"
                    className="mini-button"
                    onClick={jumpToStructureSection}
                  >
                    Jump to structure
                  </button>
                </>
              )}
            </div>
          </div>

          {state.adsMcpGateway.connectionStatus === 'connected' ? (
            <div className="gateway-stack">
              <div className="gateway-overview-grid">
                <article className="overview-card">
                  <span>目前帳號</span>
                  <strong>
                    {selectedAdAccount
                      ? `${selectedAdAccount.name} · ${selectedAdAccount.accountId}`
                      : '尚未選擇'}
                  </strong>
                </article>
                <article className="overview-card">
                  <span>目前 pixel</span>
                  <strong>{selectedPixel ? selectedPixel.name : '尚未選擇'}</strong>
                </article>
                <article className="overview-card">
                  <span>目前 Page</span>
                  <strong>{selectedPage ? selectedPage.name : '尚未選擇'}</strong>
                </article>
                <article className="overview-card">
                  <span>可用資產</span>
                  <strong>
                    {state.adsMcpGateway.availableAdAccounts.length} accounts ·{' '}
                    {state.adsMcpGateway.availablePixels.length} pixels ·{' '}
                    {state.adsMcpGateway.availablePages.length} pages
                  </strong>
                </article>
              </div>

              <div className="gateway-grid">
                <label className="rule-field">
                  <span>Ad account</span>
                  <input
                    type="search"
                    placeholder="搜尋帳號名稱或 ID，例如 lihi.io / 415404632649857"
                    value={adAccountQuery}
                    onChange={(event) => setAdAccountQuery(event.target.value)}
                  />
                  <select
                    value={state.adsMcpGateway.adAccountId}
                    onChange={(event) => void selectFacebookAdAccount(event.target.value)}
                  >
                    {visibleAdAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} · {account.currency} · {account.accountId}
                      </option>
                    ))}
                  </select>
                  <small>
                    顯示 {filteredAdAccounts.length} / {state.adsMcpGateway.availableAdAccounts.length} 個
                  </small>
                </label>
                <label className="rule-field">
                  <span>Pixel</span>
                  <select
                    value={state.adsMcpGateway.pixelId}
                    onChange={(event) => updateAdsMcpGateway({ pixelId: event.target.value })}
                  >
                    {state.adsMcpGateway.availablePixels.map((pixel) => (
                      <option key={pixel.id} value={pixel.id}>
                        {pixel.name} · {pixel.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="rule-field">
                  <span>Facebook Page</span>
                  <select
                    value={state.adsMcpGateway.pageId}
                    onChange={(event) => selectFacebookPage(event.target.value)}
                  >
                    {state.adsMcpGateway.availablePages.length > 0 ? (
                      state.adsMcpGateway.availablePages.map((page) => (
                        <option key={page.id} value={page.id}>
                          {page.name} · {page.id}
                        </option>
                      ))
                    ) : (
                      <option value="">沒有抓到可用 Page，請先 Reconnect 授權 pages_show_list</option>
                    )}
                  </select>
                </label>
              </div>
            </div>
          ) : null}

          {publishStatusMessage ? <div className="status-banner">{publishStatusMessage}</div> : null}
          {state.adsMcpGateway.lastError ? (
            <div className="error-banner">{state.adsMcpGateway.lastError}</div>
          ) : null}
          {state.adsMcpGateway.connectionStatus === 'connected' ? (
            <div ref={structureSectionRef} className="account-structure-panel">
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow">live structure</p>
                  <h3>Live campaign structure</h3>
                  <p className="helper-copy">主畫面只留目前帳號的 campaign、ad set、ad，方便直接查看。</p>
                </div>
                <span className="pill muted">{accountStructureSnapshot.status}</span>
              </div>

              <div className="builder-flow">
                <span>{accountStructureSnapshot.campaigns.length} campaigns</span>
                <span>{accountStructureSnapshot.adSets.length} ad sets</span>
                <span>{accountStructureSnapshot.ads.length} ads</span>
                <span>
                  Last sync:{' '}
                  {accountStructureSnapshot.lastSyncedAt
                    ? formatDate(accountStructureSnapshot.lastSyncedAt)
                    : 'none'}
                </span>
              </div>

              {accountStructureSnapshot.error ? (
                <div className="error-banner">{accountStructureSnapshot.error}</div>
              ) : null}

              {accountStructureSnapshot.status === 'ready' &&
              accountStructureSnapshot.campaigns.length > 0 ? (
                <div className="account-structure-grid">
                  <article className="structure-card">
                    <div className="structure-card-header">
                      <h4>Campaigns</h4>
                      <span className="pill muted">{accountStructureSnapshot.campaigns.length}</span>
                    </div>
                    <div className="structure-list">
                      {accountStructureSnapshot.campaigns.map((campaign) => {
                        const stats = campaignStats.get(campaign.id)
                        return (
                          <button
                            key={campaign.id}
                            type="button"
                            className={`structure-row ${
                              campaign.id === activeCampaignId ? 'selected' : ''
                            }`}
                            onClick={() => {
                              setSelectedCampaignId(campaign.id)
                              setSelectedAdSetId('')
                            }}
                          >
                            <div className="structure-row-title">{campaign.name}</div>
                            <div className="structure-row-meta">{campaign.objective}</div>
                            <div className="structure-row-meta">
                              {campaign.status} / {campaign.effectiveStatus}
                            </div>
                            <div className="structure-row-meta">
                              {stats?.adSetCount ?? 0} ad sets · {stats?.adCount ?? 0} ads
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </article>

                  <article className="structure-card">
                    <div className="structure-card-header">
                      <h4>Ad sets</h4>
                      <span className="pill muted">{campaignScopedAdSets.length}</span>
                    </div>
                    {campaignScopedAdSets.length === 0 ? (
                      <article className="creative-empty-state compact">
                        <h3>這個 campaign 目前沒有 ad set</h3>
                        <p>可以先切別的 campaign，或按 `Refresh structure` 再抓一次。</p>
                      </article>
                    ) : (
                      <div className="structure-list">
                        {campaignScopedAdSets.map((adSet) => (
                          <button
                            key={adSet.id}
                            type="button"
                            className={`structure-row ${adSet.id === activeAdSetId ? 'selected' : ''}`}
                            onClick={() => setSelectedAdSetId(adSet.id)}
                          >
                            <div className="structure-row-title">{adSet.name}</div>
                            <div className="structure-row-meta">{adSet.optimizationGoal}</div>
                            <div className="structure-row-meta">
                              {adSet.status} / {adSet.effectiveStatus}
                            </div>
                            <div className="structure-row-meta">
                              Budget:{' '}
                              {adSet.dailyBudget
                                ? `daily ${adSet.dailyBudget}`
                                : adSet.lifetimeBudget
                                  ? `lifetime ${adSet.lifetimeBudget}`
                                  : 'not set'}
                            </div>
                            <div className="structure-row-meta">{adSetStats.get(adSet.id) ?? 0} ads</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </article>

                  <article className="structure-card">
                    <div className="structure-card-header">
                      <h4>Ads</h4>
                      <span className="pill muted">{adSetScopedAds.length}</span>
                    </div>
                    {adSetScopedAds.length === 0 ? (
                      <article className="creative-empty-state compact">
                        <h3>這個 ad set 目前沒有 ad</h3>
                        <p>如果剛建立或剛 paused，先 refresh；有資料就會出現在這裡。</p>
                      </article>
                    ) : (
                      <div className="structure-list">
                        {adSetScopedAds.map((ad) => (
                          <div key={ad.id} className="structure-row static">
                            <div className="structure-row-title">{ad.name}</div>
                            <div className="structure-row-meta">
                              {ad.status} / {ad.effectiveStatus}
                            </div>
                            <div className="structure-row-meta">ID: {ad.id}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                </div>
              ) : accountStructureSnapshot.status === 'loading' ? (
                <article className="creative-empty-state compact">
                  <h3>正在抓 account structure</h3>
                  <p>系統會直接從目前選到的 ad account 拉 campaigns、ad sets、ads。</p>
                </article>
              ) : (
                <article className="creative-empty-state compact">
                  <h3>這個 ad account 還沒有可顯示的投放結構</h3>
                  <p>如果你確定帳號內有資料，按 `Refresh structure` 再抓一次。</p>
                </article>
              )}
            </div>
          ) : null}

          <details className="advanced-panel">
            <summary>進階連線與 Ads MCP 資訊</summary>
            <div className="builder-flow">
              <span>Connection mode: {state.adsMcpGateway.mode}</span>
              <span>Graph API: {state.adsMcpGateway.graphVersion}</span>
              <span>Meta Ads MCP server: {META_ADS_MCP_SERVER}</span>
              <span>
                Last success:{' '}
                {state.adsMcpGateway.lastValidatedAt
                  ? formatDate(state.adsMcpGateway.lastValidatedAt)
                  : 'none'}
              </span>
              {state.adsMcpGateway.tokenExpiresAt ? (
                <span>Token expires: {formatDate(state.adsMcpGateway.tokenExpiresAt)}</span>
              ) : null}
            </div>

            <details className="inline-details">
              <summary>Account diagnostics</summary>
              <small>
                {state.adsMcpGateway.availableAdAccounts
                  .map((account) => `${account.name} (${account.accountId})`)
                  .join(' | ')}
              </small>
            </details>

            <div className="api-spec-grid">
              <article className="api-spec-card">
                <h3>Official MCP flow</h3>
                <p>publish 時會先 `initialize`，再 `tools/list`，最後依序呼叫 `ads_create_campaign / ad_set / ad`。</p>
              </article>
              <article className="api-spec-card">
                <h3>Write path</h3>
                <p>正式寫入已不再走前端手拼 Graph API，而是直接走 Meta Ads MCP tools。</p>
              </article>
              <article className="api-spec-card">
                <h3>Failure behavior</h3>
                <p>MCP tool call 失敗時，draft 會進 `failed`，並保留 server 回傳的錯誤訊息。</p>
              </article>
            </div>

            {gatewayContractPreview ? (
              <div className="gateway-contract-grid">
                <article>
                  <p className="eyebrow">prepared payload</p>
                  <pre className="payload-preview">
                    {JSON.stringify(gatewayContractPreview.request, null, 2)}
                  </pre>
                </article>
                <article>
                  <p className="eyebrow">publish result shape</p>
                  <pre className="payload-preview">
                    {JSON.stringify(gatewayContractPreview.response, null, 2)}
                  </pre>
                </article>
              </div>
            ) : (
              <article className="creative-empty-state compact">
                <h3>還沒有 payload sample</h3>
                <p>先把 draft prepare 成 ready_to_publish，這裡就會帶出目前準備送進 Ads MCP 的 payload。</p>
              </article>
            )}
          </details>
        </section>

        <section className="panel span-two">
          <div className="panel-header">
            <div>
              <p className="eyebrow">08 / Publish review</p>
              <h2>Ready-to-publish bundles</h2>
            </div>
            <span className="pill active">{publishableDrafts.length} drafts</span>
          </div>

          {publishableDrafts.length === 0 ? (
            <article className="creative-empty-state">
              <h3>還沒有 ready 的 publish bundle</h3>
              <p>先在 Draft ad studio 按 `Prepare publish bundle`，確認 bundle 狀態。</p>
            </article>
          ) : (
            <div className="publish-review-grid">
              {publishableDrafts.map((draft) => (
                <article key={`publish-${draft.id}`} className="draft-card">
                  <div>
                    <p className="eyebrow">{draft.status}</p>
                    <h3>{draft.publishBundle.adPayload.name}</h3>
                    <p>{draft.publishBundle.adSetPayload.name}</p>
                    <p className="helper-copy">{draft.publishBundle.campaignPayload.name}</p>
                    <div className="draft-overview-grid">
                      <span>Objective: {draft.publishBundle.campaignPayload.objective}</span>
                      <span>Audience: {draft.publishBundle.adSetPayload.audienceType}</span>
                      <span>Gateway: {draft.publishBundle.adsMcpPayload.connection.mode}</span>
                      <span>Ad account: {draft.publishBundle.adsMcpPayload.connection.adAccountId}</span>
                    </div>
                  </div>

                  <div className="publish-asset-list">
                    {draft.publishBundle.assetSelections
                      .filter((asset) => asset.selected)
                      .map((asset) => (
                        <span key={`${draft.id}-${asset.label}`} className="pill muted">
                          {asset.label}
                        </span>
                      ))}
                  </div>

                  <div className="draft-actions">
                    {draft.status === 'ready_to_publish' ? (
                      <button
                        type="button"
                        className="mini-button success"
                        onClick={() => publishDraftToAdsMcp(draft.id)}
                        disabled={publishingDraftId === draft.id}
                      >
                        {publishingDraftId === draft.id ? 'Publishing…' : 'Publish via Ads MCP'}
                      </button>
                    ) : null}
                    {draft.publishBundle.submission.externalAdId ? (
                      <span className="pill muted">
                        External ad: {draft.publishBundle.submission.externalAdId}
                      </span>
                    ) : null}
                  </div>

                  <details className="inline-details">
                    <summary>看 bundle 明細與 payload</summary>
                    <div className="draft-schema">
                      <span>MCP server: {draft.publishBundle.adsMcpPayload.server}</span>
                      <span>MCP version: {draft.publishBundle.adsMcpPayload.version}</span>
                      <span>Primary text: {draft.publishBundle.copyPayload.primaryText}</span>
                      <span>Headline: {draft.publishBundle.copyPayload.headline}</span>
                      <span>Description: {draft.publishBundle.copyPayload.description}</span>
                      <span>URL: {draft.publishBundle.copyPayload.destinationUrl}</span>
                      <span>
                        Checklist:
                        {draft.publishBundle.checklist.hasCopy ? ' copy' : ''}
                        {draft.publishBundle.checklist.hasDestinationUrl ? ' url' : ''}
                        {draft.publishBundle.checklist.hasSelectedAssets ? ' assets' : ''}
                        {draft.publishBundle.checklist.hasMetaAsset ? ' meta' : ''}
                      </span>
                    </div>
                    <pre className="payload-preview">
                      {JSON.stringify(draft.publishBundle.adsMcpPayload, null, 2)}
                    </pre>
                  </details>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">09 / Funnel analytics</p>
              <h2>核心漏斗與 Airbyte 回流</h2>
            </div>
            <button className="primary-button" type="button" onClick={syncAirbyteDemo}>
              Run demo Airbyte sync
            </button>
          </div>

          <div className="funnel-row">
            <article>
              <span>Spend</span>
              <strong>{usd.format(funnelTotals.spend)}</strong>
            </article>
            <article>
              <span>LP view</span>
              <strong>{funnelTotals.landingPageViews}</strong>
            </article>
            <article>
              <span>Register submitted</span>
              <strong>{funnelTotals.registerSubmitted}</strong>
            </article>
            <article>
              <span>Email verified</span>
              <strong>{funnelTotals.emailVerifiedSignups}</strong>
            </article>
          </div>

          <div className="analytics-list">
            {state.metrics.map((metric) => {
              const draft = state.drafts.find((item) => item.id === metric.draftId)
              return (
                <article key={metric.id} className="analytics-card">
                  <div>
                    <h3>{draft?.adName ?? metric.draftId}</h3>
                    <p>
                      CTR {metric.ctr.toFixed(2)}% · CPC {usd.format(metric.cpc)} · verified{' '}
                      {metric.emailVerifiedSignups}
                    </p>
                  </div>
                  <div className="analytics-numbers">
                    <span>Spend {usd.format(metric.spend)}</span>
                    <span>Impressions {metric.impressions}</span>
                    <span>Frequency {metric.frequency.toFixed(2)}</span>
                    <span>
                      CPA{' '}
                      {metric.costPerVerifiedSignup === null
                        ? 'n/a'
                        : usd.format(metric.costPerVerifiedSignup)}
                    </span>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">10 / Optimization rules</p>
              <h2>固定門檻</h2>
            </div>
            <span className="pill muted">rule-based only</span>
          </div>
          <div className="rules-grid">
            <RuleField
              label="Min spending"
              value={state.rules.minSpend}
              onChange={(value) => updateRules({ minSpend: value })}
            />
            <RuleField
              label="CTR Goal"
              value={state.rules.ctrGoal}
              onChange={(value) => updateRules({ ctrGoal: value })}
            />
            <RuleField
              label="Max CPA"
              value={state.rules.maxCpa}
              onChange={(value) => updateRules({ maxCpa: value })}
            />
            <RuleField
              label="Frequency"
              value={state.rules.maxFrequency}
              onChange={(value) => updateRules({ maxFrequency: value })}
            />
          </div>
        </section>

        <section className="panel span-two">
          <div className="panel-header">
            <div>
              <p className="eyebrow">11 / Next-step recommendations</p>
              <h2>系統建議，不自動執行</h2>
            </div>
            <span className="pill active">You hold final override</span>
          </div>

          <div className="recommendation-grid">
            {recommendations.length === 0 ? (
              <article className="recommendation-card neutral">
                <h3>還沒有建議</h3>
                <p>先把 approved creative 建成 draft、標記 published，再跑一次 demo Airbyte sync。</p>
              </article>
            ) : (
              recommendations.map((recommendation) => (
                <article
                  key={`${recommendation.kind}-${recommendation.title}`}
                  className={`recommendation-card ${recommendation.kind}`}
                >
                  <p className="eyebrow">{recommendation.kind}</p>
                  <h3>{recommendation.title}</h3>
                  <p>{recommendation.body}</p>
                </article>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

function RuleField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="rule-field">
      <span>{label}</span>
      <input
        type="number"
        step="0.1"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function PlatformBadge({
  platform,
  compact = false,
}: {
  platform: string
  compact?: boolean
}) {
  const normalized = getPlatformLabel(platform)
  const tone = getPlatformTone(normalized)
  const glyph = getPlatformGlyph(normalized)

  return (
    <span className={compact ? 'platform-badge compact' : 'platform-badge'}>
      <span className={`platform-pill-icon ${tone}`} aria-hidden="true">
        {glyph}
      </span>
      <span>{normalized}</span>
    </span>
  )
}

function slugify(value: string) {
  return value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .toLowerCase()
}

function stringScore(value: string) {
  return value.split('').reduce((sum, character, index) => {
    return sum + character.charCodeAt(0) * (index + 11)
  }, 0)
}

function lookupRecord(library: StrategyRecord[], recordId: string) {
  return library.find((record) => record.id === recordId)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function buildAssetDeliverables(creative: CreativeAsset) {
  if (creative.assetDeliverables.length > 0) {
    return creative.assetDeliverables.map((asset) => {
      return `${asset.platform}: ${asset.surface} ${asset.aspectRatio} ${asset.width}x${asset.height}`
    })
  }

  return creative.selectedPlatforms.map((platform) => {
    return `${platform}: returned by creative.bktsai.link`
  })
}

function assetLabelFromUrl(value: string) {
  try {
    const pathname = new URL(value).pathname
    return pathname.split('/').pop() ?? value
  } catch {
    return value
  }
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function parseMcpJsonRpcResponse<T>(value: string): McpJsonRpcResponse<T> | null {
  const direct = safeJsonParse<McpJsonRpcResponse<T>>(value)
  if (direct) {
    return direct
  }

  const eventBlocks = parseServerSentEventBlocks(value)
  for (const block of eventBlocks) {
    for (const dataLine of block.data) {
      const parsed = safeJsonParse<McpJsonRpcResponse<T>>(dataLine)
      if (parsed) {
        return parsed
      }
    }
  }

  return null
}

function parseServerSentEventBlocks(value: string): ServerSentEventBlock[] {
  const trimmed = value.trim()
  if (!trimmed) {
    return []
  }

  return trimmed
    .split(/\r?\n\r?\n/)
    .map((chunk) => {
      const block: ServerSentEventBlock = { data: [] }
      const lines = chunk.split(/\r?\n/)
      for (const line of lines) {
        if (line.startsWith('event:')) {
          block.event = line.slice('event:'.length).trim()
        }
        if (line.startsWith('data:')) {
          block.data.push(line.slice('data:'.length).trim())
        }
      }
      return block
    })
    .filter((block) => block.data.length > 0)
}

function buildResponsePreview(value: string) {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.slice(0, 240) || '[empty response]'
}

function getPlatformTone(platform: string) {
  switch (platform) {
    case 'Facebook':
      return 'facebook'
    case 'Instagram':
      return 'instagram'
    case 'Threads':
      return 'threads'
    case 'Google Ads':
      return 'google-ads'
    case 'IG Reels':
      return 'ig-reels'
    case 'IG Stories':
      return 'ig-stories'
    default:
      return 'default'
  }
}

function getPlatformGlyph(platform: string) {
  switch (platform) {
    case 'Facebook':
      return 'f'
    case 'Instagram':
      return '◎'
    case 'Threads':
      return '@'
    case 'Google Ads':
      return 'G'
    case 'IG Reels':
      return '▶'
    case 'IG Stories':
      return '◐'
    default:
      return '•'
  }
}

function isMetaPlatform(platform: string) {
  return ['Facebook', 'Instagram', 'Threads', 'IG Reels', 'IG Stories'].includes(
    getPlatformLabel(platform),
  )
}

async function readErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { error?: { message?: string } }
    return payload.error?.message ?? `Request failed with ${response.status}`
  } catch {
    return `Request failed with ${response.status}`
  }
}

function waitAtLeast(durationMs: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs)
  })
}

export default App

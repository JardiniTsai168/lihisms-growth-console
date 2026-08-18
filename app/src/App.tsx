import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { listApprovedArchive, upsertApprovedArchive } from './archiveDb'
import { initialState, standardTagBank } from './seed'
import type {
  AppState,
  ApprovedArchiveItem,
  AssetDeliverable,
  CopyDeliverables,
  CreativeAsset,
  CreativeBatch,
  LibraryKind,
  Platform,
  StrategyRecord,
} from './types'
import { usePersistentState } from './usePersistentState'

const STORAGE_KEY = 'lihisms-growth-console-v8'
const CREATIVE_API_BASE = 'https://creative.bktsai.link/internal'

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
  assetDeliverables: AssetDeliverable[]
}

type RequestedCreativeFormat = {
  platform: Platform
  surface: string
  aspectRatio: string
  width: number
  height: number
}

const platformOptions: Platform[] = ['Facebook', 'Instagram', 'Threads', 'Google Ads']

const rejectionReasons = ['賣點不對', '文案太弱', '視覺不佳', '不像 lihi', '不適合投放', '其他']

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
    additionalNotes: '',
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function waitAtLeast(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function readErrorMessage(response: Response) {
  const text = await response.text()

  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string }
    return parsed.error || parsed.message || text || `HTTP ${response.status}`
  } catch {
    return text || `HTTP ${response.status}`
  }
}

function inferAspectRatio(width: number, height: number) {
  if (!width || !height) {
    return null
  }

  const ratio = width / height

  if (Math.abs(ratio - 1) < 0.04) return '1:1'
  if (Math.abs(ratio - 0.8) < 0.04) return '4:5'
  if (Math.abs(ratio - 9 / 16) < 0.04) return '9:16'
  if (Math.abs(ratio - 1.91) < 0.06) return '1.91:1'

  return null
}

function normalizeReturnedAssets(assets: FormatsResponse['assetDeliverables']) {
  return assets.map((asset) => ({
    ...asset,
    aspectRatio: inferAspectRatio(asset.width, asset.height) ?? asset.aspectRatio,
  }))
}

function buildRequestedFormats(platforms: Platform[]): RequestedCreativeFormat[] {
  const requestedFormats: RequestedCreativeFormat[] = []

  if (platforms.includes('Facebook')) {
    requestedFormats.push({
      platform: 'Facebook',
      surface: 'Feed',
      aspectRatio: '4:5',
      width: 1080,
      height: 1350,
    })
  }

  if (platforms.includes('Instagram')) {
    requestedFormats.push(
      {
        platform: 'Instagram',
        surface: 'Feed',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
      },
      {
        platform: 'Instagram',
        surface: 'Story',
        aspectRatio: '9:16',
        width: 1080,
        height: 1920,
      },
      {
        platform: 'Instagram',
        surface: 'Reels',
        aspectRatio: '9:16',
        width: 1080,
        height: 1920,
      },
    )
  }

  if (platforms.includes('Threads')) {
    requestedFormats.push({
      platform: 'Threads',
      surface: 'Feed',
      aspectRatio: '4:5',
      width: 1080,
      height: 1350,
    })
  }

  if (platforms.includes('Google Ads')) {
    requestedFormats.push(
      {
        platform: 'Google Ads',
        surface: 'Square',
        aspectRatio: '1:1',
        width: 1200,
        height: 1200,
      },
      {
        platform: 'Google Ads',
        surface: 'Landscape',
        aspectRatio: '1.91:1',
        width: 1200,
        height: 628,
      },
    )
  }

  return requestedFormats
}

function getPrimaryCopy(creative: CreativeAsset) {
  return creative.copyDeliverables?.meta_ad ?? creative.finalCopy
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

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

function buildArchiveRecord(creative: CreativeAsset): ApprovedArchiveItem {
  return {
    id: creative.id,
    creativeId: creative.sourceCreativeId,
    batchId: creative.batchId,
    creativeVersion: creative.creativeVersion,
    angleId: creative.angleId,
    approvedAt: new Date().toISOString(),
    selectedPlatforms: creative.selectedPlatforms,
    productName: creative.metadata.productName,
    useCaseId: creative.metadata.useCaseId,
    benefitIds: creative.metadata.benefitIds,
    promptVersion: creative.promptVersion,
    copyMode: creative.copyMode,
    headline: creative.headline,
    kicker: creative.kicker,
    body: creative.body,
    squareAsset: creative.squareAsset,
    finalCopy: creative.finalCopy,
    copyDeliverables: creative.copyDeliverables,
    assetDeliverables: creative.assetDeliverables,
    metadata: creative.metadata,
  }
}

async function requestFormatsForCreative(creative: CreativeAsset) {
  const requestedFormats = buildRequestedFormats(creative.selectedPlatforms)
  const response = await fetch(`${CREATIVE_API_BASE}/generate-formats`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      batchId: creative.batchId,
      creativeId: creative.sourceCreativeId,
      selectedPlatforms: creative.selectedPlatforms,
      requestedFormats,
      strictAspectRatios: true,
      formatStrategy: 'low_risk_extend',
    }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return (await response.json()) as FormatsResponse
}

function App() {
  const logoUrl = `${import.meta.env.BASE_URL}lihi-logo-primary.png`
  const [state, setState] = usePersistentState<AppState>(STORAGE_KEY, initialState)
  const [archive, setArchive] = useState<ApprovedArchiveItem[]>([])
  const [archiveStatus, setArchiveStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [selectedKind, setSelectedKind] = useState<LibraryKind>('use_case')
  const [form, setForm] = useState(buildEmptyForm)
  const [batchForm, setBatchForm] = useState(() => buildBatchForm(initialState.library))
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [productImageFile, setProductImageFile] = useState<File | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [batchStatusMessage, setBatchStatusMessage] = useState<string | null>(null)
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null)
  const [isGeneratingBatch, setIsGeneratingBatch] = useState(false)
  const [approvingCreativeId, setApprovingCreativeId] = useState<string | null>(null)
  const [isApprovingBatch, setIsApprovingBatch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const activeLibrary = useMemo(
    () => state.library.filter((record) => record.status === 'active'),
    [state.library],
  )
  const latestBatch = state.batches[0] ?? null
  const latestBatchCreatives = useMemo(
    () =>
      latestBatch
        ? state.creatives.filter((creative) => latestBatch.creativeIds.includes(creative.id))
        : [],
    [latestBatch, state.creatives],
  )
  const pendingCreatives = latestBatchCreatives.filter((creative) => creative.reviewStatus === 'pending')
  const approvedCreatives = latestBatchCreatives.filter((creative) => creative.reviewStatus === 'approved')

  const filteredArchive = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) {
      return archive
    }

    return archive.filter((item) =>
      [
        item.productName,
        item.creativeVersion,
        item.headline,
        item.finalCopy?.headline,
        item.finalCopy?.primaryText,
        item.selectedPlatforms.join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [archive, searchQuery])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        const rows = await listApprovedArchive()
        if (cancelled) return
        setArchive(rows)
        setArchiveStatus('ready')
      } catch (error) {
        if (cancelled) return
        setArchiveStatus('error')
        setArchiveError(error instanceof Error ? error.message : '資料庫讀取失敗。')
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (batchForm.useCaseId) {
      return
    }

    const nextUseCase = activeLibrary.find((record) => record.kind === 'use_case')
    if (!nextUseCase) {
      return
    }

    setBatchForm((current) => ({
      ...current,
      useCaseId: nextUseCase.id,
    }))
  }, [activeLibrary, batchForm.useCaseId])

  const loadArchive = async (message?: string) => {
    try {
      const rows = await listApprovedArchive()
      setArchive(rows)
      setArchiveStatus('ready')
      setArchiveError(null)
      if (message) {
        setArchiveMessage(message)
      }
    } catch (error) {
      setArchiveStatus('error')
      setArchiveError(error instanceof Error ? error.message : '資料庫讀取失敗。')
    }
  }

  const addLibraryRecord = () => {
    if (!form.title.trim() || !form.summary.trim()) {
      setRequestError('請先填標題與摘要。')
      return
    }

    const timestamp = new Date().toISOString()
    const nextRecord: StrategyRecord = {
      id: `${form.kind}-${slugify(form.title)}-${Math.random().toString(36).slice(2, 8)}`,
      kind: form.kind,
      title: form.title.trim(),
      summary: form.summary.trim(),
      standardTags: form.standardTags,
      freeformTags: form.freeformTags
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      status: 'active',
      notes: form.notes.trim(),
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    setState((current) => ({
      ...current,
      library: [nextRecord, ...current.library],
    }))

    if (nextRecord.kind === 'use_case') {
      setBatchForm((current) => ({ ...current, useCaseId: nextRecord.id }))
    } else {
      setBatchForm((current) => ({
        ...current,
        benefitIds: current.benefitIds.includes(nextRecord.id)
          ? current.benefitIds
          : [...current.benefitIds, nextRecord.id].slice(0, 6),
      }))
    }

    setForm(buildEmptyForm())
    setRequestError(null)
  }

  const handleGenerateBatch = async () => {
    if (!batchForm.useCaseId || !batchForm.productName.trim() || batchForm.benefitIds.length < 3 || !logoFile) {
      setRequestError('請填完產品名稱、至少 3 個 benefits，並上傳 logo。')
      return
    }

    const useCase = activeLibrary.find((record) => record.id === batchForm.useCaseId)
    const benefits = batchForm.benefitIds
      .map((id) => activeLibrary.find((record) => record.id === id))
      .filter((record): record is StrategyRecord => Boolean(record))

    if (!useCase || benefits.length < 3) {
      setRequestError('目前的 use case / benefits 不完整，請重新確認。')
      return
    }

    const payload = new FormData()
    payload.append('productName', batchForm.productName.trim())
    payload.append('useCaseId', useCase.id)
    payload.append('useCaseTitle', useCase.title)
    payload.append('benefitIds', JSON.stringify(batchForm.benefitIds))
    payload.append('benefitTitles', JSON.stringify(benefits.map((benefit) => benefit.title)))
    payload.append('productLink', batchForm.productLink.trim())
    payload.append('additionalNotes', batchForm.additionalNotes.trim())
    payload.append('logo', logoFile)

    if (productImageFile) {
      payload.append('productImage', productImageFile)
    }

    setRequestError(null)
    setArchiveMessage(null)
    setBatchStatusMessage('正在生成 review creatives...')
    setIsGeneratingBatch(true)

    try {
      const [response] = await Promise.all([
        fetch(`${CREATIVE_API_BASE}/generate-review`, {
          method: 'POST',
          body: payload,
        }),
        waitAtLeast(800),
      ])

      if (!response.ok) {
        throw new Error(await readErrorMessage(response))
      }

      const result = (await response.json()) as ReviewResponse
      const timestamp = new Date().toISOString()
      const angleId = `ANGLE-${slugify(useCase.title)}-${slugify(benefits[0].title)}`.toUpperCase().slice(0, 28)
      const creativeIds = result.creatives.map((creative) => `${result.batchId}:${creative.creativeId}`)
      const batch: CreativeBatch = {
        id: result.batchId,
        useCaseId: useCase.id,
        productName: batchForm.productName.trim(),
        benefitIds: batchForm.benefitIds,
        angleId,
        promptVersion: result.promptVersion,
        productLink: batchForm.productLink.trim(),
        logoAsset: logoFile.name,
        productAsset: productImageFile?.name ?? '',
        additionalNotes: batchForm.additionalNotes.trim(),
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
          icp: 'TW',
          useCaseId: useCase.id,
          productName: batchForm.productName.trim(),
          benefitIds: batchForm.benefitIds,
          productLink: batchForm.productLink.trim(),
          logoAsset: logoFile.name,
          productAsset: productImageFile?.name ?? '',
          additionalNotes: batchForm.additionalNotes.trim(),
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
      setBatchStatusMessage(`已生成 ${creatives.length} 組 review creatives，選平台後直接 approve 即會寫入資料庫。`)
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : '批次生成失敗。')
      setBatchStatusMessage(null)
    } finally {
      setIsGeneratingBatch(false)
    }
  }

  const toggleCreativePlatform = (creativeId: string, platform: Platform) => {
    setState((current) => ({
      ...current,
      creatives: current.creatives.map((creative) => {
        if (creative.id !== creativeId) {
          return creative
        }

        const selectedPlatforms = creative.selectedPlatforms.includes(platform)
          ? creative.selectedPlatforms.filter((item) => item !== platform)
          : [...creative.selectedPlatforms, platform]

        return {
          ...creative,
          selectedPlatforms,
        }
      }),
    }))
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
            }
          : creative,
      ),
    }))
  }

  const approveCreative = async (creativeId: string) => {
    const creative = state.creatives.find((item) => item.id === creativeId)
    if (!creative || creative.selectedPlatforms.length === 0) {
      setRequestError('請先選至少 1 個平台，再按 approve。')
      return
    }

    setApprovingCreativeId(creativeId)
    setRequestError(null)
    setArchiveMessage(null)

    try {
      const result = await requestFormatsForCreative(creative)
      const normalizedAssets = normalizeReturnedAssets(result.assetDeliverables)
      const primaryCopy = result.copyDeliverables?.meta_ad ?? result.finalCopy ?? null
      const approvedCreative: CreativeAsset = {
        ...creative,
        reviewStatus: 'approved',
        rejectionReason: null,
        formatStatus: 'formats_ready',
        finalCopy: primaryCopy,
        copyDeliverables: result.copyDeliverables ?? null,
        assetDeliverables: normalizedAssets,
      }

      setState((current) => ({
        ...current,
        creatives: current.creatives.map((item) => (item.id === creativeId ? approvedCreative : item)),
      }))
      await upsertApprovedArchive(buildArchiveRecord(approvedCreative))
      await loadArchive(`已將 ${approvedCreative.creativeVersion} 存進 approved archive。`)
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'approve 失敗。')
    } finally {
      setApprovingCreativeId(null)
    }
  }

  const approveAllPending = async () => {
    const queue = pendingCreatives.filter((creative) => creative.selectedPlatforms.length > 0)
    if (queue.length === 0) {
      setRequestError('目前沒有可 approve 的 creative。')
      return
    }

    setIsApprovingBatch(true)
    setRequestError(null)
    setArchiveMessage(null)

    const failures: string[] = []
    let successCount = 0

    try {
      for (const creative of queue) {
        try {
          const result = await requestFormatsForCreative(creative)
          const normalizedAssets = normalizeReturnedAssets(result.assetDeliverables)
          const primaryCopy = result.copyDeliverables?.meta_ad ?? result.finalCopy ?? null
          const approvedCreative: CreativeAsset = {
            ...creative,
            reviewStatus: 'approved',
            rejectionReason: null,
            formatStatus: 'formats_ready',
            finalCopy: primaryCopy,
            copyDeliverables: result.copyDeliverables ?? null,
            assetDeliverables: normalizedAssets,
          }

          setState((current) => ({
            ...current,
            creatives: current.creatives.map((item) => (item.id === creative.id ? approvedCreative : item)),
          }))
          await upsertApprovedArchive(buildArchiveRecord(approvedCreative))
          successCount += 1
        } catch (error) {
          failures.push(error instanceof Error ? `${creative.creativeVersion}: ${error.message}` : creative.creativeVersion)
        }
      }

      await loadArchive(successCount > 0 ? `已新增 ${successCount} 筆 approved creative 到資料庫。` : undefined)

      if (failures.length > 0) {
        setRequestError(failures.join(' | '))
      }
    } finally {
      setIsApprovingBatch(false)
    }
  }

  const activeUseCases = activeLibrary.filter((record) => record.kind === 'use_case')
  const activeBenefits = activeLibrary.filter((record) => record.kind === 'benefit')

  return (
    <div className="shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <img className="brand-mark" src={logoUrl} alt="lihi logo" />
          <div>
            <p className="eyebrow">lihiSMS creative archive</p>
            <h1>Approved 後直接進資料庫，不再經過 Facebook MCP。</h1>
            <p className="hero-note">
              流程只保留三段：生成 review creatives、人工 approve、寫入 approved archive database。
            </p>
          </div>
        </div>
        <div className="hero-metrics">
          <article>
            <span>Latest Batch</span>
            <strong>{latestBatch ? latestBatch.productName : '尚未生成'}</strong>
          </article>
          <article>
            <span>Pending Review</span>
            <strong>{pendingCreatives.length}</strong>
          </article>
          <article>
            <span>Approved DB Rows</span>
            <strong>{archive.length}</strong>
          </article>
        </div>
      </section>

      <section className="dashboard">
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Step 1</p>
              <h2>Strategy Library</h2>
            </div>
            <div className="segment">
              <button
                className={selectedKind === 'use_case' ? 'segment-button active' : 'segment-button'}
                onClick={() => {
                  setSelectedKind('use_case')
                  setForm((current) => ({ ...current, kind: 'use_case' }))
                }}
                type="button"
              >
                Use case
              </button>
              <button
                className={selectedKind === 'benefit' ? 'segment-button active' : 'segment-button'}
                onClick={() => {
                  setSelectedKind('benefit')
                  setForm((current) => ({ ...current, kind: 'benefit' }))
                }}
                type="button"
              >
                Benefit
              </button>
            </div>
          </div>

          <div className="field-grid">
            <label>
              <span>Title</span>
              <input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value, kind: selectedKind }))}
                placeholder={selectedKind === 'use_case' ? '例如：會員喚回' : '例如：可追蹤點擊'}
              />
            </label>
            <label className="span-two">
              <span>Summary</span>
              <textarea
                rows={3}
                value={form.summary}
                onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value, kind: selectedKind }))}
              />
            </label>
            <label>
              <span>Standard Tags</span>
              <select
                value=""
                onChange={(event) => {
                  const value = event.target.value
                  if (!value) return
                  setForm((current) => ({
                    ...current,
                    kind: selectedKind,
                    standardTags: current.standardTags.includes(value)
                      ? current.standardTags
                      : [...current.standardTags, value],
                  }))
                }}
              >
                <option value="">選一個 tag</option>
                {standardTagBank[selectedKind].map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Freeform Tags</span>
              <input
                value={form.freeformTags}
                onChange={(event) => setForm((current) => ({ ...current, freeformTags: event.target.value, kind: selectedKind }))}
                placeholder="逗號分隔"
              />
            </label>
            <label className="span-two">
              <span>Notes</span>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value, kind: selectedKind }))}
              />
            </label>
          </div>

          <div className="pill-row">
            {form.standardTags.map((tag) => (
              <button
                key={tag}
                className="pill active"
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    standardTags: current.standardTags.filter((item) => item !== tag),
                  }))
                }
              >
                {tag}
              </button>
            ))}
          </div>

          <div className="panel-actions">
            <button className="primary-button" type="button" onClick={addLibraryRecord}>
              Add to library
            </button>
          </div>

          <div className="library-columns">
            <div>
              <p className="eyebrow">Use Cases</p>
              <div className="list-stack">
                {activeUseCases.map((record) => (
                  <article key={record.id} className="library-card">
                    <strong>{record.title}</strong>
                    <p>{record.summary}</p>
                  </article>
                ))}
              </div>
            </div>
            <div>
              <p className="eyebrow">Benefits</p>
              <div className="list-stack">
                {activeBenefits.map((record) => (
                  <article key={record.id} className="library-card">
                    <strong>{record.title}</strong>
                    <p>{record.summary}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Step 2</p>
              <h2>Generate Review Batch</h2>
            </div>
          </div>

          <div className="field-grid">
            <label>
              <span>Use Case</span>
              <select
                value={batchForm.useCaseId}
                onChange={(event) => setBatchForm((current) => ({ ...current, useCaseId: event.target.value }))}
              >
                {activeUseCases.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Product Name</span>
              <input
                value={batchForm.productName}
                onChange={(event) => setBatchForm((current) => ({ ...current, productName: event.target.value }))}
              />
            </label>
            <label className="span-two">
              <span>Benefits</span>
              <div className="pill-row">
                {activeBenefits.map((benefit) => {
                  const active = batchForm.benefitIds.includes(benefit.id)
                  return (
                    <button
                      key={benefit.id}
                      className={active ? 'pill active' : 'pill'}
                      type="button"
                      onClick={() =>
                        setBatchForm((current) => ({
                          ...current,
                          benefitIds: active
                            ? current.benefitIds.filter((item) => item !== benefit.id)
                            : [...current.benefitIds, benefit.id],
                        }))
                      }
                    >
                      {benefit.title}
                    </button>
                  )
                })}
              </div>
            </label>
            <label>
              <span>Product Link</span>
              <input
                value={batchForm.productLink}
                onChange={(event) => setBatchForm((current) => ({ ...current, productLink: event.target.value }))}
                placeholder="https://"
              />
            </label>
            <label>
              <span>Logo</span>
              <input type="file" accept="image/*" onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)} />
            </label>
            <label>
              <span>Product Image</span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => setProductImageFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label className="span-two">
              <span>Additional Notes</span>
              <textarea
                rows={3}
                value={batchForm.additionalNotes}
                onChange={(event) => setBatchForm((current) => ({ ...current, additionalNotes: event.target.value }))}
              />
            </label>
          </div>

          <div className="panel-actions">
            <button className="primary-button" type="button" disabled={isGeneratingBatch} onClick={handleGenerateBatch}>
              {isGeneratingBatch ? 'Generating…' : 'Generate review creatives'}
            </button>
          </div>

          {batchStatusMessage ? <p className="status-note success">{batchStatusMessage}</p> : null}
          {requestError ? <p className="status-note error">{requestError}</p> : null}
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Step 3</p>
            <h2>Review Queue</h2>
          </div>
          <div className="panel-actions compact">
            <button className="primary-button" type="button" disabled={isApprovingBatch} onClick={approveAllPending}>
              {isApprovingBatch ? 'Approving…' : 'Approve all selected'}
            </button>
          </div>
        </div>

        {latestBatch ? (
          <div className="batch-banner">
            <div>
              <strong>{latestBatch.productName}</strong>
              <span>{latestBatch.angleId}</span>
            </div>
            <div>
              <strong>{pendingCreatives.length}</strong>
              <span>pending</span>
            </div>
            <div>
              <strong>{approvedCreatives.length}</strong>
              <span>approved</span>
            </div>
          </div>
        ) : (
          <p className="empty-state">還沒有 batch。先從上面生成 review creatives。</p>
        )}

        <div className="creative-grid">
          {latestBatchCreatives.map((creative) => {
            const primaryCopy = getPrimaryCopy(creative)
            return (
              <article key={creative.id} className="creative-card">
                <div className="creative-image-wrap">
                  <img src={creative.squareAsset} alt={creative.headline} className="creative-image" />
                  <span className={`status-chip ${creative.reviewStatus}`}>{creative.reviewStatus}</span>
                </div>
                <div className="creative-copy">
                  <p className="eyebrow">{creative.creativeVersion}</p>
                  <h3>{creative.headline}</h3>
                  <p className="muted">{creative.kicker}</p>
                  <p>{creative.body}</p>
                  <div className="meta-row">
                    <span>{creative.copyMode}</span>
                    <span>{formatStylePreset(creative.stylePreset)}</span>
                    <span>{creative.visualMode}</span>
                  </div>
                </div>
                <div className="platform-grid">
                  {platformOptions.map((platform) => (
                    <label key={platform} className="checkbox-pill">
                      <input
                        type="checkbox"
                        checked={creative.selectedPlatforms.includes(platform)}
                        onChange={() => toggleCreativePlatform(creative.id, platform)}
                      />
                      <span>{platform}</span>
                    </label>
                  ))}
                </div>
                <div className="panel-actions">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={approvingCreativeId === creative.id}
                    onClick={() => approveCreative(creative.id)}
                  >
                    {approvingCreativeId === creative.id ? 'Approving…' : 'Approve to DB'}
                  </button>
                  <select
                    value=""
                    onChange={(event) => {
                      if (event.target.value) {
                        rejectCreative(creative.id, event.target.value)
                      }
                    }}
                  >
                    <option value="">Reject reason</option>
                    {rejectionReasons.map((reason) => (
                      <option key={reason} value={reason}>
                        {reason}
                      </option>
                    ))}
                  </select>
                </div>

                {primaryCopy ? (
                  <div className="approved-copy-box">
                    <strong>Approved Copy</strong>
                    <p>{primaryCopy.primaryText}</p>
                    <span>{primaryCopy.headline}</span>
                  </div>
                ) : null}

                {creative.assetDeliverables.length > 0 ? (
                  <div className="asset-list">
                    {creative.assetDeliverables.map((asset) => (
                      <a key={`${asset.platform}-${asset.surface}-${asset.url}`} href={asset.url} target="_blank" rel="noreferrer">
                        {asset.platform} · {asset.surface} · {asset.aspectRatio}
                      </a>
                    ))}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Approved Archive</p>
            <h2>IndexedDB Database</h2>
          </div>
          <div className="panel-actions compact">
            <input
              className="search-input"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search copy / platform / version"
            />
            <button className="ghost-button" type="button" onClick={() => void loadArchive()}>
              Reload
            </button>
          </div>
        </div>

        <div className="archive-banner">
          <span>DB status: {archiveStatus}</span>
          <span>{archive.length} rows</span>
          <span>來源條件：只有 approved creative 才會寫入</span>
        </div>

        {archiveMessage ? <p className="status-note success">{archiveMessage}</p> : null}
        {archiveError ? <p className="status-note error">{archiveError}</p> : null}

        {filteredArchive.length === 0 ? (
          <p className="empty-state">資料庫目前還沒有 approved creative。</p>
        ) : (
          <div className="archive-list">
            {filteredArchive.map((item) => (
              <article key={item.id} className="archive-card">
                <img src={item.squareAsset} alt={item.headline} className="archive-thumb" />
                <div className="archive-copy">
                  <div className="archive-header">
                    <div>
                      <p className="eyebrow">{item.creativeVersion}</p>
                      <h3>{item.finalCopy?.headline || item.headline}</h3>
                    </div>
                    <span>{formatDateTime(item.approvedAt)}</span>
                  </div>
                  <p>{item.finalCopy?.primaryText || item.body}</p>
                  <div className="meta-row">
                    <span>{item.productName}</span>
                    <span>{item.selectedPlatforms.join(' / ')}</span>
                    <span>{item.copyMode}</span>
                  </div>
                  <div className="asset-list">
                    {item.assetDeliverables.map((asset) => (
                      <a key={`${item.id}-${asset.url}`} href={asset.url} target="_blank" rel="noreferrer">
                        {asset.platform} · {asset.surface} · {asset.aspectRatio}
                      </a>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default App

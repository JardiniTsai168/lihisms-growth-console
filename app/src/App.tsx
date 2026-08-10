import { useMemo, useState } from 'react'
import './App.css'
import { initialState, standardTagBank } from './seed'
import { buildRecommendations } from './recommendations'
import type {
  AnalyticsMetric,
  AppState,
  CreativeAsset,
  CreativeBatch,
  DraftAd,
  LibraryKind,
  OptimizationRules,
  Platform,
  StrategyRecord,
} from './types'
import { usePersistentState } from './usePersistentState'

const STORAGE_KEY = 'lihisms-growth-console-v5'
const CREATIVE_API_BASE = 'https://creative.bktsai.link/internal'

type ReviewResponse = {
  batchId: string
  promptVersion: string
  creatives: Array<{
    creativeId: string
    creativeVersion: string
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
  finalCopy: {
    primaryText: string
    headline: string
    description: string
    destinationUrl: string
  }
  assetDeliverables: Array<{
    platform: string
    label: string
    url: string
    width: number
    height: number
    mimeType: string
  }>
}

const rejectionReasons = [
  '賣點不對',
  '文案太弱',
  '視覺不佳',
  '不像 lihi',
  '不適合投放',
  '其他',
]

const platformOptions: Platform[] = ['Facebook', 'Instagram', 'Google Display', 'LINE']

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

function App() {
  const logoUrl = `${import.meta.env.BASE_URL}lihi-logo-primary.png`
  const [state, setState] = usePersistentState<AppState>(STORAGE_KEY, initialState)
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

  const latestBatchLooksStub = batchCreatives.length > 0 && batchCreatives.every((creative) => {
    const stubSignal = `${creative.deliveryNote} ${creative.body} ${creative.squareAsset}`.toLowerCase()
    return stubSignal.includes('stub') || stubSignal.includes('/assets/creative_00')
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
      const creativeIds = result.creatives.map((creative) => creative.creativeId)
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
        id: creative.creativeId,
        batchId: result.batchId,
        angleId,
        creativeVersion: creative.creativeVersion,
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
          formatStatus:
            creative.reviewStatus === 'approved' && selectedPlatforms.length > 0
              ? 'formats_ready'
              : 'square_only',
        }
      }),
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
      const response = await fetch(`${CREATIVE_API_BASE}/generate-formats`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          batchId: creative.batchId,
          creativeId,
          selectedPlatforms: creative.selectedPlatforms,
        }),
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response))
      }

      const result = (await response.json()) as FormatsResponse

      setState((current) => ({
        ...current,
        creatives: current.creatives.map((item) =>
          item.id === creativeId
            ? {
                ...item,
                reviewStatus: 'approved',
                rejectionReason: null,
                formatStatus: 'formats_ready',
                finalCopy: result.finalCopy,
                assetDeliverables: result.assetDeliverables,
              }
            : item,
        ),
      }))
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : '版位生成失敗。')
    } finally {
      setApprovingCreativeId(null)
    }
  }

  const createDraftAds = () => {
    if (approvedReadyForDraft.length === 0) {
      return
    }

    const createdAt = new Date().toISOString()

    const newDrafts: DraftAd[] = approvedReadyForDraft.map((creative) => ({
      id: `draft-${creative.id}`,
      creativeId: creative.id,
      batchId: creative.batchId,
      status: 'draft',
      campaignName: `lihiSMS | 電商品牌 | ${lookupRecord(state.library, creative.metadata.useCaseId)?.title ?? '未命名'}`,
      adsetName: `${lookupRecord(state.library, creative.metadata.useCaseId)?.title ?? 'Use Case'} / ${creative.selectedPlatforms.join(', ')}`,
      adName: `${creative.angleId} / ${creative.creativeVersion}`,
      primaryText: creative.finalCopy?.primaryText ?? creative.body,
      headline: creative.finalCopy?.headline ?? creative.headline,
      description:
        creative.finalCopy?.description ??
        'creative.bktsai.link 已依勾選平台回傳正確尺寸素材。',
      destinationUrl:
        creative.finalCopy?.destinationUrl ||
        creative.metadata.productLink ||
        'https://lihi.io/products/sms',
      assetDeliverables: buildAssetDeliverables(creative),
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
      publishedAt: null,
    }))

    setState((current) => ({
      ...current,
      drafts: [...newDrafts, ...current.drafts],
    }))
  }

  const publishDraft = (draftId: string) => {
    const timestamp = new Date().toISOString()
    setState((current) => ({
      ...current,
      drafts: current.drafts.map((draft) =>
        draft.id === draftId
          ? { ...draft, status: 'published', publishedAt: timestamp }
          : draft,
      ),
    }))
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

          <div className="builder-flow">
            <span>Stage 1: send product + use case + benefits + assets</span>
            <span>Random style / copy mode / emotion 1-5</span>
            <span>Return copy + 1:1 creative first</span>
            <span>Stage 2: Approved 後依平台回傳正確尺寸</span>
          </div>

          <div className="api-spec-grid">
            <article className="api-spec-card">
              <p className="eyebrow">Stage 1 / Request</p>
              <h3>Send to creative.bktsai.link</h3>
              <p>產品名稱、use case、3-5 benefits、product link、logo、product image、補充內容。</p>
            </article>
            <article className="api-spec-card">
              <p className="eyebrow">Stage 1 / Response</p>
              <h3>Review Payload</h3>
              <p>回傳文案、1:1 素材、creative ids，讓使用者先做人審與平台勾選。</p>
            </article>
            <article className="api-spec-card">
              <p className="eyebrow">Stage 2 / Approved</p>
              <h3>Platform-based Return</h3>
              <p>送出 approved creative 與勾選平台，creative.bktsai.link 自動回傳該平台正確尺寸與最終文案。</p>
            </article>
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
              <span>angle_id: {latestBatch.angleId}</span>
              <span>prompt_version: {latestBatch.promptVersion}</span>
              <span>route: creative.bktsai.link</span>
              <span>created_at: {formatDate(latestBatch.createdAt)}</span>
            </div>
          ) : null}
        </section>

        <section className="panel span-two">
          <div className="panel-header">
            <div>
              <p className="eyebrow">03 / Review + platform approval</p>
              <h2>人工審核、平台選擇、回傳剩餘版型</h2>
            </div>
            <span className="pill muted">先選平台，再按 Approved</span>
          </div>

          {latestBatchLooksStub ? (
            <p className="helper-copy warning-banner">
              目前後端回來的仍是 stub 素材與 stub 文案，代表前端已串上 live endpoint，但 creative.bktsai.link 尚未切到真生成流程。
            </p>
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
                      <span>{creative.angleId}</span>
                      <span>{creative.creativeVersion}</span>
                    </footer>
                  </div>
                  <div className="creative-meta">
                    <div className="tag-row">
                      <span className="tag">{creative.metadata.icp}</span>
                      <span className="tag">{creative.promptVersion}</span>
                      <span className="tag subtle">1:1 {assetLabelFromUrl(creative.squareAsset)}</span>
                    </div>
                    <div className="creative-return">
                      <span>Product: {creative.metadata.productName}</span>
                      <span>Copy mode: {creative.copyMode}</span>
                      <span>Emotion: {creative.emotionalIntensity}/5</span>
                      <span>Model: {creative.modelSetting}</span>
                      <span>Logo: {creative.metadata.logoAsset}</span>
                      <span>Product: {creative.metadata.productAsset || 'none'}</span>
                      <span>
                        Deliverables: {creative.assetDeliverables.length > 0 ? creative.assetDeliverables.length : 'pending'}
                      </span>
                    </div>
                    <div>
                      <span className="field-label">Platforms</span>
                      <div className="platform-grid">
                        {platformOptions.map((platform) => (
                          <button
                            key={platform}
                            type="button"
                            className={
                              creative.selectedPlatforms.includes(platform)
                                ? 'reason-chip active'
                                : 'reason-chip'
                            }
                            onClick={() => toggleCreativePlatform(creative.id, platform)}
                          >
                            {platform}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="review-actions">
                      <button
                        type="button"
                        className={creative.reviewStatus === 'approved' ? 'mini-button success' : 'mini-button'}
                        disabled={approvingCreativeId === creative.id}
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
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">04 / Draft builder</p>
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
                  <div className="draft-schema">
                    <span>Product: {draft.metadata.productName}</span>
                    <span>Primary text: {draft.primaryText}</span>
                    <span>Headline: {draft.headline}</span>
                    <span>Description: {draft.description}</span>
                    <span>URL: {draft.destinationUrl}</span>
                  </div>
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
                      className="mini-button"
                      onClick={() => publishDraft(draft.id)}
                    >
                      Mark draft published
                    </button>
                  ) : (
                    <span className="helper-copy">
                      Published {draft.publishedAt ? formatDate(draft.publishedAt) : ''}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">05 / Funnel analytics</p>
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
              <p className="eyebrow">06 / Optimization rules</p>
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
              <p className="eyebrow">07 / Next-step recommendations</p>
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
      return `${asset.platform}: ${asset.label} ${asset.width}x${asset.height}`
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

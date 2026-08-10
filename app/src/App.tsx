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

const STORAGE_KEY = 'lihisms-growth-console-v2'

const rejectionReasons = [
  '賣點不對',
  '文案太弱',
  '視覺不佳',
  '不像 lihi',
  '不適合投放',
  '其他',
]

const colorModes = ['Signal board', 'Proof ledger', 'Promo burst']
const copyModes: CreativeAsset['copyMode'][] = ['品牌', '轉單']
const modelSettings = ['產品主視覺', '隨機模特兒', '產品情境照']
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
  productLink: '',
  logoAsset: '',
  productAsset: '',
  standardTags: [] as string[],
  freeformTags: '',
})

const buildBatchForm = (library: StrategyRecord[]) => {
  const useCase = library.find((record) => record.kind === 'use_case' && record.status === 'active')
  const benefits = library.filter((record) => record.kind === 'benefit' && record.status === 'active')

  return {
    useCaseId: useCase?.id ?? '',
    benefitIds: benefits.slice(0, 3).map((item) => item.id),
    productLink: useCase?.productLink ?? '',
    logoAsset: useCase?.logoAsset ?? 'lihi-logo-primary.png',
    productAsset: useCase?.productAsset ?? '',
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

  const activeLibrary = state.library.filter((record) => record.status === 'active')
  const latestBatch = state.batches[0]

  const availableLogoAssets = Array.from(
    new Set(
      activeLibrary
        .map((record) => record.logoAsset.trim())
        .filter(Boolean)
        .concat('lihi-logo-primary.png'),
    ),
  )

  const availableProductAssets = Array.from(
    new Set(
      activeLibrary
        .map((record) => record.productAsset.trim())
        .filter(Boolean),
    ),
  )

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
      productLink: form.productLink.trim(),
      logoAsset: form.logoAsset.trim(),
      productAsset: form.productAsset.trim(),
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
      productLink: record.productLink,
      logoAsset: record.logoAsset,
      productAsset: record.productAsset,
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
    const useCase = activeLibrary.find((record) => record.id === useCaseId)
    setBatchForm((current) => ({
      ...current,
      useCaseId,
      productLink: useCase?.productLink ?? current.productLink,
      logoAsset: useCase?.logoAsset ?? current.logoAsset,
      productAsset: useCase?.productAsset ?? current.productAsset,
    }))
  }

  const handleGenerateBatch = () => {
    if (
      !batchForm.useCaseId ||
      batchForm.benefitIds.length < 3 ||
      !batchForm.logoAsset.trim()
    ) {
      return
    }

    const timestamp = new Date().toISOString()
    const useCase = activeLibrary.find((record) => record.id === batchForm.useCaseId)
    const benefits = batchForm.benefitIds
      .map((id) => activeLibrary.find((record) => record.id === id))
      .filter((record): record is StrategyRecord => Boolean(record))

    if (!useCase || benefits.length < 3) {
      return
    }

    const angleId = `ANGLE-${slugify(useCase.title)}-${slugify(benefits[0].title)}`
      .toUpperCase()
      .slice(0, 28)
    const batchId = `batch-${timestamp}`
    const promptVersion = `v2.${state.batches.length + 1}.0`
    const productLink = batchForm.productLink.trim() || useCase.productLink
    const logoAsset = batchForm.logoAsset.trim()
    const productAsset = batchForm.productAsset.trim()
    const additionalNotes = batchForm.additionalNotes.trim()

    const creativeIds = Array.from(
      { length: 3 },
      (_, index) => `creative-${timestamp}-${index + 1}`,
    )

    const batch: CreativeBatch = {
      id: batchId,
      useCaseId: useCase.id,
      benefitIds: batchForm.benefitIds,
      angleId,
      promptVersion,
      productLink,
      logoAsset,
      productAsset,
      additionalNotes,
      createdAt: timestamp,
      creativeIds,
    }

    const creatives: CreativeAsset[] = creativeIds.map((id, index) => {
      const leadBenefit = benefits[index % benefits.length]
      const supportBenefit = benefits[(index + 1) % benefits.length]
      const seed = stringScore(`${angleId}-${id}`)
      const copyMode = copyModes[seed % copyModes.length]
      const emotionalIntensity = (seed % 5) + 1
      const visualMode = colorModes[(seed + index) % colorModes.length]
      const modelSetting = modelSettings[(seed + benefits.length) % modelSettings.length]

      return {
        id,
        batchId,
        angleId,
        creativeVersion: `A${index + 1}`,
        headline:
          copyMode === '品牌'
            ? `${useCase.title}，把 SMS 變成可回溯的成長節奏`
            : `${useCase.title}，把每次簡訊更推近轉單一步`,
        kicker: `${copyMode}文案 / ${visualMode}`,
        body: `creative.bktsai.link 已收到 ${useCase.title}、${leadBenefit.title}、${supportBenefit.title}、產品連結與補充內容，先回傳這張 1:1 給你審核。`,
        proofLine: `風格隨機 · ${copyMode}導向 · 感性/理性強度 ${emotionalIntensity}/5`,
        visualMode,
        squareAsset: `${slugify(useCase.title)}-${index + 1}-1x1.png`,
        formatStatus: 'square_only',
        selectedPlatforms: [],
        copyMode,
        emotionalIntensity,
        modelSetting,
        metadata: {
          icp: '電商品牌',
          useCaseId: useCase.id,
          benefitIds: batchForm.benefitIds,
          productLink,
          logoAsset,
          productAsset,
          additionalNotes,
          createdAt: timestamp,
        },
        promptVersion,
        reviewStatus: 'pending',
        rejectionReason: null,
      }
    })

    setState((current) => ({
      ...current,
      batches: [batch, ...current.batches],
      creatives: [...creatives, ...current.creatives],
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

  const approveCreative = (creativeId: string) => {
    setState((current) => ({
      ...current,
      creatives: current.creatives.map((creative) =>
        creative.id === creativeId && creative.selectedPlatforms.length > 0
          ? {
              ...creative,
              reviewStatus: 'approved',
              rejectionReason: null,
              formatStatus: 'formats_ready',
            }
          : creative,
      ),
    }))
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
      metadata: {
        icp: creative.metadata.icp,
        useCaseId: creative.metadata.useCaseId,
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
                {(['use_case', 'benefit', 'proof', 'template'] as LibraryKind[]).map(
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
                      {record.productLink || record.logoAsset || record.productAsset ? (
                        <div className="library-meta-strip">
                          {record.productLink ? <span>Link: {record.productLink}</span> : null}
                          {record.logoAsset ? <span>Logo: {record.logoAsset}</span> : null}
                          {record.productAsset ? <span>Product: {record.productAsset}</span> : null}
                        </div>
                      ) : null}
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
                  <option value="proof">proof</option>
                  <option value="template">template</option>
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
              <label>
                Product / service link
                <input
                  placeholder="https://..."
                  value={form.productLink}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      productLink: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="asset-grid">
                <label>
                  Logo upload area
                  <input
                    placeholder="logo file name or CDN URL"
                    value={form.logoAsset}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        logoAsset: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Product image upload area
                  <input
                    placeholder="product asset file name or CDN URL"
                    value={form.productAsset}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        productAsset: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
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
            <span className="pill active">creative.bktsai.link demo mode</span>
          </div>

          <div className="builder-flow">
            <span>Send use case + benefits + product link + extra notes</span>
            <span>Random style / copy mode / emotion 1-5</span>
            <span>Return copy + 1:1 creative first</span>
            <span>Approved 後補齊其他格式並進 draft builder</span>
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
                <select
                  value={batchForm.logoAsset}
                  onChange={(event) =>
                    setBatchForm((current) => ({
                      ...current,
                      logoAsset: event.target.value,
                    }))
                  }
                >
                  {availableLogoAssets.map((asset) => (
                    <option key={asset} value={asset}>
                      {asset}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Product image optional
                <select
                  value={batchForm.productAsset}
                  onChange={(event) =>
                    setBatchForm((current) => ({
                      ...current,
                      productAsset: event.target.value,
                    }))
                  }
                >
                  <option value="">No product image</option>
                  {availableProductAssets.map((asset) => (
                    <option key={asset} value={asset}>
                      {asset}
                    </option>
                  ))}
                </select>
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

          <button className="primary-button" type="button" onClick={handleGenerateBatch}>
            Generate Ads
          </button>

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

          <div className="creative-grid">
            {batchCreatives.map((creative) => (
              <article key={creative.id} className={`creative-card mode-${slugify(creative.visualMode)}`}>
                <div className="creative-poster">
                  <p className="poster-kicker">{creative.kicker}</p>
                  <h3>{creative.headline}</h3>
                  <p>{creative.body}</p>
                  <strong>{creative.proofLine}</strong>
                  <footer>
                    <span>{creative.angleId}</span>
                    <span>{creative.creativeVersion}</span>
                  </footer>
                </div>
                <div className="creative-meta">
                  <div className="tag-row">
                    <span className="tag">{creative.metadata.icp}</span>
                    <span className="tag">{creative.promptVersion}</span>
                    <span className="tag subtle">1:1 {creative.squareAsset}</span>
                  </div>
                  <div className="creative-return">
                    <span>Copy mode: {creative.copyMode}</span>
                    <span>Emotion: {creative.emotionalIntensity}/5</span>
                    <span>Model: {creative.modelSetting}</span>
                    <span>Logo: {creative.metadata.logoAsset}</span>
                    <span>
                      Product: {creative.metadata.productAsset || 'none'}
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
                      onClick={() => approveCreative(creative.id)}
                    >
                      Approved
                    </button>
                    <p className="helper-copy">
                      {creative.selectedPlatforms.length > 0
                        ? `已選平台：${creative.selectedPlatforms.join(', ')}`
                        : '先選至少 1 個平台，系統才會補齊其他版位。'}
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
            ))}
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
                </div>
                <div className="draft-actions">
                  <span className="pill active">{draft.metadata.angleId}</span>
                  {draft.metadata.selectedPlatforms.map((platform) => (
                    <span key={platform} className="pill muted">
                      {platform}
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

export default App

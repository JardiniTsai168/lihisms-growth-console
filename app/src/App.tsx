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
  StrategyRecord,
} from './types'
import { usePersistentState } from './usePersistentState'

const STORAGE_KEY = 'lihisms-growth-console-v1'

const rejectionReasons = [
  '賣點不對',
  '文案太弱',
  '視覺不佳',
  '不像 lihi',
  '不適合投放',
  '其他',
]

const colorModes = ['Signal board', 'Proof ledger', 'Promo burst']

function App() {
  const logoUrl = `${import.meta.env.BASE_URL}lihi-logo-primary.png`
  const [state, setState] = usePersistentState<AppState>(STORAGE_KEY, initialState)
  const [selectedKind, setSelectedKind] = useState<LibraryKind>('use_case')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    kind: 'use_case' as LibraryKind,
    title: '',
    summary: '',
    notes: '',
    standardTags: [] as string[],
    freeformTags: '',
  })
  const [batchForm, setBatchForm] = useState(() => {
    const useCase = state.library.find((record) => record.kind === 'use_case' && record.status === 'active')
    const benefits = state.library.filter((record) => record.kind === 'benefit' && record.status === 'active')
    const proof = state.library.find((record) => record.kind === 'proof' && record.status === 'active')
    const template = state.library.find((record) => record.kind === 'template' && record.status === 'active')

    return {
      useCaseId: useCase?.id ?? '',
      benefitIds: benefits.slice(0, 2).map((item) => item.id),
      proofIds: proof ? [proof.id] : [],
      templateId: template?.id ?? '',
    }
  })

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
    return creative.reviewStatus === 'approved' && !alreadyDrafted
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
    setForm({
      kind: 'use_case',
      title: '',
      summary: '',
      notes: '',
      standardTags: [],
      freeformTags: '',
    })
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

  const handleGenerateBatch = () => {
    if (
      !batchForm.useCaseId ||
      batchForm.benefitIds.length === 0 ||
      !batchForm.templateId
    ) {
      return
    }

    const timestamp = new Date().toISOString()
    const useCase = activeLibrary.find((record) => record.id === batchForm.useCaseId)
    const benefits = batchForm.benefitIds
      .map((id) => activeLibrary.find((record) => record.id === id))
      .filter((record): record is StrategyRecord => Boolean(record))
    const proofs = batchForm.proofIds
      .map((id) => activeLibrary.find((record) => record.id === id))
      .filter((record): record is StrategyRecord => Boolean(record))
    const template = activeLibrary.find((record) => record.id === batchForm.templateId)

    if (!useCase || benefits.length === 0 || !template) {
      return
    }

    const angleId = `ANGLE-${slugify(useCase.title)}-${slugify(benefits[0].title)}`
      .toUpperCase()
      .slice(0, 28)

    const batchId = `batch-${timestamp}`
    const promptVersion = `v1.${state.batches.length + 1}.0`

    const creativeIds = Array.from({ length: 3 }, (_, index) => `creative-${timestamp}-${index + 1}`)
    const batch: CreativeBatch = {
      id: batchId,
      useCaseId: useCase.id,
      benefitIds: batchForm.benefitIds,
      proofIds: batchForm.proofIds,
      templateId: template.id,
      angleId,
      promptVersion,
      createdAt: timestamp,
      creativeIds,
    }

    const creatives: CreativeAsset[] = creativeIds.map((id, index) => {
      const leadBenefit = benefits[index % benefits.length]
      const proofLine = proofs[index % Math.max(proofs.length, 1)]?.title ?? '可搭配 CRM 接續推進'

      return {
        id,
        batchId,
        angleId,
        creativeVersion: `A${index + 1}`,
        headline: `${useCase.title}，現在可以連成效一起看`,
        kicker: `${leadBenefit.title} / ${template.title}`,
        body: `${useCase.summary} 主軸下，用 ${leadBenefit.summary} 去說服電商品牌把簡訊從單次發送，升級成可優化的 growth loop。`,
        proofLine,
        visualMode: colorModes[index % colorModes.length],
        metadata: {
          icp: '電商品牌',
          useCaseId: useCase.id,
          benefitIds: batchForm.benefitIds,
          proofIds: batchForm.proofIds,
          templateId: template.id,
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

  const updateCreativeReview = (
    creativeId: string,
    reviewStatus: CreativeAsset['reviewStatus'],
    rejectionReason: string | null,
  ) => {
    setState((current) => ({
      ...current,
      creatives: current.creatives.map((creative) =>
        creative.id === creativeId
          ? { ...creative, reviewStatus, rejectionReason }
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
      adsetName: `${lookupRecord(state.library, creative.metadata.useCaseId)?.title ?? 'Use Case'} / ${lookupRecord(state.library, creative.metadata.benefitIds[0])?.title ?? 'Benefit'}`,
      adName: `${creative.angleId} / ${creative.creativeVersion}`,
      metadata: {
        icp: creative.metadata.icp,
        useCaseId: creative.metadata.useCaseId,
        benefitIds: creative.metadata.benefitIds,
        proofIds: creative.metadata.proofIds,
        angleId: creative.angleId,
        creativeVersion: creative.creativeVersion,
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
      const seed = stringScore(`${draft.id}${useCaseTitle}${benefitTitle}`)
      const impressions = 1800 + (seed % 3200)
      const ctr = 1.1 + ((seed % 28) / 10)
      const clicks = Math.round((impressions * ctr) / 100)
      const spend = 900 + (seed % 2400)
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
          </div>
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
            <strong>系統只建議，你才執行</strong>
          </article>
        </div>
      </header>

      <section className="operating-contract">
        <div>
          <p className="eyebrow">Operating contract</p>
          <h2>第一版邊界</h2>
        </div>
        <ul>
          <li>每次只測 1 個 use case，搭配 1 到 2 個 benefits。</li>
          <li>每輪只產 3 張圖，走同一個 angle 的變體。</li>
          <li>素材先人工審核，再自動建 Facebook draft。</li>
          <li>Airbyte 只拉必要欄位，先不做全量 data warehouse。</li>
        </ul>
      </section>

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
            <span className="pill active">creative.bktsa.link demo mode</span>
          </div>

          <div className="builder-grid">
            <label>
              Use case
              <select
                value={batchForm.useCaseId}
                onChange={(event) =>
                  setBatchForm((current) => ({
                    ...current,
                    useCaseId: event.target.value,
                  }))
                }
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
              <span className="field-label">Benefits (1-2)</span>
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
                              ? [...current.benefitIds, record.id].slice(0, 2)
                              : current.benefitIds.filter((id) => id !== record.id)
                            return { ...current, benefitIds: next }
                          })
                        }
                      />
                      <span>{record.title}</span>
                    </label>
                  ))}
              </div>
            </div>

            <div>
              <span className="field-label">Proof tags</span>
              <div className="checkbox-grid">
                {activeLibrary
                  .filter((record) => record.kind === 'proof')
                  .map((record) => (
                    <label key={record.id} className="check-chip">
                      <input
                        type="checkbox"
                        checked={batchForm.proofIds.includes(record.id)}
                        onChange={(event) =>
                          setBatchForm((current) => ({
                            ...current,
                            proofIds: event.target.checked
                              ? [...current.proofIds, record.id]
                              : current.proofIds.filter((id) => id !== record.id),
                          }))
                        }
                      />
                      <span>{record.title}</span>
                    </label>
                  ))}
              </div>
            </div>

            <label>
              Prompt template
              <select
                value={batchForm.templateId}
                onChange={(event) =>
                  setBatchForm((current) => ({
                    ...current,
                    templateId: event.target.value,
                  }))
                }
              >
                {activeLibrary
                  .filter((record) => record.kind === 'template')
                  .map((record) => (
                    <option key={record.id} value={record.id}>
                      {record.title}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <button className="primary-button" type="button" onClick={handleGenerateBatch}>
            Generate 3-image batch
          </button>

          {latestBatch ? (
            <div className="metadata-strip">
              <span>angle_id: {latestBatch.angleId}</span>
              <span>prompt_version: {latestBatch.promptVersion}</span>
              <span>created_at: {formatDate(latestBatch.createdAt)}</span>
            </div>
          ) : null}
        </section>

        <section className="panel span-two">
          <div className="panel-header">
            <div>
              <p className="eyebrow">03 / Review board</p>
              <h2>人工審核與淘汰原因</h2>
            </div>
            <span className="pill muted">Tony keeps final approval power</span>
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
                  </div>
                  <div className="review-actions">
                    <button
                      type="button"
                      className={creative.reviewStatus === 'approved' ? 'mini-button success' : 'mini-button'}
                      onClick={() => updateCreativeReview(creative.id, 'approved', null)}
                    >
                      Approve
                    </button>
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
                          onClick={() => updateCreativeReview(creative.id, 'rejected', reason)}
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
              <p className="eyebrow">04 / Facebook drafts</p>
              <h2>Draft ad studio</h2>
            </div>
            <button className="primary-button" type="button" onClick={createDraftAds}>
              Build drafts from approved creatives
            </button>
          </div>

          <p className="helper-copy">
            Ready for draft: {approvedReadyForDraft.length} approved creatives
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
                  {draft.status === 'draft' ? (
                    <button
                      type="button"
                      className="mini-button"
                      onClick={() => publishDraft(draft.id)}
                    >
                      Publish manually
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
              <strong>NT${Math.round(funnelTotals.spend).toLocaleString()}</strong>
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
                      CTR {metric.ctr.toFixed(2)}% · CPC NT$
                      {metric.cpc.toFixed(1)} · verified {metric.emailVerifiedSignups}
                    </p>
                  </div>
                  <div className="analytics-numbers">
                    <span>Spend NT${metric.spend.toFixed(0)}</span>
                    <span>Impressions {metric.impressions}</span>
                    <span>
                      CPA{' '}
                      {metric.costPerVerifiedSignup === null
                        ? 'n/a'
                        : `NT$${metric.costPerVerifiedSignup.toFixed(0)}`}
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
              label="Min spend"
              value={state.rules.minSpend}
              onChange={(value) => updateRules({ minSpend: value })}
            />
            <RuleField
              label="Min impressions"
              value={state.rules.minImpressions}
              onChange={(value) => updateRules({ minImpressions: value })}
            />
            <RuleField
              label="CTR drop %"
              value={state.rules.ctrDropPercent}
              onChange={(value) => updateRules({ ctrDropPercent: value })}
            />
            <RuleField
              label="CPA lift %"
              value={state.rules.cpaLiftPercent}
              onChange={(value) => updateRules({ cpaLiftPercent: value })}
            />
            <RuleField
              label="Winner target CPA"
              value={state.rules.winnerTargetCpa}
              onChange={(value) => updateRules({ winnerTargetCpa: value })}
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
                <p>先發佈 draft，再跑一次 demo Airbyte sync，系統才有資料能判斷。</p>
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
      {label}
      <input
        type="number"
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

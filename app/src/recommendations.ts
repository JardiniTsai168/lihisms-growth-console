import type { AnalyticsMetric, DraftAd, OptimizationRules } from './types'

type Recommendation = {
  kind: 'stop' | 'keep' | 'generate'
  title: string
  body: string
}

export function buildRecommendations(
  drafts: DraftAd[],
  metrics: AnalyticsMetric[],
  rules: OptimizationRules,
) {
  const recommendations: Recommendation[] = []
  if (metrics.length === 0) {
    return recommendations
  }

  for (const metric of metrics) {
    const draft = drafts.find((item) => item.id === metric.draftId)
    if (!draft) {
      continue
    }

    const canJudge = metric.spend >= rules.minSpend

    if (canJudge && metric.ctr < rules.ctrGoal) {
      recommendations.push({
        kind: 'stop',
        title: `停掉 ${draft.adName}`,
        body: `CTR ${metric.ctr.toFixed(2)}% 已低於你設定的 ${rules.ctrGoal.toFixed(
          2,
        )}% 目標，建議先停掉這個素材。`,
      })
      continue
    }

    if (
      canJudge &&
      metric.costPerVerifiedSignup !== null &&
      metric.costPerVerifiedSignup > rules.maxCpa
    ) {
      recommendations.push({
        kind: 'stop',
        title: `收掉 ${draft.adName}`,
        body: `每個 email 驗證註冊成本 US$${metric.costPerVerifiedSignup.toFixed(
          2,
        )} 已高於你設定的 US$${rules.maxCpa.toFixed(2)} 上限，建議停掉。`,
      })
      continue
    }

    if (canJudge && metric.frequency > rules.maxFrequency) {
      recommendations.push({
        kind: 'stop',
        title: `暫停 ${draft.adName}`,
        body: `Frequency ${metric.frequency.toFixed(2)} 已高於你設定的 ${rules.maxFrequency.toFixed(
          2,
        )} 上限，建議先停掉避免疲勞。`,
      })
      continue
    }

    recommendations.push({
      kind: 'keep',
      title: `保留 ${draft.adName} 持續收樣本`,
      body: `這張素材還沒明確跌出門檻，也還沒有形成贏家訊號，先繼續收資料。`,
    })
  }

  return recommendations
}

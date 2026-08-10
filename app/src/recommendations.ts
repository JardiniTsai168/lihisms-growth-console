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

  const averageCtr =
    metrics.reduce((sum, item) => sum + item.ctr, 0) / metrics.length
  const cpas = metrics
    .map((item) => item.costPerVerifiedSignup)
    .filter((value): value is number => value !== null)
  const averageCpa =
    cpas.length > 0
      ? cpas.reduce((sum, value) => sum + value, 0) / cpas.length
      : null

  for (const metric of metrics) {
    const draft = drafts.find((item) => item.id === metric.draftId)
    if (!draft) {
      continue
    }

    const canJudge =
      metric.spend >= rules.minSpend && metric.impressions >= rules.minImpressions

    if (
      canJudge &&
      metric.ctr <= averageCtr * (1 - rules.ctrDropPercent / 100)
    ) {
      recommendations.push({
        kind: 'stop',
        title: `停掉 ${draft.adName}`,
        body: `CTR ${metric.ctr.toFixed(2)}% 已低於同批平均 ${averageCtr.toFixed(
          2,
        )}% 的容忍線，建議先停掉這個素材。`,
      })
      continue
    }

    if (
      canJudge &&
      averageCpa !== null &&
      metric.costPerVerifiedSignup !== null &&
      metric.costPerVerifiedSignup >= averageCpa * (1 + rules.cpaLiftPercent / 100)
    ) {
      recommendations.push({
        kind: 'stop',
        title: `收掉 ${draft.adName}`,
        body: `每個 email 驗證註冊成本 ${metric.costPerVerifiedSignup.toFixed(
          0,
        )} 高於同批平均 ${averageCpa.toFixed(0)} 太多，建議停掉。`,
      })
      continue
    }

    if (
      metric.costPerVerifiedSignup !== null &&
      metric.costPerVerifiedSignup <= rules.winnerTargetCpa
    ) {
      recommendations.push({
        kind: 'generate',
        title: `替 ${draft.adName} 追加 3 張變體`,
        body: `這張素材的 email 驗證註冊成本 ${metric.costPerVerifiedSignup.toFixed(
          0,
        )} 已低於你的贏家門檻 ${rules.winnerTargetCpa}，適合沿用同 angle 再生。`,
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

export type Recommendation = {
  kind: 'keep' | 'generate'
  title: string
  body: string
}

export function buildRecommendations() {
  return [] as Recommendation[]
}

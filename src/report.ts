import { rankContributors, type CompositionEstimate, type Contributor } from './estimate.ts'

export const formatTokens = (tokens: number) => {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }

  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`
  }

  return `${tokens}`
}

export function categoryRows(
  categories: CompositionEstimate['categories'],
  contributors: readonly Contributor[],
  categoryChars: Readonly<Record<string, number>>,
) {
  return categories.map((category) => {
    const ranked = rankContributors(
      contributors.filter((item) => item.category === category.name),
      categoryChars[category.name] ?? 0,
      category.tokens,
    )

    return {
      name: category.name,
      value: `~${formatTokens(category.tokens)} · ${category.percent}%`,
      items: ranked.map((item) => ({
        name: item.name.replace(/ \(catalog\)$/, ' · catalog'),
        value: `~${formatTokens(item.tokens)}`,
      })),
    }
  })
}

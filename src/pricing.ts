type Rate = { amount: number, unit: string, after?: number }

type PricedModel = {
  capabilities?: string[]
  pricingRates?: unknown
  pricingMeasured?: unknown
  pricingExamples?: unknown
}

const TOKEN_UNITS = new Set(['inputToken',
  'outputToken',
  'cachedInputToken',
  'cacheWriteToken'])

// The order model-intelligence compares models on, so the figure an agent reads here is the one
// the router ranks by: a video quoting seconds and a floor per generation is priced on seconds.
const UNITS: [string, string][] = [
  ['outputToken', '1M output tokens'],
  ['durationSecond', 'second'],
  ['outputMegapixel', 'megapixel out'],
  ['output', 'output'],
  ['step', 'step'],
  ['character', 'character'],
  ['utf8Byte', 'UTF-8 byte'],
  ['computeSecond', 'second of compute'],
  ['gigabyteSecond', 'GB-second'],
  ['inputMegapixel', 'megapixel in'],
  ['inputImage', 'input image'],
  ['inputToken', '1M input tokens'],
  ['cachedInputToken', '1M cached input tokens'],
  ['cacheWriteToken', '1M cache write tokens'],
]

const listOf = <T>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : [])

const cheapest = (values: unknown[]): number | null => {
  const amounts = values.filter((value): value is number => (typeof value === 'number' && value > 0))

  return amounts.length ? Math.min(...amounts) : null
}

const money = (amount: number): string => `$${amount.toLocaleString('en-US', {
  maximumFractionDigits: 10,
  maximumSignificantDigits: 3,
  useGrouping: false,
})}`

const producesOnlyText = (capabilities: string[] = []): boolean => {
  const outputs = new Set(capabilities
    .filter((entry) => (entry.startsWith('io:') && entry.includes('-to-')))
    .map((entry) => entry.split('-to-').pop()))

  return (outputs.size === 1) && outputs.has('text')
}

/** The lowest published price of a model, or null when it publishes none. */
export const startingPrice = (model: PricedModel): string | null => {
  const rates = listOf<Rate>(model.pricingRates).filter((rate) => (rate.after === undefined))
  const unit = UNITS.find(([id]) => (rates.some((rate) => (rate.unit === id))))

  if (!unit) {
    const runs = listOf<{ price?: number }>(model.pricingMeasured)
    const measured = cheapest(runs.map((one) => (one.price)))

    return (measured === null) ? null : `from ${money(measured)} per output`
  }

  const [id, label] = unit
  const byToken = TOKEN_UNITS.has(id)

  // A token rate says nothing about what one image or clip costs, so those models quote a real run.
  if (byToken && !producesOnlyText(model.capabilities)) {
    const runs = listOf<{ amount?: number }>(model.pricingExamples)
    const billed = cheapest(runs.map((one) => (one.amount)))

    if (billed !== null) { return `from ${money(billed)} per output` }
  }

  const amount = cheapest(rates.filter((rate) => (rate.unit === id)).map((rate) => (rate.amount)))

  return (amount === null) ? null : `from ${money(byToken ? amount * 1_000_000 : amount)} per ${label}`
}

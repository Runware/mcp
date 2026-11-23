import { describe, expect, it } from 'bun:test'

import { startingPrice } from '../src/pricing'

describe('startingPrice', () => {
  it('quotes the cheapest rate in the unit the model is bought in', () => {
    expect(startingPrice({
      pricingRates: [
        { amount: 0.16, unit: 'durationSecond', label: '720p' }, { amount: 0.07, unit: 'durationSecond', label: '480p' }, { amount: 0.01, unit: 'inputImage' },
      ],
    })).toBe('from $0.07 per second')
  })

  it('reads a language model per million output tokens', () => {
    expect(startingPrice({
      capabilities: ['io:text-to-text'],
      pricingRates: [
        { amount: 0.000001, unit: 'inputToken' }, { amount: 0.000005, unit: 'outputToken' },
      ],
    })).toBe('from $5 per 1M output tokens')
  })

  it('quotes a real run for an image billed by the token', () => {
    expect(startingPrice({
      capabilities: ['io:text-to-image'],
      pricingRates: [{ amount: 0.00003, unit: 'outputToken' }],
      pricingExamples: [{ amount: 0.19 }, { amount: 0.0587 }],
    })).toBe('from $0.0587 per output')
  })

  it('leaves out a rate that only applies past a threshold', () => {
    expect(startingPrice({
      pricingRates: [
        { amount: 0.1, unit: 'output' }, { amount: 0.01, unit: 'output', after: 4 },
      ],
    })).toBe('from $0.1 per output')
  })

  it('falls back to measured runs for a compute-billed model', () => {
    expect(startingPrice({pricingMeasured: [{ price: 0.0138 }, { price: 0.0069 }]})).toBe('from $0.0069 per output')
  })

  it('keeps very small prices readable', () => {
    expect(startingPrice({pricingRates: [{ amount: 0.00000042, unit: 'character' }]})).toBe('from $0.00000042 per character')
  })

  it('returns null when the model publishes no price', () => {
    expect(startingPrice({})).toBeNull()
  })
})

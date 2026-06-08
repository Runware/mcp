import { describe, it, expect } from 'bun:test'

import { formatResults } from '../src/formatters'

describe('formatResults', () => {
  it('returns "No results" message for empty array', () => {
    const blocks = formatResults([])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'text', text: 'No results returned.' })
  })

  it('formats image result with embedded base64 + metadata', () => {
    const blocks = formatResults([{
      imageBase64Data: 'iVBORw0KGgo=',
      imageURL: 'https://im.runware.ai/foo.png',
      imageUUID: 'uuid-1',
      seed: 42,
      cost: 0.01,
    }])

    const image = blocks.find((b) => b.type === 'image')
    expect(image).toMatchObject({
      type: 'image',
      data: 'iVBORw0KGgo=',
      mimeType: 'image/png',
    })

    const meta = blocks.find((b) => b.type === 'text')
    expect(meta?.text).toContain('imageUUID')
    expect(meta?.text).toContain('uuid-1')
    expect(meta?.text).toContain('"seed": 42')
  })

  it('falls back to URL text when base64 is absent', () => {
    const blocks = formatResults([{
      imageURL: 'https://im.runware.ai/foo.png',
      taskUUID: 't1',
    }])

    expect(blocks.some((b) => b.type === 'text' && b.text?.includes('Image URL: https://im.runware.ai/foo.png'))).toBe(true)
  })

  it('decodes a data URI into separate data + mimeType', () => {
    const blocks = formatResults([{imageDataURI: 'data:image/jpeg;base64,/9j/4AAQ'}])

    const image = blocks.find((b) => b.type === 'image')
    expect(image).toMatchObject({ type: 'image', data: '/9j/4AAQ', mimeType: 'image/jpeg' })
  })

  it('formats video result with URL', () => {
    const blocks = formatResults([{
      videoURL: 'https://vid.runware.ai/foo.mp4',
      taskUUID: 't1',
      cost: 0.05,
    }])

    expect(blocks.some((b) => b.type === 'text' && b.text?.includes('Video URL'))).toBe(true)
    expect(blocks.some((b) => b.type === 'text' && b.text?.includes('cost'))).toBe(true)
  })

  it('formats audio result from audioURL or audioFile', () => {
    expect(formatResults([{ audioURL: 'https://aud.runware.ai/x.mp3' }])
      .some((b) => b.type === 'text' && b.text?.includes('Audio URL: https://aud.runware.ai/x.mp3'))).toBe(true)

    expect(formatResults([{ audioFile: 'https://aud.runware.ai/y.mp3' }])
      .some((b) => b.type === 'text' && b.text?.includes('Audio URL: https://aud.runware.ai/y.mp3'))).toBe(true)
  })

  it('falls back to generic JSON dump for unknown result shapes', () => {
    const blocks = formatResults([{ unknownField: 'foo', anotherField: 42 }])
    expect(blocks).toHaveLength(1)
    const first = blocks[0] as { type: 'text', text: string }
    expect(first.text).toContain('unknownField')
    expect(first.text).toContain('"anotherField": 42')
  })

  it('separates multiple results with a divider header', () => {
    const blocks = formatResults([
      { imageURL: 'https://im.runware.ai/a.png' }, { imageURL: 'https://im.runware.ai/b.png' },
    ])

    expect(blocks.some((b) => b.type === 'text' && b.text?.includes('--- Result 2 ---'))).toBe(true)
  })
})

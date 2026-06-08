/**
 * Converts SDK results into MCP content blocks.
 *
 * Pure functions — no side effects, easy to test.
 * Each formatter returns an array of MCP content items
 * (text, image, or resource_link).
 */

type TextContent = { type: 'text'; text: string }
type ImageContent = { type: 'image'; data: string; mimeType: string }
type ContentBlock = TextContent | ImageContent

const isImageResult = (result: Record<string, unknown>): boolean =>
  'imageBase64Data' in result || 'imageDataURI' in result || 'imageURL' in result

const isVideoResult = (result: Record<string, unknown>): boolean =>
  'videoURL' in result

const isAudioResult = (result: Record<string, unknown>): boolean =>
  'audioURL' in result || 'audioFile' in result

const is3DResult = (result: Record<string, unknown>): boolean =>
  'modelURL' in result || 'glbURL' in result

const formatImageResult = (result: Record<string, unknown>): ContentBlock[] => {
  const blocks: ContentBlock[] = []

  if (typeof result.imageBase64Data === 'string') {
    blocks.push({
      type: 'image',
      data: result.imageBase64Data,
      mimeType: 'image/png',
    })
  } else if (typeof result.imageDataURI === 'string') {
    const match = (result.imageDataURI as string).match(/^data:(image\/[^;]+);base64,(.+)$/)
    if (match && match[1] && match[2]) {
      blocks.push({ type: 'image', data: match[2], mimeType: match[1] })
    }
  }

  const meta: Record<string, unknown> = {}
  if (result.imageUUID) { meta.imageUUID = result.imageUUID }
  if (result.imageURL) { meta.imageURL = result.imageURL }
  if (result.seed !== undefined) { meta.seed = result.seed }
  if (result.NSFWContent !== undefined) { meta.NSFWContent = result.NSFWContent }
  if (result.cost !== undefined) { meta.cost = result.cost }
  if (result.taskUUID) { meta.taskUUID = result.taskUUID }

  if (blocks.length === 0 && result.imageURL) {
    blocks.push({ type: 'text', text: `Image URL: ${result.imageURL}` })
  }

  if (Object.keys(meta).length > 0) {
    blocks.push({ type: 'text', text: JSON.stringify(meta, null, 2) })
  }

  return blocks
}

const formatVideoResult = (result: Record<string, unknown>): ContentBlock[] => {
  const blocks: ContentBlock[] = []

  if (result.videoURL) {
    blocks.push({ type: 'text', text: `Video URL: ${result.videoURL}` })
  }

  const meta: Record<string, unknown> = {}
  if (result.taskUUID) { meta.taskUUID = result.taskUUID }
  if (result.seed !== undefined) { meta.seed = result.seed }
  if (result.cost !== undefined) { meta.cost = result.cost }

  if (Object.keys(meta).length > 0) {
    blocks.push({ type: 'text', text: JSON.stringify(meta, null, 2) })
  }

  return blocks
}

const formatAudioResult = (result: Record<string, unknown>): ContentBlock[] => {
  const blocks: ContentBlock[] = []
  const url = result.audioURL ?? result.audioFile
  if (url) { blocks.push({ type: 'text', text: `Audio URL: ${url}` }) }

  const meta: Record<string, unknown> = {}
  if (result.taskUUID) { meta.taskUUID = result.taskUUID }
  if (result.cost !== undefined) { meta.cost = result.cost }
  if (Object.keys(meta).length > 0) {
    blocks.push({ type: 'text', text: JSON.stringify(meta, null, 2) })
  }

  return blocks
}

const formatGenericResult = (result: Record<string, unknown>): ContentBlock[] => [
  { type: 'text', text: JSON.stringify(result, null, 2) },
]

export const formatResult = (result: Record<string, unknown>): ContentBlock[] => {
  if (isImageResult(result)) { return formatImageResult(result) }
  if (isVideoResult(result)) { return formatVideoResult(result) }
  if (isAudioResult(result)) { return formatAudioResult(result) }
  if (is3DResult(result)) { return formatGenericResult(result) }
  return formatGenericResult(result)
}

export const formatResults = (results: Record<string, unknown>[]): ContentBlock[] => {
  if (results.length === 0) {
    return [{ type: 'text', text: 'No results returned.' }]
  }

  if (results.length === 1 && results[0]) {
    return formatResult(results[0])
  }

  return results.flatMap((result, i) => [
    ...(i > 0 ? [
      { type: 'text' as const, text: `\n--- Result ${i + 1} ---` },
    ] : []),
    ...formatResult(result),
  ])
}

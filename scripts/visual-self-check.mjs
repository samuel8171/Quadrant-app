#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'

const DEFAULT_ENDPOINT = 'https://www.rightapi.ai/draw'
const DEFAULT_MODEL = 'gpt-image-2'

function arg(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const promptFile = arg('--prompt-file')
const output = arg('--output', 'visual-self-check.png')
const endpoint = arg('--endpoint', DEFAULT_ENDPOINT)
const model = arg('--model', DEFAULT_MODEL)
const timeoutMs = Number(arg('--timeout', '120000'))
if (!promptFile) {
  console.error('Usage: node scripts/visual-self-check.mjs --prompt-file <file> --output <file>')
  process.exit(2)
}
const apiKey = process.env.RIGHTAPI_API_KEY
if (!apiKey) {
  console.error('RIGHTAPI_API_KEY is required in the environment.')
  process.exit(2)
}

const prompt = await readFile(promptFile, 'utf8')
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), timeoutMs)
try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, prompt }),
    signal: controller.signal
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 300)}`)
  const data = JSON.parse(raw)
  const image = data?.data?.[0] ?? data?.output ?? data
  const url = image?.url ?? image?.image_url
  if (url) {
    const imageResponse = await fetch(url)
    if (!imageResponse.ok) throw new Error(`image download HTTP ${imageResponse.status}`)
    await writeFile(output, Buffer.from(await imageResponse.arrayBuffer()))
  } else if (image?.b64_json || image?.base64) {
    await writeFile(output, Buffer.from(image.b64_json ?? image.base64, 'base64'))
  } else {
    throw new Error('Response did not contain an image URL or base64 payload')
  }
  console.log(`Saved visual self-check image to ${output}`)
} catch (error) {
  console.error(`Visual self-check failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  clearTimeout(timer)
}

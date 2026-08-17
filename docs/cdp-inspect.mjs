const base = process.argv[2] ?? 'http://127.0.0.1:9222'

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (err) {
            reject(err)
          }
        })
      })
      .on('error', reject)
  })
}

import http from 'node:http'

let list = []
for (let i = 0; i < 10; i++) {
  try {
    list = await getJson(`${base}/json`)
    if (list.length > 0) break
  } catch {
    // retry
  }
  await new Promise((r) => setTimeout(r, 1000))
}
if (list.length === 0) {
  console.error('NO_CDP_TARGETS')
  process.exit(2)
}
const page = list.find((t) => t.type === 'page')
if (!page) {
  console.error('NO_PAGE_TARGET')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let msgId = 0
const pending = new Map()

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
}

function send(method, params) {
  return new Promise((resolve) => {
    const id = ++msgId
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

await new Promise((resolve) => (ws.onopen = resolve))

const expression = `JSON.stringify({
  text: document.body.innerText,
  colCount: document.querySelectorAll('.goal-column').length,
  grid: document.querySelector('.goal-columns') ? getComputedStyle(document.querySelector('.goal-columns')).gridTemplateColumns : null,
  titles: [...document.querySelectorAll('.goal-column-title')].map((e) => e.textContent),
  addButtons: [...document.querySelectorAll('.add-goal-btn')].map((e) => e.textContent)
})`

const result = await send('Runtime.evaluate', {
  expression,
  returnByValue: true
})

console.log(result.result?.result?.value ?? JSON.stringify(result))
process.exit(0)

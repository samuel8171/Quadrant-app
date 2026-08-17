import { _electron } from 'playwright-core'

const exe = 'D:\\Samuel\\Vibe Coding\\dist\\win-unpacked\\象限.exe'
const app = await _electron.launch({ executablePath: exe })
const page = await app.firstWindow()
await page.waitForTimeout(1500)
const info = await page.evaluate(() =>
  JSON.stringify({
    text: document.body.innerText,
    colCount: document.querySelectorAll('.goal-column').length,
    grid: document.querySelector('.goal-columns')
      ? getComputedStyle(document.querySelector('.goal-columns')).gridTemplateColumns
      : null,
    titles: [...document.querySelectorAll('.goal-column-title')].map((e) => e.textContent),
    addButtons: [...document.querySelectorAll('.add-goal-btn')].map((e) => e.textContent)
  })
)
console.log(info)
await app.close()
process.exit(0)

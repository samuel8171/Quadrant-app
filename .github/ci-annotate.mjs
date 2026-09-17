/**
 * 把 CI 里的失败输出转成 GitHub 注解。
 *
 * 动机：Actions 的步骤日志需要登录才能下载（匿名拉 /logs 会 403），而 check-run
 * 的注解接口是匿名可读的。本地排障时先把日志揉成注解，就能拿到真正的原因，
 * 不用让用户去网页上复制粘贴。
 *
 * 注解条数有上限，所以要挑：优先 stderr/stdout 区块（vitest 把测试里的
 * console 输出攒到最后统一打印，未捕获的异步异常就在那里），其次错误行，
 * 最后补日志尾部。
 *
 * 用法：node .github/ci-annotate.mjs < some.log
 */
const ANN_LIMIT = 45
const STDERR_WINDOW = 22

let data = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  data += chunk
})

process.stdin.on('end', () => {
  const lines = data.split(/\r?\n/)
  const picked = []

  // 1) stderr / stdout 区块：vitest 会把测试期间的 console 输出攒到这里，
  //    未捕获的异步异常也在这里现形，正好是最需要的那段。
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(stderr|stdout)\s\|/.test(lines[i])) {
      const block = lines.slice(i, i + STDERR_WINDOW).filter((l) => l.trim())
      picked.push(...block.map((l) => l))
      i += STDERR_WINDOW
    }
  }

  // 2) 错误行
  for (const line of lines) {
    if (/error|failed|cannot find|not defined|unhandled|rejected|timeout/i.test(line) && line.trim()) {
      picked.push(line)
    }
  }

  // 3) 尾部兜底
  picked.push(...lines.slice(-20).filter((l) => l.trim()))

  const seen = new Set()
  for (const line of picked) {
    if (seen.has(line)) continue
    seen.add(line)
    if (seen.size > ANN_LIMIT) break
    // 注解正文里 % 与换行有转义要求，否则 GitHub 会截断
    const escaped = line.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A')
    process.stdout.write(`::error::${escaped}\n`)
  }
})

/**
 * 把 CI 里的失败输出转成 GitHub 注解。
 *
 * 动机：Actions 的步骤日志需要登录才能下载（匿名拉 /logs 会 403），而 check-run
 * 的注解接口是匿名可读的。本地排障时先把日志揉成注解，就能拿到真正的原因，
 * 不用让用户去网页上复制粘贴。
 *
 * 用法：cat some.log | node .github/ci-annotate.mjs [前置过滤正则]
 * 只取尾部若干行——注解数量有上限，而且出错的现场总在最后。
 */
const LIMIT = 48
let data = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  data += chunk
})
process.stdin.on('end', () => {
  const lines = data
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(-LIMIT)

  for (const line of lines) {
    // 注解正文里 %、换行、回车都有转义要求，否则 GitHub 会截断
    const escaped = line.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A')
    process.stdout.write(`::error::${escaped}\n`)
  }
})

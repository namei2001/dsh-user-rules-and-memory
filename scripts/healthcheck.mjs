/**
 * Health check for @local/dsh-user-standards.
 *   node scripts/healthcheck.mjs            # offline manifest checks + live probe
 *   node scripts/healthcheck.mjs --offline  # manifest checks only (CI)
 * Always writes the result to scripts/healthcheck.out.txt (stdout is swallowed
 * by the Electron-as-node runtime used in this environment).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(root, 'scripts', 'healthcheck.out.txt')
const lines = []
const log = (s) => lines.push(s)
let failures = 0
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
check('package name', pkg.name === '@local/dsh-user-standards', pkg.name)
check('bundle patch wired', pkg.dsh?.bundle?.patch === './cordis.patch.yml')

for (const lang of ['en', 'zh']) {
  try {
    const loc = JSON.parse(readFileSync(join(root, 'locale', `${lang}.json`), 'utf8'))
    const detail = loc.meta?.detail || ''
    check(`${lang} meta.detail is .md`, /\.md$/i.test(detail) && existsSync(join(root, detail)), detail)
  } catch (e) {
    check(`${lang} locale parses`, false, e.message)
  }
}
for (const f of ['docs/preview.svg', 'icon.svg']) check(`${f} exists`, existsSync(join(root, f)))

const offline = process.argv.includes('--offline')
if (!offline) {
  const port = process.env.DSH_WEB_PORT || '61098'
  const url = `http://127.0.0.1:${port}/dsh-user-standards/state`
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 4000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(t)
    const data = await res.json()
    check('live /state', res.ok && data.version === 2,
      res.ok ? `v${data.version}, ${data.rules?.length ?? '?'} rules, ${data.memories?.length ?? '?'} memories` : `HTTP ${res.status}`)
  } catch (e) {
    log(`SKIP  live /state — no Harness reachable (${e.message})`)
  }
}

log('')
log(failures ? `RESULT: ${failures} FAILED` : 'RESULT: ALL PASS')
writeFileSync(outFile, lines.join('\n') + '\n')

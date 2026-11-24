/**
 * Manifest / locale / docs integrity tests for @local/dsh-user-standards.
 * No running Harness required. Run: node --test tests/manifest.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const pkg = JSON.parse(read('package.json'))

test('package.json bundle identity', () => {
  assert.equal(pkg.name, '@local/dsh-user-standards')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.private, true)
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
})

test('exports and files list every runtime asset', () => {
  for (const key of ['.', './client', './icon']) assert.ok(pkg.exports[key], `missing export ${key}`)
  for (const f of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'README.zh.md', 'docs']) {
    assert.ok(pkg.files.includes(f), `files missing ${f}`)
  }
  assert.ok(pkg.exports['./locale/*.json'], 'missing locale export')
  assert.ok(pkg.files.includes('locale/*.json'), 'files missing locale glob')
})

test('cordis patch inserts the bundle', () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /- insert:/)
  assert.match(patch, /id:\s*dsh-user-standards/)
  assert.match(patch, /name:\s*['"]@local\/dsh-user-standards['"]/)
})

test('locales: meta.title present, detail is an existing .md path, strings aligned', () => {
  const loc = {}
  for (const lang of ['en', 'zh']) {
    loc[lang] = JSON.parse(read(`locale/${lang}.json`))
    assert.ok(loc[lang].meta.title, `${lang}: no meta.title`)
    const detail = loc[lang].meta.detail
    assert.match(detail, /\.(md|markdown)$/i, `${lang}: meta.detail is not a .md path`)
    assert.ok(existsSync(join(root, detail)), `${lang}: detail file missing: ${detail}`)
    assert.ok(statSync(join(root, detail)).size < 1024 * 1024, `${lang}: detail file > 1 MiB`)
  }
  // Keys should be aligned between locales.
  const keys = (o) => Object.keys(o).sort().join(',')
  assert.equal(keys(loc.en.meta), keys(loc.zh.meta), 'locale meta keys differ')
})

test('detail docs are a single image line referencing the preview', () => {
  for (const f of ['docs/DETAIL.md', 'docs/DETAIL.zh.md']) {
    const lines = read(f).split(/\r?\n/).filter((l) => l.trim())
    assert.equal(lines.length, 1, `${f}: expected exactly one non-empty line`)
    assert.match(lines[0], /^!\[.*\]\(preview\.svg\)$/, `${f}: not a preview.svg image line`)
  }
  assert.ok(existsSync(join(root, 'docs/preview.svg')), 'preview.svg missing')
})

test('SVGs are present and non-trivial', () => {
  for (const f of ['icon.svg', 'docs/preview.svg']) {
    const s = read(f)
    assert.match(s, /<svg[\s>]/, `${f}: no <svg> root`)
    assert.ok(s.length > 200, `${f}: suspiciously small`)
  }
})

test('Host injects every service it reads', () => {
  const src = read('index.js')
  const m = /export const inject = \[([^\]]*)\]/.exec(src)
  assert.ok(m, 'index.js: missing export const inject')
  for (const svc of ['systemPrompt', 'tools', 'commands', 'webServer', 'workingDirectory']) {
    assert.ok(m[1].includes(svc), `index.js: inject missing ${svc}`)
  }
})

test('Client half uses the ModuleLoader and theme tokens, no Harness client imports', () => {
  const src = read('client.js')
  assert.match(src, /window\.__ModuleLoader__\.load/)
  assert.match(src, /--dsw-alias-brand-primary/)
  assert.doesNotMatch(src, /require\(['"]@deepseek-ai\/dsh-client-/)
})

test('bilingual README: English primary, Chinese as README.zh.md, no stale README.en.md', () => {
  const en = read('README.md')
  const zh = read('README.zh.md')
  assert.ok(!existsSync(join(root, 'README.en.md')), 'stale README.en.md still present')
  assert.match(en, /\(README\.zh\.md\)/, 'English README missing link to Chinese')
  assert.match(zh, /\(README\.md\)/, 'Chinese README missing link back to English')
  assert.match(en, /How rules and memories reach the agent|rules are hard constraints/i, 'English README lacks primary framing')
  assert.match(zh, /用户习惯与规则/, 'Chinese README title missing')
})

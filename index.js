/**
 * @local/dsh-user-standards — Host half (v2: rules + memory, user/project scope)
 *
 * Two durable layers, following the mature mainstream design:
 * - RULES (explicit, always-injected hard constraints) live in AGENTS.md:
 *     * user-global rules  -> $DSH_HOME/AGENTS.md (injected in every project)
 *     * project rules      -> <projectRoot>/AGENTS.md (injected in that project)
 * - MEMORY (implicit, retrievable soft notes) lives in a structured store:
 *     * a lightweight index is contributed as dynamic prompt CONTEXT per agent
 *     * full notes are fetched on demand through the `user_standards_recall` tool
 *
 * DSH's built-in dsh-agent-instructions plugin injects AGENTS.md automatically;
 * this plugin never hand-rolls injection, it only regenerates the managed block.
 *
 * Structured state (rules, memories, config, nudge statistics) lives in a
 * single JSON file owned by this plugin; AGENTS.md files are projections.
 */
import { promises as fs, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STATE_FILE = 'user-standards.json'
const AGENTS_FILE = 'AGENTS.md'
const MANAGED_BEGIN = '<!-- BEGIN DSH USER STANDARDS (managed by @local/dsh-user-standards) -->'
const MANAGED_END = '<!-- END DSH USER STANDARDS -->'

const CATEGORY_LABELS = {
  user: '用户偏好 / Preferences',
  feedback: '纠正与反馈 / Corrections & feedback',
  project: '项目约定 / Project conventions',
  reference: '参考资料 / Reference',
}

const SCOPES = ['user', 'project']

function resolveHome() {
  const profile = process.env.DSH_PROFILE_DIR
  if (profile) {
    const p = path.resolve(profile)
    const parent = path.dirname(p)
    if (path.basename(parent).toLowerCase() === 'profiles') return path.dirname(parent)
    return parent
  }
  if (process.env.DSH_HOME) return path.resolve(process.env.DSH_HOME)
  return path.join(os.homedir(), '.dsh')
}

function defaultConfig() {
  return {
    nudgesEnabled: true,
    repeatThreshold: 2,
    confirmOnNudge: true,
    autoSaveOnExplicit: true,
    cooldownMinutes: 30,
    rememberDefault: 'memory', // 'memory' | 'rule' — "记住 X" target
    memoryIndexMax: 20, // max entries in the always-injected memory index
  }
}

function defaultState() {
  return {
    version: 2,
    rules: [], // {id, text, category, scope, reason?, source, createdAt, updatedAt}
    memories: [], // {id, text, scope, projectPath?, category?, source, createdAt, updatedAt, lastRecallAt?}
    config: defaultConfig(),
    observations: {},
    nudges: {},
    // Every project root that has ever received a managed AGENTS.md block.
    // Kept even after its last rule is removed, so cleanup can re-render the
    // empty block instead of leaving a deleted rule injected in that project.
    projectPaths: [],
  }
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function fingerprint(text) {
  return normalize(text).slice(0, 120)
}

// Strip a leading meta-correction so the saved rule is a standing instruction,
// not the user's corrective phrasing. Conservative: only clear meta prefixes.
function distill(text) {
  const original = String(text || '').trim()
  let s = original
  s = s.replace(/^(不对吧|不对|不是这样|别这样|错了|错了吧)[，,、:：\s-]*/, '')
  s = s.replace(/^(应该是这样|应该是|我(说过|提过)|你又[^\n，,]{0,12}了)[，,、:：\s-]*/, '')
  s = s.replace(/^(actually|no,?\s*)/i, '')
  return s.trim() || original
}

const CORRECTION_RE = /不对|不是这样|应该是|改成|不要|别这样|错了|我说过|我提过|重复|你又|again|instead|actually|no[, ]|don['’]t|i (said|told)/i
// Explicit *rule* intent — strong, always-injected constraints.
const RULE_RE = /写入配置|写进配置|写进习惯|加入规则|写入规则|全局规则|以后都|从现在起|从今以后|永久|始终|总是|强制|别忘了|always do|from now on|save (this )?as a rule/i
// Generic "remember" intent — defaults to MEMORY unless RULE_RE also matches.
const REMEMBER_RE = /记住|记得|别忘了|remember (this|that)?|save this/i

function textFromMessage(message) {
  try {
    const blocks = message?.content || []
    return blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
  } catch {
    return ''
  }
}

function normalizeScope(scope) {
  return SCOPES.includes(scope) ? scope : 'user'
}

/** Walk up from cwd to find the first directory containing a marker; else cwd. */
async function findProjectRoot(cwd, markers = ['.git']) {
  let dir = path.resolve(cwd || '')
  for (;;) {
    let found = false
    for (const marker of markers) {
      try {
        await fs.access(path.join(dir, marker))
        found = true
        break
      } catch {
        // try next marker
      }
    }
    if (found) return dir
    const parent = path.dirname(dir)
    if (!parent || parent === dir) return path.resolve(cwd || '')
    dir = parent
  }
}

function samePath(a, b) {
  if (!a || !b) return false
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

/** Synchronous counterpart of findProjectRoot for prompt-assembly text fns. */
function findProjectRootSync(cwd, markers = ['.git']) {
  let dir = path.resolve(cwd || '')
  for (;;) {
    let found = false
    for (const marker of markers) {
      try {
        // eslint-disable-next-line no-undef
        if (existsSync(path.join(dir, marker))) { found = true; break }
      } catch { /* try next marker */ }
    }
    if (found) return dir
    const parent = path.dirname(dir)
    if (!parent || parent === dir) return path.resolve(cwd || '')
    dir = parent
  }
}

/** Render the AGENTS.md managed block for a given scope. */
function renderManagedBlock(state, scope) {
  const rules = state.rules.filter((r) => normalizeScope(r.scope) === scope)
  const lines = [
    MANAGED_BEGIN,
    '',
    '## 用户习惯与规则 / User standards',
    '',
    scope === 'user'
      ? '以下规则由用户在 DeepSeek Harness 中设定，适用于所有项目，请始终遵守：'
      : '以下规则由用户在 DeepSeek Harness 中设定，仅适用于当前项目，请始终遵守：',
    '',
  ]
  let any = false
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    const group = rules.filter((r) => (r.category || 'user') === key)
    if (!group.length) continue
    any = true
    lines.push(`### ${label}`, '')
    for (const rule of group) lines.push(`- ${rule.text}`)
    lines.push('')
  }
  if (!any) lines.push('- （暂无规则 / No rules yet）', '')
  lines.push(MANAGED_END)
  return lines.join('\n')
}

class StandardsStore {
  constructor(home) {
    this.home = home
    this.statePath = path.join(home, STATE_FILE)
    this.state = null
    this.chain = Promise.resolve()
    this.logger = null
    this.ctx = null
    // Cache of project-root -> AGENTS.md path, populated lazily.
    this.projectRoots = new Map()
  }

  agentsPathFor(scope, projectPath) {
    if (scope === 'project') {
      const key = path.resolve(projectPath || '')
      return path.join(key, AGENTS_FILE)
    }
    return path.join(this.home, AGENTS_FILE)
  }

  async ensure() {
    if (this.state) return this.state
    let loaded = defaultState()
    try {
      const raw = await fs.readFile(this.statePath, 'utf8')
      const parsed = JSON.parse(raw)
      const base = defaultState()
      const migratedRules = (Array.isArray(parsed.rules) ? parsed.rules : []).map((r) => ({
        ...r,
        scope: normalizeScope(r.scope),
      }))
      loaded = {
        ...base,
        ...parsed,
        version: 2,
        config: { ...base.config, ...(parsed.config || {}) },
        rules: migratedRules,
        memories: Array.isArray(parsed.memories) ? parsed.memories : [],
        projectPaths: Array.isArray(parsed.projectPaths)
          ? parsed.projectPaths
          : [...new Set(migratedRules.filter((r) => r.scope === 'project' && r.projectPath).map((r) => r.projectPath))],
        observations: parsed.observations && typeof parsed.observations === 'object' ? parsed.observations : {},
        nudges: parsed.nudges && typeof parsed.nudges === 'object' ? parsed.nudges : {},
      }
    } catch (err) {
      if (err?.code !== 'ENOENT') this.logger?.warn?.(`[user-standards] failed to read state: ${err?.message || err}`)
    }
    this.state = loaded
    return this.state
  }

  async persist() {
    await fs.mkdir(this.home, { recursive: true })
    const tmp = `${this.statePath}.tmp`
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf8')
    await fs.rename(tmp, this.statePath)
  }

  async syncAgents(scope, projectPath) {
    const file = this.agentsPathFor(scope, projectPath)
    let existing = ''
    try {
      existing = await fs.readFile(file, 'utf8')
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err
    }
    let stripped = existing
    const begin = existing.indexOf(MANAGED_BEGIN)
    const end = existing.indexOf(MANAGED_END)
    if (begin !== -1 && end !== -1 && end > begin) {
      stripped = existing.slice(0, begin) + existing.slice(end + MANAGED_END.length)
    }
    const block = renderManagedBlock(this.state, scope)
    const final = `${stripped.trimEnd()}\n\n${block}\n`
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, final, 'utf8')
  }

  async syncAllFiles() {
    const state = await this.ensure()
    await this.syncAgents('user', null)
    // Re-render EVERY project that ever received a managed block, including
    // ones whose last rule was just removed — otherwise a deleted rule would
    // stay injected in that project's AGENTS.md forever.
    const projectPaths = new Set([
      ...(state.projectPaths || []),
      ...state.rules.filter((r) => r.scope === 'project' && r.projectPath).map((r) => r.projectPath),
    ])
    for (const p of projectPaths) await this.syncAgents('project', p)
  }

  mutate(fn) {
    const next = this.chain.then(async () => {
      const state = await this.ensure()
      const result = await fn(state)
      await this.persist()
      await this.syncAllFiles()
      return result
    })
    // Keep the chain alive even if one mutation fails.
    this.chain = next.catch((err) => {
      this.logger?.warn?.(`[user-standards] mutation failed: ${err?.message || err}`)
    })
    return next
  }

  async publicState() {
    const s = await this.ensure()
    return {
      version: s.version,
      rules: s.rules,
      memories: s.memories,
      config: s.config,
      stats: {
        totalRules: s.rules.length,
        userRules: s.rules.filter((r) => normalizeScope(r.scope) === 'user').length,
        projectRules: s.rules.filter((r) => normalizeScope(r.scope) === 'project').length,
        totalMemories: s.memories.length,
        observations: Object.keys(s.observations).length,
        pendingNudges: Object.keys(s.nudges).filter((k) => k !== '__lastAt' && s.nudges[k] && !s.nudges[k].nudged).length,
      },
      agentsPath: this.agentsPathFor('user', null),
      rememberDefault: s.config.rememberDefault,
    }
  }

  // ---- RULES ---------------------------------------------------------------

  async saveRule(text, options = {}) {
    const clean = String(text || '').trim()
    if (!clean) return { status: 'empty' }
    const scope = normalizeScope(options.scope || 'user')
    // Resolve to the project root (.git ancestor) so rules saved from a
    // subdirectory are found by the same root used by the injected AGENTS.md
    // chain and by memoryIndex()/recall(). Falls back to the given path.
    const projectPath = scope === 'project' ? await findProjectRoot(options.projectPath || '') : undefined
    return this.mutate((s) => {
      const fp = fingerprint(clean)
      const existing = s.rules.find((r) => fingerprint(r.text) === fp && normalizeScope(r.scope) === scope
        && (scope !== 'project' || samePath(r.projectPath, projectPath)))
      if (existing) return { status: 'duplicate', rule: existing }
      const now = new Date().toISOString()
      const rule = {
        id: newId('rule'),
        text: clean,
        category: options.category || 'user',
        scope,
        ...(projectPath ? { projectPath } : {}),
        reason: options.reason || '',
        source: options.source || 'settings',
        createdAt: now,
        updatedAt: now,
      }
      s.rules.push(rule)
      if (projectPath && !(s.projectPaths || []).some((p) => samePath(p, projectPath))) {
        s.projectPaths = [...(s.projectPaths || []), projectPath]
      }
      return { status: 'created', rule }
    })
  }

  async updateRule(id, text) {
    const clean = String(text || '').trim()
    if (!clean) return { status: 'empty' }
    return this.mutate((s) => {
      const rule = s.rules.find((r) => r.id === id)
      if (!rule) return { status: 'not-found' }
      rule.text = clean
      rule.updatedAt = new Date().toISOString()
      return { status: 'updated', rule }
    })
  }

  async removeRule(id) {
    return this.mutate((s) => {
      const before = s.rules.length
      s.rules = s.rules.filter((r) => r.id !== id)
      return { status: s.rules.length < before ? 'removed' : 'not-found' }
    })
  }

  // ---- MEMORY --------------------------------------------------------------

  async saveMemory(text, options = {}) {
    const clean = String(text || '').trim()
    if (!clean) return { status: 'empty' }
    const scope = normalizeScope(options.scope || 'user')
    // Resolve to the project root (.git ancestor) consistently with saveRule
    // and with the root used by memoryIndex()/recall().
    const projectPath = scope === 'project' ? await findProjectRoot(options.projectPath || '') : undefined
    return this.mutate((s) => {
      const fp = fingerprint(clean)
      const existing = s.memories.find((m) => fingerprint(m.text) === fp && normalizeScope(m.scope) === scope
        && (scope !== 'project' || samePath(m.projectPath, projectPath)))
      if (existing) return { status: 'duplicate', memory: existing }
      const now = new Date().toISOString()
      const memory = {
        id: newId('mem'),
        text: clean,
        scope,
        ...(projectPath ? { projectPath } : {}),
        category: options.category || 'user',
        source: options.source || 'settings',
        createdAt: now,
        updatedAt: now,
      }
      s.memories.push(memory)
      return { status: 'created', memory }
    })
  }

  async updateMemory(id, text) {
    const clean = String(text || '').trim()
    if (!clean) return { status: 'empty' }
    return this.mutate((s) => {
      const memory = s.memories.find((m) => m.id === id)
      if (!memory) return { status: 'not-found' }
      memory.text = clean
      memory.updatedAt = new Date().toISOString()
      return { status: 'updated', memory }
    })
  }

  async removeMemory(id) {
    return this.mutate((s) => {
      const before = s.memories.length
      s.memories = s.memories.filter((m) => m.id !== id)
      return { status: s.memories.length < before ? 'removed' : 'not-found' }
    })
  }

  /**
   * Build the lightweight memory index contributed as dynamic prompt context.
   * Includes all user-scope memories plus project-scope memories for cwd's root.
   */
  async memoryIndex(cwd) {
    const s = await this.ensure()
    const root = cwd ? await findProjectRoot(cwd) : null
    const visible = s.memories.filter((m) => {
      const scope = normalizeScope(m.scope)
      if (scope === 'user') return true
      if (scope === 'project' && root) return samePath(m.projectPath, root)
      return false
    })
    const max = Math.max(0, Math.min(200, Number.isFinite(Number(s.config.memoryIndexMax)) ? Number(s.config.memoryIndexMax) : 20))
    const items = max === 0 ? [] : visible.slice(-max)
    if (!items.length) return ''
    const lines = items.map((m, i) => {
      const scopeLabel = normalizeScope(m.scope) === 'user' ? '用户' : '项目'
      return `${i + 1}. [${scopeLabel}记忆] ${m.text}`
    })
    return [
      '## 已保存的记忆 / Saved memories (index)',
      '',
      '以下是用户让你记住的长期信息（软参考，非强制规则）。与当前任务相关时用 `user_standards_recall` 工具查询完整内容；',
      '这些条目不是硬性规则，不要把它当成 always 指令。',
      '',
      ...lines,
    ].join('\n')
  }

  async recall(query, cwd, limit = 10) {
    const s = await this.ensure()
    const root = cwd ? await findProjectRoot(cwd) : null
    const visible = s.memories.filter((m) => {
      const scope = normalizeScope(m.scope)
      if (scope === 'user') return true
      if (scope === 'project' && root) return samePath(m.projectPath, root)
      return false
    })
    const needle = normalize(query)
    const scored = visible.map((m) => {
      const hay = normalize(m.text)
      let score = 0
      if (needle && hay.includes(needle)) score += 10
      // Simple token overlap for multi-word queries.
      const tokens = needle.split(/\s+/).filter((t) => t.length > 1)
      for (const t of tokens) if (hay.includes(t)) score += 1
      return { m, score }
    })
    const picks = scored
      .filter((x) => !needle || x.score > 0)
      .sort((a, b) => b.score - a.score || (b.m.updatedAt || '').localeCompare(a.m.updatedAt || ''))
      .slice(0, Math.max(1, Math.min(50, Number(limit) || 10)))
    if (!picks.length) return { query, count: 0, memories: [] }
    const ids = picks.map((p) => p.m.id)
    // Touch lastRecallAt without a full mutation chain dependency:
    this.mutate((s2) => {
      for (const m of s2.memories) if (ids.includes(m.id)) m.lastRecallAt = new Date().toISOString()
    }).catch(() => {})
    return {
      query,
      count: picks.length,
      memories: picks.map((p) => ({
        id: p.m.id,
        text: p.m.text,
        scope: p.m.scope,
        category: p.m.category,
        createdAt: p.m.createdAt,
      })),
    }
  }

  // ---- CONFIG & NUDGES -----------------------------------------------------

  async updateConfig(patch) {
    return this.mutate((s) => {
      const allowed = [
        'nudgesEnabled', 'repeatThreshold', 'confirmOnNudge', 'autoSaveOnExplicit',
        'cooldownMinutes', 'rememberDefault', 'memoryIndexMax',
      ]
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(patch || {}, key)) s.config[key] = patch[key]
      }
      s.config.repeatThreshold = Math.max(1, Math.min(10, Number.isFinite(Number(s.config.repeatThreshold)) ? Number(s.config.repeatThreshold) : 2))
      const cooldown = Number(s.config.cooldownMinutes)
      s.config.cooldownMinutes = Math.max(0, Math.min(1440, Number.isFinite(cooldown) ? cooldown : 30))
      s.config.memoryIndexMax = Math.max(0, Math.min(200, Number.isFinite(Number(s.config.memoryIndexMax)) ? Number(s.config.memoryIndexMax) : 20))
      if (!['memory', 'rule'].includes(s.config.rememberDefault)) s.config.rememberDefault = 'memory'
      return { status: 'updated', config: s.config }
    })
  }

  async recordObservation(rawText, sourceKind, cwd) {
    if (sourceKind === 'dsh-user-standards') return null
    const text = String(rawText || '').trim()
    if (!text || text.length > 2000) return null
    const isRuleIntent = RULE_RE.test(text)
    const isRemember = REMEMBER_RE.test(text)
    const isCorrection = CORRECTION_RE.test(text)
    if (!isRuleIntent && !isRemember && !isCorrection) return null
    const fp = fingerprint(text)
    if (!fp) return null

    return this.mutate((s) => {
      if (isRuleIntent && s.config.autoSaveOnExplicit) {
        // Strong rule intent: nudge the agent to call the save-rule tool.
        s.nudges[`explicit:${fp}`] = {
          text: distill(text).slice(0, 240),
          explicit: true,
          target: 'rule',
          scope: 'user',
          cwd: cwd || null,
          count: 1,
          created: Date.now(),
          agentNotified: false,
        }
        return { kind: 'explicit', fp }
      }
      if (isRemember && s.config.autoSaveOnExplicit) {
        // Generic "remember X": nudge toward MEMORY, not a hard rule.
        s.nudges[`remember:${fp}`] = {
          text: distill(text).slice(0, 240),
          explicit: true,
          target: s.config.rememberDefault === 'rule' ? 'rule' : 'memory',
          scope: 'user',
          cwd: cwd || null,
          count: 1,
          created: Date.now(),
          agentNotified: false,
        }
        return { kind: 'remember', fp }
      }
      if (!s.config.nudgesEnabled) return null
      const obs = s.observations[fp] || { count: 0, sample: distill(text).slice(0, 240), last: 0 }
      obs.count += 1
      obs.last = Date.now()
      obs.sample = distill(text).slice(0, 240)
      s.observations[fp] = obs

      const keys = Object.keys(s.observations)
      if (keys.length > 200) {
        const sorted = keys.sort((a, b) => (s.observations[a].last || 0) - (s.observations[b].last || 0))
        for (const k of sorted.slice(0, keys.length - 200)) delete s.observations[k]
      }

      const lastNudgeAt = Number(s.nudges.__lastAt || 0)
      const cooled = Date.now() - lastNudgeAt >= s.config.cooldownMinutes * 60000
      if (obs.count >= s.config.repeatThreshold && cooled) {
        s.nudges[`correction:${fp}`] = {
          text: obs.sample,
          target: 'memory', // repeated corrections default to memory unless user says otherwise
          scope: 'user',
          cwd: cwd || null,
          count: obs.count,
          created: Date.now(),
          agentNotified: false,
        }
        return { kind: 'correction', fp, count: obs.count }
      }
      return { kind: 'observed', fp, count: obs.count }
    })
  }

  async getSuggestion() {
    const s = await this.ensure()
    const pending = Object.entries(s.nudges)
      .filter(([k, n]) => k !== '__lastAt' && n && !n.nudged && !n.saved)
      .sort((a, b) => (b[1].created || 0) - (a[1].created || 0))
    if (!pending.length) return null
    const [key, nudge] = pending[0]
    return {
      key,
      text: nudge.text,
      count: nudge.count || 1,
      explicit: !!nudge.explicit,
      target: nudge.target || 'memory',
      scope: nudge.scope || 'user',
      cwd: nudge.cwd || null,
      confirmOnNudge: !!s.config.confirmOnNudge,
    }
  }

  async markAgentNotified(key) {
    return this.mutate((s) => {
      if (key && s.nudges[key]) s.nudges[key].agentNotified = true
      s.nudges.__lastAt = Date.now()
    })
  }

  async markNudged(key) {
    return this.mutate((s) => {
      if (key && s.nudges[key]) s.nudges[key].nudged = true
    })
  }

  async dismissSuggestion(key) {
    return this.mutate((s) => {
      if (key) delete s.nudges[key]
      s.nudges.__lastAt = Date.now()
    })
  }

  async applyUpdate(body) {
    const action = body?.action
    if (action === 'add') {
      return body.layer === 'memory'
        ? this.saveMemory(body.text, { scope: body.scope, source: 'settings' })
        : this.saveRule(body.text, { category: body.category, scope: body.scope, projectPath: body.projectPath, source: 'settings' })
    }
    if (action === 'update') {
      return body.layer === 'memory' ? this.updateMemory(body.id, body.text) : this.updateRule(body.id, body.text)
    }
    if (action === 'remove') {
      return body.layer === 'memory' ? this.removeMemory(body.id) : this.removeRule(body.id)
    }
    if (action === 'config') return this.updateConfig(body.patch)
    if (action === 'dismiss') return this.dismissSuggestion(body.key)
    if (action === 'nudged') return this.markNudged(body.key)
    return { status: 'unknown-action' }
  }
}

/** Helpers for the HTTP bridge (proven pattern from api-usage-tracker). */
function json(value, init = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers || {}),
    },
  })
}

function nodeJson(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

function readRequestBody(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Resolve a cwd for an agent without throwing if services are unavailable. */
async function agentCwd(ctx, agent) {
  try {
    const wd = ctx.workingDirectory
    if (wd?.get && agent?.session) return wd.get(agent.session) || agent.session.header?.cwd || ''
  } catch {
    // fall through
  }
  try {
    return agent?.session?.header?.cwd || ''
  } catch {
    return ''
  }
}

// REQUIRED: without these injects, ctx.get on the services fails at activation.
export const inject = ['systemPrompt', 'tools', 'commands', 'webServer', 'workingDirectory']

export function apply(ctx) {
  const disposers = []
  const store = new StandardsStore(resolveHome())
  store.logger = ctx.logger
  store.ctx = ctx
  // Load state eagerly so per-agent memory indexes are ready for the first turn.
  void store.ensure().catch(() => {})

  const track = (dispose) => {
    if (typeof dispose === 'function') disposers.push(dispose)
  }

  // ---- System prompt: teach the Agent the save/recall contract -------------
  track(ctx.systemPrompt.section({
    name: 'dsh-user-standards:guidance',
    order: 200,
    text: [
      '## 用户习惯与规则 / User standards & memory',
      '',
      '有两条长期信息通道，请严格区分：',
      '- 规则（强约束，始终注入）：`user_standards_save` 把用户明确要求“写入配置/规则/以后都/强制”的内容保存为规则。',
      '  scope=user 写入用户全局 AGENTS.md（对所有项目生效）；scope=project 写入当前项目 AGENTS.md（仅该项目生效）。',
      '- 记忆（软参考，按需检索）：`user_standards_save` 也可在“记住 X / remember”时保存为记忆（默认）；',
      '  scope=user 全局、scope=project 当前项目。记忆的轻量索引会自动出现在上下文中，完整内容用 `user_standards_recall` 查询。',
      '',
      '触发规则：',
      '- 用户明确要求“记住 X”→ 默认保存到记忆（除非用户同时说了“规则/配置/以后都/强制”）。',
      '- 用户说“写入配置/写进习惯/加入规则/以后都/从现在起/别忘了/always do/from now on”→ 立即保存到规则，无需再次询问。',
      '- 收到系统的“是否保存”提醒时，若提醒要求先询问用户，必须先征得确认再保存；否则可直接保存。',
      '- 保存前检查是否重复（工具会返回 duplicate）；只保存长期适用内容，不存一次性任务细节、密钥或临时路径。',
      '- 用户可在「设置 → 用户习惯与规则」中查看、修改、删除规则和记忆。',
    ].join('\n'),
  }))

  // ---- Per-agent dynamic memory index (scoped context) --------------------
  // Registered on agent.ctx so each agent gets its own index; text is a
  // function of AssembleContext and reads that agent's current cwd.
  track(ctx.on('agent/created', (payload) => {
    try {
      const agent = payload?.agent
      if (!agent?.ctx?.systemPrompt) return
      const dispose = agent.ctx.systemPrompt.context({
        name: 'dsh-user-standards:memory-index',
        order: 150,
        interpolate: false,
        text: (assembleContext) => {
          // Compute synchronously from the in-memory state loaded at startup;
          // fall back to empty while state is still loading.
          const state = store.state
          if (!state || !state.memories?.length) return ''
          const a = assembleContext?.agent || agent
          let cwd = ''
          try {
            const wd = ctx.workingDirectory
            if (wd?.get && a?.session) cwd = wd.get(a.session) || a.session.header?.cwd || ''
          } catch {
            cwd = a?.session?.header?.cwd || ''
          }
          if (!cwd) cwd = a?.session?.header?.cwd || ''
          const root = cwd ? findProjectRootSync(cwd) : ''
          const max = Math.max(0, Math.min(200, Number.isFinite(Number(state.config.memoryIndexMax)) ? Number(state.config.memoryIndexMax) : 20))
          const visible = state.memories.filter((m) => {
            const scope = normalizeScope(m.scope)
            if (scope === 'user') return true
            if (scope === 'project' && root) return samePath(m.projectPath, root) || samePath(m.projectPath, cwd)
            return false
          })
          const items = max === 0 ? [] : visible.slice(-max)
          if (!items.length) return ''
          return [
            '## 已保存的记忆 / Saved memories (index)',
            '',
            '以下是用户让你记住的长期信息（软参考，非强制规则）。相关时用 `user_standards_recall` 查询完整内容。',
            ...items.map((m, i) => `${i + 1}. [${normalizeScope(m.scope) === 'user' ? '用户' : '项目'}记忆] ${m.text}`),
          ].join('\n')
        },
      })
      // Double disposer: unwind with the agent (scoped effect) AND with the plugin.
      agent.ctx.effect(() => dispose)
      track(() => {
        try { dispose() } catch { /* ignore */ }
      })
    } catch {
      // Never break agent creation.
    }
  }))

  // ---- Unified save tool: rules + memory ----------------------------------
  track(ctx.tools.register({
    name: 'user_standards_save',
    description: 'Save a durable user rule, project rule, user memory, or project memory. "记住 X" defaults to memory; "写入配置/规则/以后都/强制" saves a rule.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The content to save, written as a clear standing statement, e.g. "所有回复使用中文".',
        },
        layer: {
          type: 'string',
          enum: ['rule', 'memory'],
          description: 'Layer: rule = always-injected hard constraint; memory = soft note retrieved on demand. Defaults from the user request.',
        },
        scope: {
          type: 'string',
          enum: ['user', 'project'],
          description: 'Scope: user = all projects (user-global AGENTS.md / global memory); project = current project only. Defaults to user.',
        },
        category: {
          type: 'string',
          enum: ['user', 'feedback', 'project', 'reference'],
          description: 'Category for rules: user preference, feedback/correction, project convention, or reference.',
        },
        reason: {
          type: 'string',
          description: 'Optional short context about why this was saved.',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
    },
    async execute(args, exec) {
      const input = args || {}
      const text = String(input.text || '').trim()
      if (!text) return '错误：内容为空，未保存。'
      let scope = normalizeScope(input.scope || 'user')
      let projectPath = ''
      if (scope === 'project') {
        projectPath = await agentCwd(ctx, exec?.agent)
        if (!projectPath) return '错误：无法确定当前项目路径，无法保存项目级内容；请改用 scope=user。'
      }
      const explicitRule = RULE_RE.test(text)
      const layer = input.layer === 'rule' || input.layer === 'memory'
        ? input.layer
        : (explicitRule ? 'rule' : (store.state?.config?.rememberDefault || 'memory'))
      if (layer === 'rule') {
        const result = await store.saveRule(text, {
          category: input.category || 'user', scope, projectPath, reason: input.reason || '', source: 'agent',
        })
        if (result.status === 'empty') return '错误：规则内容为空，未保存。'
        if (result.status === 'duplicate') return `该规则已存在，未重复添加：「${result.rule.text}」`
        const where = scope === 'project' ? `当前项目（${projectPath}）` : '所有项目'
        return `已保存为${where}的规则：「${result.rule.text}」。用户可在设置 → 用户习惯与规则中管理。`
      }
      const result = await store.saveMemory(text, { scope, projectPath, source: 'agent' })
      if (result.status === 'empty') return '错误：记忆内容为空，未保存。'
      if (result.status === 'duplicate') return `该记忆已存在，未重复添加：「${result.memory.text}」`
      const where = scope === 'project' ? `当前项目（${projectPath}）` : '所有项目'
      return `已保存为${where}的记忆：「${result.memory.text}」。其索引会在相关上下文中提示你，完整内容可用 user_standards_recall 查询。`
    },
  }))

  // ---- Recall tool: retrieve full memory notes ----------------------------
  track(ctx.tools.register({
    name: 'user_standards_recall',
    description: 'Recall full content of saved memories relevant to a query. Use when the memory index hints at information related to the current task.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to recall, e.g. "用户的语言偏好" or "code style".' },
        limit: { type: 'number', description: 'Max number of memories to return (default 10, max 50).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          count: { type: 'number' },
          memories: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
                scope: { type: 'string' },
                category: { type: 'string' },
                createdAt: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const v = value || {}
        const lines = (v.memories || []).map((m) => `- [${m.scope}${m.category ? `/${m.category}` : ''}] ${m.text}`)
        return [{ type: 'text', text: lines.length ? `找到 ${v.count} 条记忆：\n${lines.join('\n')}` : '没有找到相关记忆。' }]
      },
    },
    async execute(args, exec) {
      const input = args || {}
      const query = String(input.query || '').trim()
      const cwd = await agentCwd(ctx, exec?.agent)
      return store.recall(query, cwd, input.limit || 10)
    },
  }))

  // ---- Slash commands ------------------------------------------------------
  try {
    track(ctx.commands.register({
      name: 'habit-save',
      description: 'Save text as a rule (default) or memory. Use /habit-save --memory to save as memory.',
      input: { hint: '内容，例如：所有回复使用中文（加 --memory 存为记忆）' },
      async handler(invocation) {
        let raw = String(invocation?.rawInput || '').trim()
        let layer = 'rule'
        if (raw.startsWith('--memory')) { layer = 'memory'; raw = raw.slice('--memory'.length).trim() }
        else if (raw.startsWith('--rule')) { layer = 'rule'; raw = raw.slice('--rule'.length).trim() }
        if (!raw) return { kind: 'error', text: '请在命令后输入要保存的内容。' }
        const result = layer === 'memory'
          ? await store.saveMemory(raw, { source: 'command' })
          : await store.saveRule(raw, { source: 'command' })
        if (result.status === 'duplicate') return { kind: 'success', text: `已存在，未重复添加：「${raw}」` }
        return { kind: 'success', text: `已保存${layer === 'memory' ? '记忆' : '全局规则'}：「${raw}」。` }
      },
    }))
    track(ctx.commands.register({
      name: 'habit-list',
      description: 'List all saved rules and memories.',
      async handler() {
        const state = await store.publicState()
        const parts = []
        if (state.rules.length) parts.push(`规则（${state.rules.length}）：\n${state.rules.map((r, i) => `${i + 1}. [${r.scope}/${r.category}] ${r.text}`).join('\n')}`)
        if (state.memories.length) parts.push(`记忆（${state.memories.length}）：\n${state.memories.map((m, i) => `${i + 1}. [${m.scope}] ${m.text}`).join('\n')}`)
        return { kind: 'success', text: parts.length ? parts.join('\n\n') : '当前没有已保存的规则或记忆。' }
      },
    }))
  } catch (err) {
    ctx.logger?.warn?.(`[user-standards] command registration skipped: ${err?.message || err}`)
  }

  // ---- Conservative nudges ------------------------------------------------
  const isOurMessage = (message) => {
    try {
      return message?.source?.kind === 'dsh-user-standards'
    } catch {
      return false
    }
  }

  track(ctx.on('agent/inbox/inserted', (payload) => {
    try {
      const message = payload?.message
      if (!message || isOurMessage(message)) return
      const text = textFromMessage(message)
      if (!text) return
      const agent = payload?.agent
      void (async () => {
        const cwd = await agentCwd(ctx, agent)
        await store.recordObservation(text, message?.source?.kind, cwd)
      })().catch(() => {})
    } catch {
      // Never let a reminder break the agent loop.
    }
  }))

  track(ctx.on('agent/turn-stopping', (payload) => {
    try {
      const agent = payload?.agent
      if (!agent) return
      void (async () => {
        const suggestion = await store.getSuggestion()
        if (!suggestion) return
        const state = await store.ensure()
        const confirm = state.config.confirmOnNudge
        const targetLabel = suggestion.target === 'rule' ? '规则' : '记忆'
        const toolName = 'user_standards_save'
        const layerArg = suggestion.target === 'rule' ? 'rule' : 'memory'
        let reminder
        if (suggestion.explicit) {
          reminder = `用户刚才明确要求${suggestion.target === 'rule' ? '把某条要求写入配置/规则' : '记住某些内容'}：「${suggestion.text}」。${
            confirm
              ? '请先询问用户是否保存；用户确认后再调用 user_standards_save 工具（layer="%s", scope="%s"）保存。'.replace('%s', layerArg).replace('%s', suggestion.scope)
              : `请调用 ${toolName} 工具（layer="${layerArg}", scope="${suggestion.scope}"）把它保存为${targetLabel}，并简要告知用户。`
          }`
        } else {
          reminder = `检测到用户多次纠正同一类要求（已出现 ${suggestion.count} 次）：「${suggestion.text}」。这可能是一条值得记住的长期信息（默认建议记为记忆）。${
            confirm
              ? `请先询问用户是否保存为${targetLabel}；用户确认后再调用 ${toolName} 工具（layer="${layerArg}"）保存。`
              : `若判断它长期适用，请调用 ${toolName} 工具（layer="${layerArg}"）保存为${targetLabel}，并简要告知用户。`
          }`
        }
        const message = {
          id: `us-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'user',
          content: [{ type: 'text', text: reminder }],
          source: { kind: 'dsh-user-standards' },
        }
        try {
          agent.inject(message)
        } catch {
          // inject is best-effort; the settings UI and tools remain available.
        }
        await store.markAgentNotified(suggestion.key)
      })().catch(() => {})
    } catch {
      // Never break turn teardown.
    }
  }))

  // ---- HTTP bridge for the Client settings page ---------------------------
  const webInject = ctx.inject(['webServer'], (injected) => {
    const webServer = injected.webServer
    if (!webServer?.register) return () => {}
    const routes = []
    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-user-standards/state',
      resource: async () => json(await store.publicState()),
    }))
    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-user-standards/suggestion',
      resource: async () => json({ suggestion: await store.getSuggestion() }),
    }))
    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-user-standards/update',
      handler: async (req, res) => {
        try {
          const raw = await readRequestBody(req)
          const body = JSON.parse(raw || '{}')
          const result = await store.applyUpdate(body)
          const state = await store.publicState()
          nodeJson(res, 200, { ok: true, result, state })
        } catch (err) {
          nodeJson(res, 400, { ok: false, error: err?.message || String(err) })
        }
      },
    }))
    return () => {
      for (const dispose of routes) {
        try { dispose() } catch { /* ignore */ }
      }
    }
  })
  track(webInject)

  return () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose() } catch { /* ignore */ }
    }
  }
}

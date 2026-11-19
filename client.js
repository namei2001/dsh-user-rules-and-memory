/**
 * @local/dsh-user-standards — Client half (v2: rules + memory, user/project scope)
 *
 * - Settings page (settings.section): two tabs — Rules (rules injected via
 *   AGENTS.md) and Memories (soft notes retrieved on demand). Each entry has
 *   a user/project scope. Config panel for nudge thresholds and defaults.
 * - Turn-tail nudge chip (conversation.chat.turnTail): shows the pending save
 *   suggestion; one click saves it to the correct layer.
 *
 * All data flows through the same-origin HTTP bridge exposed by index.js.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-user-standards',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useCallback } = React
    const h = React.createElement

    // Inject our small button style once (themes flow through alias tokens).
    if (typeof document !== 'undefined' && !document.getElementById('dsus-style')) {
      const style = document.createElement('style')
      style.id = 'dsus-style'
      style.textContent = [
        '.dsus-btn{appearance:none;border:1px solid var(--dsw-alias-brand-primary,#4c8bf5);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4c8bf5) 18%,transparent);color:var(--dsw-alias-label-primary,#e6e6e6);padding:6px 14px;border-radius:9px;font-size:12px;line-height:1.2;cursor:pointer;font-family:inherit;transition:background .15s,border-color .15s}',
        '.dsus-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4c8bf5) 30%,transparent)}',
        '.dsus-btn:disabled{opacity:.5;cursor:not-allowed}',
        '.dsus-btn.ghost{border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:transparent;color:var(--dsw-alias-label-secondary,#9aa0a6)}',
        '.dsus-btn.ghost:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-secondary,#9aa0a6) 12%,transparent)}',
        '.dsus-btn.danger{border-color:var(--dsw-alias-state-error-primary,#ff6b6b);color:var(--dsw-alias-state-error-primary,#ff6b6b)}',
        '.dsus-card{background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.04));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:14px;padding:16px;margin-bottom:16px}',
        '.dsus-field{width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;font-family:inherit;boxSizing:border-box;resize:vertical;outline:none}',
        '.dsus-field:focus{border-color:var(--dsw-alias-brand-primary,#4c8bf5)}',
        '.dsus-field.small{width:auto;padding:6px 10px;font-size:12px;border-radius:9px}',
        '.dsus-pill{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:999px;font-size:11px;line-height:1.6;background:color-mix(in srgb,var(--dsw-alias-label-secondary,#9aa0a6) 14%,transparent);color:var(--dsw-alias-label-secondary,#9aa0a6);white-space:nowrap}',
        '.dsus-pill.brand{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4c8bf5) 20%,transparent);color:var(--dsw-alias-brand-primary,#4c8bf5)}',
        '.dsus-tab{padding:6px 16px;border-radius:999px;font-size:12px;cursor:pointer;font-family:inherit;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#9aa0a6);transition:background .15s,border-color .15s}',
        '.dsus-tab:hover{background:color-mix(in srgb,var(--dsw-alias-label-secondary,#9aa0a6) 10%,transparent)}',
        '.dsus-tab.active{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4c8bf5) 18%,transparent);border-color:var(--dsw-alias-brand-primary,#4c8bf5);color:var(--dsw-alias-label-primary,#e6e6e6)}',
        '.dsus-empty{border:1px dashed var(--dsw-alias-border-l2,rgba(255,255,255,.18));border-radius:14px;padding:18px;text-align:center;color:var(--dsw-alias-label-secondary,#9aa0a6);font-size:12px;line-height:1.6;margin-bottom:16px}',
        '.dsus-entry{background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.04));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:12px;padding:12px 14px;margin-bottom:10px}',
        '.dsus-entry-foot{display:flex;align-items:center;gap:12px;margin-top:10px;padding-top:9px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));font-size:11px;flex-wrap:wrap}',
        '.dsus-link{appearance:none;border:0;background:transparent;color:var(--dsw-alias-brand-primary,#4c8bf5);font-size:11px;cursor:pointer;font-family:inherit;padding:0}',
        '.dsus-link.muted{color:var(--dsw-alias-label-secondary,#9aa0a6)}',
        '.dsus-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa0a6)}',
        '.dsus-checkbox{accent-color:var(--dsw-alias-brand-primary,#4c8bf5);width:15px;height:15px;cursor:pointer}',
      ].join('\n')
      document.head.appendChild(style)
    }

    const STATE_URL = '/dsh-user-standards/state'
    const SUGGESTION_URL = '/dsh-user-standards/suggestion'
    const UPDATE_URL = '/dsh-user-standards/update'

    const DICTS = {
      zh: {
        nav: '用户习惯与规则',
        title: '用户习惯与规则',
        subtitle: '规则（强约束，始终注入）与记忆（软参考，按需检索）；均可设为全局或仅当前项目。',
        loadFailed: '加载失败',
        retry: '重试',
        tabRules: '规则',
        tabMemories: '记忆',
        noRules: '还没有规则。规则是每次会话都会注入的强约束；你可以在下方添加。',
        noMemories: '还没有记忆。记忆是“记住 X”的软信息，索引会出现在上下文，完整内容按需查询。',
        addRuleTitle: '添加规则',
        addMemoryTitle: '添加记忆',
        addPlaceholder: '例如：所有回复使用中文，代码注释用英文',
        add: '添加',
        saving: '保存中…',
        category: '分类',
        categories: { user: '用户偏好', feedback: '纠正与反馈', project: '项目约定', reference: '参考资料' },
        scope: '作用域',
        scopes: { user: '全局（所有项目）', project: '仅当前项目' },
        edit: '编辑',
        remove: '删除',
        cancel: '取消',
        confirm: '保存修改',
        source: '来源',
        sources: { manual: '手动', settings: '设置页', agent: 'Agent', command: '命令' },
        memoryHint: '记忆索引最多注入 %s 条；完整内容由 Agent 用 recall 工具查询。',
        scopeHintSettings: '此处仅添加全局内容（所有项目生效）。项目专属内容请让 Agent 在会话中保存，以自动绑定当前项目。',
        configTitle: '提醒与默认设置',
        nudgesEnabled: '重复纠正提醒',
        repeatThreshold: '触发次数阈值',
        cooldownMinutes: '提醒冷却（分钟）',
        confirmOnNudge: '提醒时二次确认',
        autoSaveOnExplicit: '明确要求时自动保存',
        rememberDefault: '“记住 X”默认存为',
        rememberDefaults: { memory: '记忆（软参考）', rule: '规则（强约束）' },
        memoryIndexMax: '记忆索引条数上限',
        saveConfig: '保存设置',
        agentPath: '全局规则文件',
        suggestionTitle: '发现可保存的内容',
        suggestionBody: '检测到重复纠正：',
        suggestionExplicit: '用户明确要求记住：',
        saveNow: '保存',
        confirmSaveQuestion: '确认保存到用户习惯与规则？',
        dismiss: '忽略',
        saved: '已保存',
        openSettings: '在设置中管理',
        savedToast: '已保存。',
        alreadyExists: '内容已存在，未重复添加。',
        removed: '已删除。',
        countRules: '条规则',
        countMemories: '条记忆',
      },
      en: {
        nav: 'User standards',
        title: 'User standards',
        subtitle: 'Rules (hard constraints, always injected) and memories (soft notes, retrieved on demand); each can be global or project-only.',
        loadFailed: 'Failed to load',
        retry: 'Retry',
        tabRules: 'Rules',
        tabMemories: 'Memories',
        noRules: 'No rules yet. Rules are injected into every session; add one below.',
        noMemories: 'No memories yet. "Remember X" notes go here — the index is injected, full content is retrieved on demand.',
        addRuleTitle: 'Add a rule',
        addMemoryTitle: 'Add a memory',
        addPlaceholder: 'e.g. Always reply in English; keep code comments concise',
        add: 'Add',
        saving: 'Saving…',
        category: 'Category',
        categories: { user: 'Preference', feedback: 'Correction', project: 'Project', reference: 'Reference' },
        scope: 'Scope',
        scopes: { user: 'Global (all projects)', project: 'Current project only' },
        edit: 'Edit',
        remove: 'Remove',
        cancel: 'Cancel',
        confirm: 'Save changes',
        source: 'Source',
        sources: { manual: 'Manual', settings: 'Settings', agent: 'Agent', command: 'Command' },
        memoryHint: 'At most %s memories are injected as an index; full content is retrieved by the agent via recall.',
        scopeHintSettings: 'Only global entries are added here (all projects). For project-specific entries, ask the agent to save them in-session so the current project is bound automatically.',
        configTitle: 'Reminders & defaults',
        nudgesEnabled: 'Repeated-correction reminders',
        repeatThreshold: 'Repeat threshold',
        cooldownMinutes: 'Cooldown (minutes)',
        confirmOnNudge: 'Confirm before saving',
        autoSaveOnExplicit: 'Auto-handle explicit requests',
        rememberDefault: '“Remember X” saves as',
        rememberDefaults: { memory: 'Memory (soft note)', rule: 'Rule (hard constraint)' },
        memoryIndexMax: 'Memory index limit',
        saveConfig: 'Save settings',
        agentPath: 'Global rules file',
        suggestionTitle: 'Something worth saving',
        suggestionBody: 'Repeated correction detected:',
        suggestionExplicit: 'You asked to remember:',
        saveNow: 'Save',
        confirmSaveQuestion: 'Confirm saving to user standards?',
        dismiss: 'Dismiss',
        saved: 'Saved',
        openSettings: 'Manage in settings',
        savedToast: 'Saved.',
        alreadyExists: 'That entry already exists — nothing was added.',
        removed: 'Removed.',
        countRules: 'rules',
        countMemories: 'memories',
      },
    }

    function detectLang(ctx) {
      try {
        const locale = ctx.get('locale')?.getLocale?.()
        const active = locale?.active || locale?.current || locale?.language
        if (active) return String(active).toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch { /* ignore */ }
      try {
        return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch {
        return 'en'
      }
    }

    const C = {
      text: 'var(--dsw-alias-label-primary, #e6e6e6)',
      textLo: 'var(--dsw-alias-label-secondary, #9aa0a6)',
      textFaint: 'var(--dsw-alias-label-secondary, #6f7378)',
      line: 'var(--dsw-alias-border-l2, rgba(255,255,255,0.12))',
      lineSoft: 'var(--dsw-alias-border-l1, rgba(255,255,255,0.08))',
      bg: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.04))',
      bg2: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.06))',
      danger: 'var(--dsw-alias-state-error-primary, #ff6b6b)',
      brand: 'var(--dsw-alias-brand-primary, #4c8bf5)',
      ok: 'var(--dsw-alias-state-success-primary, #3fb950)',
    }

    async function getJson(url) {
      const r = await fetch(url, { credentials: 'same-origin' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    }

    async function postUpdate(body) {
      const r = await fetch(UPDATE_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      return data
    }

    function useStandards(t) {
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)

      const load = useCallback(async () => {
        setError(null)
        try {
          setData(await getJson(STATE_URL))
        } catch (e) {
          setError(e?.message || t.loadFailed)
        }
      }, [t])

      useEffect(() => { void load() }, [load])

      const act = useCallback(async (body) => {
        setBusy(true)
        setError(null)
        try {
          const res = await postUpdate(body)
          setData(res.state)
          return res.result
        } catch (e) {
          setError(e?.message || t.loadFailed)
          return null
        } finally {
          setBusy(false)
        }
      }, [t])

      return { data, error, busy, load, act }
    }

    function EntryRow({ entry, layer, t, busy, onEdit, onRemove }) {
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState(entry.text)
      const save = async () => {
        if (!draft.trim()) return
        const res = await onEdit(layer, entry.id, draft.trim())
        if (res && res.status !== 'not-found') setEditing(false)
      }
      const scopeLabel = (t.scopes[entry.scope] || entry.scope || t.scopes.user)
      const meta = layer === 'rule'
        ? `${scopeLabel} · ${t.categories[entry.category] || entry.category}`
        : scopeLabel
      return h('div', { className: 'dsus-entry' },
        !editing
          ? h('div', { style: { fontSize: 13, lineHeight: 1.55, color: C.text, whiteSpace: 'pre-wrap' } }, entry.text)
          : h('textarea', {
              className: 'dsus-field', value: draft, rows: 2,
              onChange: (e) => setDraft(e.target.value),
            }),
        h('div', { className: 'dsus-entry-foot' },
          h('span', { className: 'dsus-pill' + (entry.scope === 'user' ? ' brand' : '') }, scopeLabel),
          layer === 'rule' ? h('span', { className: 'dsus-pill' }, t.categories[entry.category] || entry.category) : null,
          h('span', { style: { color: C.textFaint } }, `${t.source}: ${t.sources[entry.source] || entry.source}`),
          h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 12 } },
            editing
              ? h(React.Fragment, {},
                  h('button', { className: 'dsus-link', disabled: busy, onClick: save }, t.confirm),
                  h('button', { className: 'dsus-link muted', disabled: busy, onClick: () => { setDraft(entry.text); setEditing(false) } }, t.cancel),
                )
              : h(React.Fragment, {},
                  h('button', { className: 'dsus-link', disabled: busy, onClick: () => setEditing(true) }, t.edit),
                  h('button', { className: 'dsus-link muted', disabled: busy, onClick: () => onRemove(layer, entry.id) }, t.remove),
                ),
          ),
        ),
      )
    }

    function ConfigPanel({ config, t, busy, onSave }) {
      const [draft, setDraft] = useState(config)
      useEffect(() => { setDraft(config) }, [config])
      const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }))
      const row = (key, label, control) => h('div', { className: 'dsus-row' }, h('span', {}, label), control)
      const numInput = (key, min, max) => h('input', {
        type: 'number', min, max, value: draft[key],
        onChange: (e) => set(key, e.target.value),
        className: 'dsus-field small', style: { width: 66 },
      })
      const checkbox = (key) => h('input', {
        type: 'checkbox', checked: !!draft[key],
        onChange: (e) => set(key, e.target.checked),
        className: 'dsus-checkbox',
      })
      const select = (key, options) => h('select', {
        value: draft[key], onChange: (e) => set(key, e.target.value),
        className: 'dsus-field small',
      }, Object.keys(options).map((k) => h('option', { key: k, value: k }, options[k])))
      return h('div', { className: 'dsus-card' },
        h('div', { style: { fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 } }, t.configTitle),
        row('rememberDefault', t.rememberDefault, select('rememberDefault', t.rememberDefaults)),
        row('memoryIndexMax', t.memoryIndexMax, numInput('memoryIndexMax', 0, 200)),
        h('div', { style: { fontSize: 11, color: C.textFaint, margin: '2px 0 6px', lineHeight: 1.5 } }, t.memoryHint.replace('%s', String(draft.memoryIndexMax ?? 20))),
        row('nudgesEnabled', t.nudgesEnabled, checkbox('nudgesEnabled')),
        row('repeatThreshold', t.repeatThreshold, numInput('repeatThreshold', 1, 10)),
        row('cooldownMinutes', t.cooldownMinutes, numInput('cooldownMinutes', 0, 1440)),
        row('confirmOnNudge', t.confirmOnNudge, checkbox('confirmOnNudge')),
        row('autoSaveOnExplicit', t.autoSaveOnExplicit, checkbox('autoSaveOnExplicit')),
        h('button', {
          className: 'dsus-btn', disabled: busy,
          style: { marginTop: 10 },
          onClick: () => onSave({
            nudgesEnabled: !!draft.nudgesEnabled,
            repeatThreshold: Number(draft.repeatThreshold) || 2,
            cooldownMinutes: Number.isFinite(Number(draft.cooldownMinutes)) ? Number(draft.cooldownMinutes) : 0,
            confirmOnNudge: !!draft.confirmOnNudge,
            autoSaveOnExplicit: !!draft.autoSaveOnExplicit,
            rememberDefault: draft.rememberDefault === 'rule' ? 'rule' : 'memory',
            memoryIndexMax: Number.isFinite(Number(draft.memoryIndexMax)) ? Number(draft.memoryIndexMax) : 20,
          }),
        }, t.saveConfig),
      )
    }

    function StandardsSection(props) {
      const ctx = props.ctx
      const t = DICTS[detectLang(ctx)]
      const { data, error, busy, load, act } = useStandards(t)
      const [tab, setTab] = useState('rule')
      const [draft, setDraft] = useState('')
      const [category, setCategory] = useState('user')
      const [scope, setScope] = useState('user')
      const [notice, setNotice] = useState(null)

      const flash = (msg) => {
        setNotice(msg)
        setTimeout(() => setNotice(null), 2600)
      }

      const add = async () => {
        if (!draft.trim()) return
        // Project scope is intentionally unavailable on this global settings page:
        // there is no reliable "current project" here, and a wrong projectPath would
        // write AGENTS.md into the wrong folder. Project-scoped entries should be
        // created by the agent in-session (via the tool or the nudge chip), where cwd
        // is known. See issue: settings project-scope misrouting.
        const res = await act({ action: 'add', layer: tab, text: draft.trim(), category, scope: 'user' })
        if (res) {
          if (res.status === 'duplicate') flash(t.alreadyExists)
          else setDraft('')
        }
      }
      const edit = async (layer, id, text) => {
        const res = await act({ action: 'update', layer, id, text })
        if (res && res.status !== 'not-found') flash(t.saved)
        return res
      }
      const remove = async (layer, id) => {
        const res = await act({ action: 'remove', layer, id })
        if (res && res.status !== 'not-found') flash(t.removed)
      }
      const saveConfig = async (patch) => {
        const res = await act({ action: 'config', patch })
        if (res) flash(t.saved)
      }

      const styles = {
        wrap: { maxWidth: 680, margin: '0 auto', padding: '4px 2px 24px', color: C.text, fontFamily: 'inherit' },
        h1: { fontSize: 19, fontWeight: 600, margin: '0 0 4px' },
        sub: { fontSize: 12, color: C.textLo, marginBottom: 18, lineHeight: 1.6 },
      }
      const tabBtn = (key, label) => h('button', {
        className: 'dsus-tab' + (tab === key ? ' active' : ''),
        onClick: () => { setTab(key); setDraft('') },
      }, label)

      const entries = !data ? [] : (tab === 'rule' ? data.rules : data.memories)

      return h('div', { style: styles.wrap },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
          h('h1', { style: styles.h1 }, t.title),
          typeof props.close === 'function' ? h('button', { className: 'dsus-btn ghost', onClick: props.close, 'aria-label': 'Close' }, '✕') : null,
        ),
        h('div', { style: styles.sub }, t.subtitle),
        h('div', { style: { display: 'inline-flex', gap: 4, padding: 3, borderRadius: 999, background: C.bg, border: `1px solid ${C.lineSoft}`, marginBottom: 16 } },
          tabBtn('rule', `${t.tabRules} · ${data ? data.stats.totalRules : 0}`),
          tabBtn('memory', `${t.tabMemories} · ${data ? data.stats.totalMemories : 0}`),
        ),

        error ? h('div', { style: { color: C.danger, fontSize: 12, marginBottom: 12 } },
          `${t.loadFailed}: ${error}`, ' ', h('button', { className: 'dsus-btn ghost', onClick: load }, t.retry)) : null,

        !data ? h('div', { style: { color: C.textLo, fontSize: 12 } }, '…') : h(React.Fragment, {},
          h('div', { className: 'dsus-card' },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 10 } },
              tab === 'rule' ? t.addRuleTitle : t.addMemoryTitle),
            h('textarea', {
              className: 'dsus-field', rows: 2, value: draft, placeholder: t.addPlaceholder,
              onChange: (e) => setDraft(e.target.value),
            }),
            tab === 'memory' ? h('div', { style: { fontSize: 11, color: C.textFaint, marginTop: 8, lineHeight: 1.5 } }, t.scopeHintSettings) : null,
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' } },
              tab === 'rule' ? h(React.Fragment, {},
                h('span', { style: { fontSize: 12, color: C.textLo } }, t.category),
                h('select', { value: category, onChange: (e) => setCategory(e.target.value), className: 'dsus-field small' },
                  Object.keys(t.categories).map((k) => h('option', { key: k, value: k }, t.categories[k]))),
              ) : null,
              h('button', { className: 'dsus-btn', disabled: busy || !draft.trim(), onClick: add, style: { marginLeft: 'auto' } },
                busy ? t.saving : t.add),
            ),
          ),

          entries.length === 0
            ? h('div', { className: 'dsus-empty' }, tab === 'rule' ? t.noRules : t.noMemories)
            : h('div', { style: { marginBottom: 16 } },
                entries.map((e) => h(EntryRow, { key: e.id, entry: e, layer: tab, t, busy, onEdit: edit, onRemove: remove }))),

          h(ConfigPanel, { config: data.config, t, busy, onSave: saveConfig }),

          h('div', { style: { marginTop: 14, fontSize: 11, color: C.textFaint, wordBreak: 'break-all' } },
            `${t.agentPath}: ${data.agentsPath}`),
        ),

        notice ? h('div', {
          style: {
            position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)',
            background: C.ok, color: 'var(--dsw-alias-bg-base, #0a0e13)', padding: '8px 16px', borderRadius: 20, fontSize: 12, zIndex: 9999,
          },
        }, notice) : null,
      )
    }

    function TurnTailNudge(props) {
      const ctx = props?.ctx
      const [suggestion, setSuggestion] = useState(null)
      const [busy, setBusy] = useState(false)
      const [done, setDone] = useState(false)
      const [confirming, setConfirming] = useState(false)
      const [claimed, setClaimed] = useState(null)

      const t = DICTS[detectLang(ctx || { get: () => undefined })]

      useEffect(() => {
        if (claimed) return
        let alive = true
        const check = async () => {
          try {
            const res = await getJson(SUGGESTION_URL)
            if (alive) setSuggestion(res.suggestion || null)
          } catch { /* ignore */ }
        }
        void check()
        const timer = setInterval(check, 8000)
        return () => { alive = false; clearInterval(timer) }
      }, [claimed])

      useEffect(() => {
        if (suggestion && !claimed) {
          setClaimed(suggestion.key)
          postUpdate({ action: 'nudged', key: suggestion.key }).catch(() => {})
        }
      }, [suggestion, claimed])

      if (!suggestion || done) return null

      const doSave = async () => {
        setBusy(true)
        try {
          await postUpdate({
            action: 'add',
            layer: suggestion.target === 'rule' ? 'rule' : 'memory',
            text: suggestion.text,
            category: suggestion.explicit ? 'feedback' : 'user',
            scope: suggestion.scope || 'user',
          })
          setDone(true)
        } catch { /* ignore */ }
        setBusy(false)
      }
      const onSave = () => {
        if (suggestion.confirmOnNudge) setConfirming(true)
        else void doSave()
      }
      const onConfirm = () => { setConfirming(false); void doSave() }
      const dismiss = async () => {
        try { await postUpdate({ action: 'dismiss', key: suggestion.key }) } catch { /* ignore */ }
        setDone(true)
      }
      // Label by intent (explicit request vs repeated correction), independent
      // of the storage target (rule/memory) — an explicit "remember X" should
      // read "You asked to remember", not "Repeated correction detected".
      const label = suggestion.explicit ? t.suggestionExplicit : t.suggestionBody

      return h('div', {
        className: 'dsus-card',
        style: { padding: '10px 14px', margin: '4px 0', fontSize: 12, color: C.textLo },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('span', { className: 'dsus-pill brand' }, t.suggestionTitle),
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260, color: C.text }, title: suggestion.text },
            label + suggestion.text),
          h('button', { className: 'dsus-btn', disabled: busy, onClick: onSave, style: { marginLeft: 'auto', flexShrink: 0 } }, busy ? '…' : t.saveNow),
          h('button', { className: 'dsus-btn ghost', disabled: busy, onClick: dismiss }, t.dismiss),
        ),
        confirming
          ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h('span', { style: { color: C.text } }, t.confirmSaveQuestion),
              h('button', { className: 'dsus-btn', disabled: busy, onClick: onConfirm }, busy ? '…' : t.confirm),
              h('button', { className: 'dsus-btn ghost', disabled: busy, onClick: () => setConfirming(false) }, t.cancel),
            )
          : null,
      )
    }

    function detectLangForSection(sectionCtx) {
      return detectLang(sectionCtx || { get: () => undefined })
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-user-standards',
            order: 20,
            label: () => DICTS[detectLangForSection(ctx)].nav,
          },
          (props) => h(StandardsSection, { ...props, ctx }),
        ))
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register(
          { name: 'settings.section.icon', id: 'dsh-user-standards' },
          (props) => {
            const size = props?.size || 18
            return h('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, style: { display: 'block' } },
              h('path', { d: 'M6 3h9l4 4v14H6z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
              h('path', { d: 'M14 3v5h5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
            )
          },
        ))

        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register(
          { name: 'conversation.chat.turnTail', id: 'dsh-user-standards-nudge', order: 10 },
          (props) => h(TurnTailNudge, { ...props, ctx }),
        ))
      },
    }
  },
})

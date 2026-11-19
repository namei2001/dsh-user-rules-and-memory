# Contributing

Thanks for helping improve `@local/dsh-user-standards`.

This is a **local DSH bundle**: a Host half (`index.js`) and a Client half
(`client.js`) wired together by `cordis.patch.yml` and the `dsh` fields in
`package.json`.

## Ground rules

- **Never edit the active profile's `cordis.patch.yml` by hand.** To change the
  bundle's wiring, edit the copy in this directory and reload the bundle.
- All runtime state lives in `$DSH_HOME/user-standards.json`; rendered rules live
  in managed blocks delimited by
  `<!-- BEGIN DSH USER STANDARDS ... -->` … `<!-- END DSH USER STANDARDS -->`.
  Only rewrite the plugin's own block — preserve everything else in `AGENTS.md`.
- Any new tunable value must be added to `defaultConfig()` **and** the Settings
  page `ConfigPanel`, with clamping in `updateConfig()`.
- Client code must not import any `@deepseek-ai/dsh-client-*` module; use the
  documented `window.__ModuleLoader__.load` + `slots` pattern and `--dsw-alias-*`
  theme tokens.

## Dev loop

1. Make the change in `index.js` / `client.js` / `locale/*.json`.
2. Syntax check with a recent Node/Electron:
   `node --check index.js && node --check client.js`
3. Reload the linked bundle:
   `plugin_manager set_bundle { target: '@local/dsh-user-standards', enabled: false }`,
   then `enabled: true`.
4. Smoke-test the live HTTP bridge:
   `GET /dsh-user-standards/state` should return `version: 2` with current
   config and empty rules/memories.
5. Verify new UI text in **both** `locale/en.json` and `locale/zh.json`.

## Tests

Static manifest tests live in `tests/manifest.test.mjs` and need no running
Harness:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& $env:DSH_NODE_EXECUTABLE --test tests/manifest.test.mjs
```

`scripts/healthcheck.mjs` validates the manifest/locale/detail docs **and**
probes the live HTTP bridge (`GET /dsh-user-standards/state`) when a Harness is
running. It always writes its result to `scripts/healthcheck.out.txt` (the
Electron-as-node runtime swallows stdout):

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& $env:DSH_NODE_EXECUTABLE scripts/healthcheck.mjs
Get-Content scripts/healthcheck.out.txt
```

Run both before a release.

## Style

- Prefer `h()` / plain DOM in `client.js`; keep effects cleaned up.
- Use theme tokens with sensible fallbacks: `var(--dsw-alias-..., <fallback>)`.
- Keep the Client and Host in sync: a new HTTP action needs both a Host route
  handler in `applyUpdate()` and a Client caller.

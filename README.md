# @local/dsh-user-rules-and-memory

跨项目的用户习惯与规则插件，用于 [DeepSeek Harness](http://127.0.0.1:61098)（DSH 0.2.2-rc.3+）。

它把主流 Agent（Claude Code / Cursor / WorkBuddy / Windsurf）成熟的「规则 / 记忆」分离设计带进 DSH：**规则是强约束、每次会话都注入；记忆是软参考、只注入索引、按需检索**。两者都可以是**全局**（所有项目）或**项目专属**作用域。

- 在 **设置 → 用户习惯与规则** 主动添加、编辑、删除
- Agent 在会话中识别「记住 X」「写入配置 / 以后都 / 强制」等意图并克制的提醒，或直接保存
- 借助 DSH 自带的 `AGENTS.md` 注入链路，规则自动对所有项目生效，无需重复造轮子

## 为什么需要它

DSH 本身**没有**用户习惯 / 记忆配置（没有 `MEMORY.md` / `SOUL.md` / `USER.md`，也没有自动记忆），但它提供了两个可靠的机制：

1. 用户全局与项目级 `AGENTS.md` / `CLAUDE.md` 指令链，会在每次会话自动注入（每条链 65,536 字节预算）；
2. 每 Agent 作用域的系统提示上下文，可在每次组装时动态求值。

本插件复用这两条机制，再加一个轻量记忆索引与 `recall` 工具，不自行实现提示注入。

## 功能

### 两层 × 两作用域

| | **规则（强约束）** | **记忆（软参考）** |
|---|---|---|
| **全局 user** | `$DSH_HOME/AGENTS.md`，注入**所有**项目 | 全局记忆库；轻量索引全局注入 |
| **项目 project** | `<项目根>/AGENTS.md`，仅该项目注入 | 项目记忆；索引仅该项目可见 |

- **规则**：显式约束，由「写入配置 / 写进习惯 / 加入规则 / 以后都 / 从现在起 / 强制 / always do / from now on」等措辞触发，始终注入。
- **记忆**：隐式笔记，由「记住 X / 记得 / remember this / save this」触发；只注入一行索引，完整内容由 Agent 用 `user_standards_recall` 按需查询，节省上下文预算。

### 三项核心能力

1. **主动配置**——设置页分栏管理规则与记忆，含作用域、分类、提醒阈值、默认值、记忆索引条数。
2. **合理提醒**——监听用户消息中的纠正与显式意图；同一纠正达到阈值（默认 2 次）时，在回合末给出克制提醒并显示保存 chip；带冷却时间避免打扰。目标层（规则/记忆）由用户措辞决定，提醒文案按**意图**标注而非存储目标。
3. **即时保存**——「记住 X」默认存为记忆；「写入配置 / 规则 / 以后都」立即存为规则。可通过工具或斜杠命令手动保存。

### 工具与命令

| 入口 | 说明 |
|---|---|
| `user_standards_save` | 参数：`text`、`layer`(rule\|memory)、`scope`(user\|project)、`category`、`reason`；自动从措辞推断 layer |
| `user_standards_recall` | 参数：`query`、`limit`；按关键词/词元重合查找相关记忆 |
| `/habit-save <内容>` | 默认存为规则；加 `--memory` 存为记忆 |
| `/habit-list` | 列出全部规则与记忆 |

> 全局设置页添加的内容始终为 `user` 作用域；项目专属内容请在会话中由 Agent 保存（此时工作目录已知），以自动绑定当前项目根。

## 安装

在本项目目录执行（通过插件管理器安装为本地 bundle）：

```
plugin_manager install_bundle { target: "<本目录的绝对路径>" }
```

不要手动编辑 profile 的 `cordis.patch.yml`。插件启用后，设置页会多出「用户习惯与规则」入口，会话底部会出现保存提醒 slot。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `nudgesEnabled` | `true` | 重复纠正提醒总开关 |
| `repeatThreshold` | `2` | 同一纠正出现几次后给出保存建议（1–10） |
| `cooldownMinutes` | `30` | 两次提醒之间的最小间隔（0–1440） |
| `confirmOnNudge` | `true` | 保存推断出的建议前二次确认 |
| `autoSaveOnExplicit` | `true` | 把显式「记住」视为直接保存授权 |
| `rememberDefault` | `memory` | 「记住 X」默认存为 `memory` 或 `rule` |
| `memoryIndexMax` | `20` | 始终注入的记忆索引条数上限（0 = 禁用索引） |

## 工作原理

- 结构化状态：`$DSH_HOME/user-standards.json`（v2，自动从 v1 迁移），保存规则、记忆、配置、观察与提醒状态。
- 渲染后的规则写入 `AGENTS.md` 的托管块：
  `<!-- BEGIN DSH USER STANDARDS ... -->` … `<!-- END DSH USER STANDARDS -->`；只重写本插件的块，其他内容原样保留。
- `dsh-agent-instructions` 自动注入 `AGENTS.md`；项目根通过向上查找 `.git` 定位。
- 记忆索引用 `agent.ctx.systemPrompt.context()` 按会话工作目录动态求值，每个会话只看到与本项目相关的索引。
- 设置页、工具、命令共用同一 Host store，通过同源 HTTP 桥（`/dsh-user-standards/state|suggestion|update`）通信。

## 项目结构

```
dsh-user-standards/
├── .github/
│   └── workflows/
│       └── ci.yml          # CI：语法检查 + manifest 测试
├── docs/
│   ├── DETAIL.md           # 插件详情页（英文，单图）
│   ├── DETAIL.zh.md        # 插件详情页（中文，单图）
│   └── preview.svg         # 功能预览图（640×300）
├── scripts/
│   └── healthcheck.mjs     # 清单/本地化/文档 + 在线 /state 健康检查
├── tests/
│   └── manifest.test.mjs   # 无需运行 Harness 的静态测试
├── .env.example            # 环境变量模板（无真实密钥）
├── .gitignore
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE                 # MIT
├── README.md               # 本文件
├── client.js               # Client 半：设置页 + 会话提醒 chip
├── index.js                # Host 半：store / 工具 / 命令 / HTTP 桥
├── cordis.patch.yml        # bundle 插入声明
├── icon.svg                # 插件图标（36×36）
├── locale/
│   ├── en.json
│   └── zh.json
└── package.json            # bundle 清单与 dsh 配置
```

> 说明：这是一个 JS bundle 而非 Python 包，因此采用与 `pyproject.toml` / `src/` layout 等价的 JS 布局——`package.json` 承担 Python 项目中 `pyproject.toml` 的角色，`index.js` + `client.js` 即源码，测试放在 `tests/`，辅助脚本放在 `scripts/`。

## 开发

```powershell
# 语法检查
$env:ELECTRON_RUN_AS_NODE='1'
& $env:DSH_NODE_EXECUTABLE --check index.js
& $env:DSH_NODE_EXECUTABLE --check client.js

# 静态测试（CI 用真实 Node 运行；本沙箱禁止子进程 spawn，会报 EPERM）
& $env:DSH_NODE_EXECUTABLE --test tests/manifest.test.mjs

# 健康检查（结果写入 scripts/healthcheck.out.txt）
& $env:DSH_NODE_EXECUTABLE scripts/healthcheck.mjs
```

改动后重载 bundle：`plugin_manager set_bundle` 依次设为 `enabled:false`、`enabled:true`。

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。当前版本：**2.0.0**（规则 + 记忆架构）。

## 许可证

[MIT](LICENSE)

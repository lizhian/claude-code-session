# Agent Session

中文 | [English](README.md)

Claude Code、Codex 与 OpenCode 的 session 交互式选择器。Claude Code 使用 `cc`，Codex 使用 `cx`，OpenCode 使用 `oc`。

## 功能

- 列出当前目录的 Claude Code sessions。
- 列出当前目录的 Codex sessions。
- 列出当前目录的 OpenCode sessions。
- 新建 session 或恢复已有 session。
- 支持交互式搜索，并在同一行固定显示 `Permission`、`Matches` 和 `Search` 字段。
- 支持上下方向键移动选择。
- 显示短 session ID、相对更新时间、消息数量、首条 user 消息和最后一条 user 消息。
- 支持 permission mode 切换。
- 自动记住上次选择的权限模式。
- 使用从 `0` 开始的编号：`0` 新建 session，`1` 恢复第一条已有匹配。
- 右方向键进入 Claude Code、Codex 和 OpenCode 工作区选择模式。
- 在 Codex 和 OpenCode 工作区列表中进入配置动作。

## 依赖

- Node.js。
- `cc` 需要 Claude Code CLI。
- `cx` 需要 Codex CLI。
- `oc` 需要 OpenCode CLI 和 `sqlite3`。

安装脚本本身只强制要求 Node.js。安装别名前，请至少安装一个受支持的 agent CLI。

## 安装

克隆仓库后运行安装脚本。

macOS/Linux：

```bash
./install.sh
```

Windows PowerShell：

```powershell
.\install.ps1
```

安装脚本会检查 `PATH` 中当前可用的 agent CLI，并且只安装对应的选择器脚本和 alias/function。例如只安装了 `codex` 时，只会安装 `cx`。如果 `claude`、`codex`、`opencode` 都不存在，安装会失败。OpenCode session 浏览会通过 `sqlite3` 读取 OpenCode 的 SQLite 数据库；如果已安装 `opencode` 但缺少 `sqlite3`，脚本会提示警告并继续安装 `oc`。

安装后重新加载 shell 配置：

```bash
source ~/.zshrc
```

如果你使用 Bash，则执行：

```bash
source ~/.bashrc
```

Windows 下重启 PowerShell，或执行：

```powershell
. $PROFILE
```

## 使用

```bash
cc
```

查看 Codex sessions：

```bash
cx
```

查看 OpenCode sessions：

```bash
oc
```

交互快捷键：

- 输入文字进行搜索。
- 上下方向键移动选择。
- 回车打开选中的 session 或 workspace。
- `Tab` 切换权限模式。
- 右方向键进入工作区选择。
- 在 Codex 工作区列表中，右方向键进入 configurations，`Model provider` 会从 `~/.codex/config.toml` 切换全局 Codex model provider。
- 在 OpenCode 工作区列表中，右方向键进入 configurations。`Provider models` 会为 `@ai-sdk/*` providers 同步 model IDs，`Default model` 和 `Small model` 会更新 OpenCode 顶层 `model` 与 `small_model`。
- 左方向键返回上一层 picker 视图。
- `Esc` 或 `Ctrl-C` 取消。

选择器编号从 `0` 开始：选择 `0` 或在非交互提示里直接回车会创建新 session；选择 `1` 及以上会恢复已有 session。

配置快捷键：

- 在 session 列表按右方向键进入 workspace 列表。
- 在 workspace 列表按回车进入该 workspace 的 sessions。
- 在 workspace 列表按右方向键进入 provider configurations。
- 在多选配置页按 Space 切换选中状态，按 Enter 保存。

权限模式：

- Claude default：执行 `claude`。
- Claude auto：执行 `claude --enable-auto-mode`。
- Claude full：执行 `claude --dangerously-skip-permissions`。
- Codex default：执行 `codex`。
- Codex auto：执行 `codex --full-auto`。
- Codex full：执行 `codex --dangerously-bypass-approvals-and-sandbox`。
- OpenCode default：执行 `opencode`。
- OpenCode full：带 `OPENCODE_PERMISSION="allow"` 执行 `opencode`。

OpenCode 当前只支持 default 和 full 权限模式。

Claude 权限模式会自动记住，配置保存到：

```bash
~/.agent-session/claude-code.json
```

Codex 权限模式会自动记住，配置保存到：

```bash
~/.agent-session/codex.json
```

Codex model provider 配置：

- 读取 `~/.codex/config.toml`。
- 在 `Codex configurations` -> `Model provider` 中列出 `[model_providers.*]`。
- 使用顶层 `model_provider_selected` 记录 picker 当前选择的 provider。
- 切换 provider 前，先把当前 `~/.codex/auth.json` 回写到上一个 provider 的 `auth_json`。
- 如果找不到上一个 provider，会创建一个 `unknown-YYYYMMDD-HHmmss` provider，并写入 `name` 和 `auth_json`，避免当前 token 丢失。
- 目标 provider 有 `base_url` 时更新 Codex 原生顶层 `model_provider`；选择没有 `base_url` 的 provider 时删除 `model_provider`。

OpenCode 权限模式会自动记住，配置保存到：

```bash
~/.agent-session/opencode.json
```

OpenCode 配置：

- 读取 `~/.config/opencode/opencode.json`。
- 支持带注释和尾随逗号的 JSONC 风格输入。
- 写回时格式化为标准 JSON。
- `Provider models` 会列出带 `options.baseURL` 和 `options.apiKey` 的 `@ai-sdk/*` providers，使用 `GET {baseURL}/models` 拉取模型，并把选中的模型 ID 写入 `provider.<name>.models`。
- 如果某个 provider 自己的模型接口返回空列表，会尝试使用同 origin、同 API key 的其它 provider 作为模型列表来源。
- `Default model` 写入顶层 `model`，格式为 `provider/model`。
- `Small model` 写入顶层 `small_model`，格式为 `provider/model`。

## CLI

```bash
node claude/claude-sessions.js [--json | --pick] [--cwd <path>] [--claude-home <path>]
node codex/codex-sessions.js [--json | --pick] [--cwd <path>] [--codex-home <path>]
node opencode/opencode-sessions.js [--json | --pick] [--cwd <path>] [--opencode-data-home <path>]
```

参数：

- `--json`：输出 JSON。
- `--pick`：打开交互式选择器。
- `--trust-current-folder`：在底层工具支持本地信任配置时标记当前目录为已信任。Claude 会写入 `~/.claude.json`，Codex 会写入 `config.toml`；OpenCode 接受该参数是为了兼容安装别名，full permission 通过 `OPENCODE_PERMISSION` 控制。
- `--cwd <path>`：查看指定目录的 sessions。
- `--claude-home <path>`：指定 Claude home，默认使用 `~/.claude` 或 `CLAUDE_HOME`。
- `--codex-home <path>`：指定 Codex home，默认使用 `~/.codex` 或 `CODEX_HOME`。
- `--opencode-data-home <path>`：指定 OpenCode 数据目录，默认使用 `~/.local/share/opencode` 或 `OPENCODE_DATA_HOME`。

## 项目结构

- `claude/claude-sessions.js`：Claude Code session CLI。
- `codex/codex-sessions.js`：Codex session CLI。
- `codex/codex-model-providers.js`：Codex model provider 配置解析、auth 备份和 provider 切换逻辑。
- `opencode/opencode-sessions.js`：OpenCode session CLI，通过 `sqlite3` 读取 `opencode.db`。
- `opencode/opencode-provider-models.js`：OpenCode provider model 发现和 `opencode.json` 更新逻辑。
- `common/session-utils.js`：共享的配置、JSONL、进程启动、工作区过滤和交互式 picker 辅助逻辑。
- `common/session-renderer.js`：共享的 session 表格、workspace 列表和交互式 picker 渲染逻辑。
- `common/session-transcript.js`：共享的 transcript 规范化和预览条数限制逻辑。
- `common/provider-runner.js`：共享的 provider CLI 运行流程，覆盖 JSON、picker 和非 TTY prompt 模式。
- `*.test.js`：基于 Node test 的 provider 行为和安装器行为测试。
- `install.sh` 和 `install.ps1`：安装 alias/function 的脚本。

## 设计说明

- Claude、Codex 和 OpenCode 保持独立入口文件，避免不同 provider 的存储格式和启动参数互相影响。
- 通用 picker 行为放在 `common/session-utils.js` 和 `common/session-renderer.js`；各 provider CLI 复用它们并传入自己的标题。
- permission mode 按 provider 分别持久化到 `~/.agent-session`。
- OpenCode full permission 通过 `OPENCODE_PERMISSION="allow"` 传入，因为 OpenCode TUI 当前没有对应的命令行 flag。

## 开发

```bash
npm test
npm run check
```

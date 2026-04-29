# Claude Code、Codex 与 OpenCode Session Picker

中文 | [English](README.md)

Claude Code、Codex 与 OpenCode 的 session 交互式选择器。原有 Claude Code 选择器继续使用 `cc`，Codex 使用 `cx`，OpenCode 使用 `oc`。

## 功能

- 列出当前目录的 Claude Code sessions。
- 列出当前目录的 Codex sessions。
- 列出当前目录的 OpenCode sessions。
- 新建 session 或恢复已有 session。
- 支持交互式搜索。
- 支持上下方向键移动选择。
- 显示短 session ID、相对更新时间、消息数量、首条 user 消息和最后一条 user 消息。
- 支持 permission mode 切换。
- 自动记住上次选择的权限模式。
- 右方向键进入 Claude Code 工作区选择模式。
- 使用相同交互方式浏览 Codex sessions 和工作区。
- 使用相同交互方式浏览 OpenCode sessions 和工作区。

## 依赖

- Node.js。
- `cc` 需要 Claude Code CLI。
- `cx` 需要 Codex CLI。
- `oc` 需要 OpenCode CLI 和 `sqlite3`。

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

安装脚本会检查 `node` 和 `claude` 是否可用；如果 `codex`、`opencode` 或 `sqlite3` 不在 PATH 中会给出警告。OpenCode session 浏览会通过 `sqlite3` 读取 OpenCode 的 SQLite 数据库。脚本会把 Claude 选择器复制到 `~/.claude-code-session`，把 Codex 选择器复制到 `~/.codex-code-session`，把 OpenCode 选择器复制到 `~/.opencode-code-session`，在适用的平台设置可执行权限，并把 `cc`、`cx` 和 `oc` 添加到对应 shell profile。

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
- 回车打开选中的项目。
- `Tab` 切换权限模式。
- 右方向键进入工作区选择。
- 左方向键返回 session 列表。
- `Esc` 或 `Ctrl-C` 取消。

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
~/.claude-code-session/config.json
```

Codex 权限模式会自动记住，配置保存到：

```bash
~/.codex-code-session/config.json
```

OpenCode 权限模式会自动记住，配置保存到：

```bash
~/.opencode-code-session/config.json
```

## CLI

```bash
node claude-sessions.js [--json | --pick] [--cwd <path>] [--claude-home <path>]
node codex-sessions.js [--json | --pick] [--cwd <path>] [--codex-home <path>]
node opencode-sessions.js [--json | --pick] [--cwd <path>] [--opencode-data-home <path>]
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

- `claude-sessions.js`：Claude Code session CLI。
- `codex-sessions.js`：Codex session CLI。
- `opencode-sessions.js`：OpenCode session CLI，通过 `sqlite3` 读取 `opencode.db`。
- `session-utils.js`：共享的配置、JSONL、进程启动、工作区过滤和交互式 picker 辅助逻辑。
- `*.test.js`：基于 Node test 的 provider 行为和安装器行为测试。
- `install.sh` 和 `install.ps1`：安装 alias/function 的脚本。

## 开发

```bash
npm test
npm run check
```

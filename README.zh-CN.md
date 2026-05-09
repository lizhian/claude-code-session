# Agent Session

中文 | [English](README.md)

Claude Code、Codex 与 OpenCode 的 session 交互式选择器。单个二进制文件，零运行时依赖。

- `cc` — Claude Code sessions
- `cx` — Codex sessions
- `oc` — OpenCode sessions

## 功能

- 列出当前目录的 Claude Code、Codex、OpenCode sessions。
- 新建 session 或恢复已有 session。
- 交互式搜索，固定显示状态行。
- 上下方向键移动选择。
- 显示短 session ID、相对更新时间、消息数量、首条/末条 user 消息。
- `Tab` 切换权限模式，自动记住上次选择。
- 右方向键浏览工作区。
- 配置 model provider、默认模型等。
- 单二进制 + 符号链接分发：`cc`/`cx`/`oc` → `agent-session`。
- 零运行时依赖 — 无需 Node.js、sqlite3、Go。

## 安装

macOS/Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/lizhian/agent-session/main/install.sh | sh
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/lizhian/agent-session/main/install.ps1 | iex
```

安装脚本从 GitHub Releases 下载预编译二进制，创建 `cc`/`cx`/`oc` 符号链接（Windows 使用硬链接），并将安装目录加入 PATH。

安装后重新加载 shell：

```bash
source ~/.zshrc    # 或 source ~/.bashrc
```

Windows 下重启 PowerShell 或执行：

```powershell
. $PROFILE
```

## 使用

```bash
cc              # Claude Code sessions
cx              # Codex sessions
oc              # OpenCode sessions
```

交互快捷键：

- 输入文字搜索。
- 上下方向键移动选择。
- 回车打开选中的 session 或 workspace。
- `Tab` 切换权限模式。
- 右方向键进入工作区选择。
- 左方向键返回上一层。
- `Esc` 或 `Ctrl-C` 取消。

选择器编号从 `0` 开始：`0` 新建 session，`1+` 恢复已有 session。

权限模式：

| 模式   | Claude                                          | Codex                                               | OpenCode                          |
|--------|-------------------------------------------------|-----------------------------------------------------|-----------------------------------|
| 默认   | `claude`                                        | `codex`                                             | `opencode`                        |
| 自动   | `claude --enable-auto-mode`                     | `codex --full-auto`                                 | —                                 |
| 完全   | `claude --dangerously-skip-permissions`         | `codex --dangerously-bypass-approvals-and-sandbox`  | `OPENCODE_PERMISSION="allow"`     |

## CLI

```bash
cc [--json | --pick] [--cwd <path>] [--claude-home <path>]
cx [--json | --pick] [--cwd <path>] [--codex-home <path>]
oc [--json | --pick] [--cwd <path>] [--opencode-data-home <path>]
```

参数：

- `--json`：输出 JSON，方便脚本处理。
- `--pick`：打开交互式选择器。
- `--trust-current-folder`：标记当前目录为已信任。
- `--cwd <path>`：查看指定目录的 sessions。
- `--claude-home <path>`：Claude 配置目录（默认 `~/.claude`）。
- `--codex-home <path>`：Codex 配置目录（默认 `~/.codex`）。
- `--opencode-data-home <path>`：OpenCode 数据目录（默认 `~/.local/share/opencode`）。

## 项目结构

```
cmd/agent-session/main.go     # 二进制入口，符号链接分发
internal/
  provider/                   # Provider 接口
  claude/                     # Claude Code provider（JSONL, settings.json）
  codex/                      # Codex provider（JSONL, config.toml, thread 同步）
  opencode/                   # OpenCode provider（SQLite, JSONC 配置）
  picker/                     # bubbletea TUI，6 视图状态机
  render/                     # ANSI、CJK 宽度、格式化
  session/                    # JSONL 解析、配置、权限、运行器、transcript
```

## 开发

```bash
go test ./...
go vet ./...
go build -ldflags="-s -w" -o agent-session ./cmd/agent-session/
```

## 发布

推送 tag 触发 CI 构建：

```bash
git tag v0.0.1
git push origin --tags
```

GitHub Actions 自动交叉编译 darwin-arm64、darwin-amd64、linux-amd64、linux-arm64、windows-amd64，创建 Release 并附带二进制和 checksums。

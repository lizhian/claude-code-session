# Claude Code 与 Codex Session Picker

中文 | [English](README.md)

Claude Code 与 Codex 的 session 交互式选择器。原有 Claude Code 选择器继续使用 `cc`，新增 Codex 选择器使用 `cx`。

## 功能

- 列出当前目录的 Claude Code sessions。
- 新建 session 或恢复已有 session。
- 支持交互式搜索。
- 支持上下方向键移动选择。
- 显示短 session ID、相对更新时间、消息数量、首条 user 消息和最后一条 user 消息。
- 支持普通模式和信任模式切换。
- 自动记住上次选择的启动模式。
- 右方向键进入 Claude Code 工作区选择模式。
- 使用相同交互方式浏览 Codex sessions 和工作区。

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

安装脚本会检查 `node` 和 `claude` 是否可用；如果 `codex` 不在 PATH 中会给出警告。脚本会把 Claude 选择器复制到 `~/.claude-code-session`，把 Codex 选择器复制到 `~/.codex-code-session`，在适用的平台设置可执行权限，并把 `cc` 和 `cx` 添加到对应 shell profile。

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

交互快捷键：

- 输入文字进行搜索。
- 上下方向键移动选择。
- 回车打开选中的项目。
- `Tab` 切换启动模式。
- 右方向键进入工作区选择。
- 左方向键返回 session 列表。
- `Esc` 或 `Ctrl-C` 取消。

启动模式：

- 普通模式：执行 `claude`。
- 信任模式：执行 `claude --dangerously-skip-permissions`。
- Codex 普通模式：执行 `codex`。
- Codex 信任模式：执行 `codex --dangerously-bypass-approvals-and-sandbox`。

Claude 启动模式会自动记住，配置保存到：

```bash
~/.claude-code-session/config.json
```

Codex 启动模式会自动记住，配置保存到：

```bash
~/.codex-code-session/config.json
```

## CLI

```bash
node claude-sessions.js [--json | --pick] [--cwd <path>] [--claude-home <path>]
node codex-sessions.js [--json | --pick] [--cwd <path>] [--codex-home <path>]
```

参数：

- `--json`：输出 JSON。
- `--pick`：打开交互式选择器。
- `--trust-current-folder`：在 Claude Code 配置中把当前目录标记为已信任。
- `--cwd <path>`：查看指定目录的 sessions。
- `--claude-home <path>`：指定 Claude home，默认使用 `~/.claude` 或 `CLAUDE_HOME`。
- `--codex-home <path>`：指定 Codex home，默认使用 `~/.codex` 或 `CODEX_HOME`。

## 测试

```bash
npm test
```

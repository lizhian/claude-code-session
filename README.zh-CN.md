# Claude Code Session Picker

中文 | [English](README.md)

一个 Claude Code session 交互式选择器，用来查看当前目录和已有 Claude Code 工作区的历史 session，并快速新建或恢复 session。

## 功能

- 列出当前目录的 Claude Code sessions。
- 新建 session 或恢复已有 session。
- 支持交互式搜索。
- 支持上下方向键移动选择。
- 显示短 session ID、相对更新时间、消息数量、首条 user 消息和最后一条 user 消息。
- 支持普通模式和信任模式切换。
- 自动记住上次选择的启动模式。
- 右方向键进入 Claude Code 工作区选择模式。

## 安装

克隆仓库后运行安装脚本：

```bash
./install.sh
```

安装脚本会检查 `node` 和 `claude` 是否可用，把选择器复制到 `~/.claude-code-session`，设置可执行权限，并在 `~/.zshrc` 或 `~/.bashrc` 中添加 `cc` 别名。

安装后重新加载 shell 配置：

```bash
source ~/.zshrc
```

如果你使用 Bash，则执行：

```bash
source ~/.bashrc
```

## 使用

```bash
cc
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

启动模式会自动记住，配置保存到：

```bash
~/.claude-code-session/config.json
```

## CLI

```bash
node claude-sessions.js [--json | --pick] [--cwd <path>] [--claude-home <path>]
```

参数：

- `--json`：输出 JSON。
- `--pick`：打开交互式选择器。
- `--trust-current-folder`：在 Claude Code 配置中把当前目录标记为已信任。
- `--cwd <path>`：查看指定目录的 sessions。
- `--claude-home <path>`：指定 Claude home，默认使用 `~/.claude` 或 `CLAUDE_HOME`。

## 测试

```bash
npm test
```

# 托盘与客户端安装引导

## 托盘快捷操作

- “启动 Claude / Codex（上次配置）”使用各自已保存的桌面版 / CLI、服务或密钥、工作目录，进入主窗口同一套配置校验和启动流程。启动结果和错误在主窗口输出中显示。
- “切换密钥…”按 Claude / Codex 打开对应服务选择器。选择后保存为该工具下次启动使用的服务，实际写入配置仍在启动流程中执行；不会在后台悄悄改写凭据。
- “最近项目目录”使用现有 `recentDirectories`，去重且最多 8 项。选择后先验证目录存在，再保存为 CLI 工作目录；不会同时启动客户端。没有历史记录时菜单禁用。
- 初次使用仍需在主窗口同意读取本机配置。应用版本被拦截时托盘不能绕过限制。安装本工具更新期间也不会执行托盘启动。
- 偏好保存、语言切换后更新原生菜单。目录菜单使用稳定标识，菜单重建不会把旧索引映射到另一目录。
- 窗口启动尚未就绪或正在操作时暂存最近一次快捷请求；重复点击合并，30 秒后失效，避免很久以后意外启动。

## 安装与版本检查

工具页提供“安装客户端…”或“安装 / 更新指引”。首次使用尚未读取本机配置时也能打开指引。

- Claude CLI：官方原生安装器，按 Windows PowerShell / macOS Terminal 展示可复制命令。[官方说明](https://code.claude.com/docs/en/setup)。
- Codex CLI：展示官方 npm 包 `@openai/codex` 的安装 / 更新命令，提示需要 Node.js 和 npm。[官方仓库](https://github.com/openai/codex)。
- 桌面版：打开 Claude / Codex 官方下载说明页面，不使用第三方下载站。
- 命令仅展示和复制，打开官方页面也不会自动执行安装。用户完成安装后点击“重新检测”；如果新 PATH 尚未被本进程继承，可重启工具或设置程序路径。
- 已找到 CLI 时，可点击“检查 CLI 版本”。检查当前实际选中的可执行文件（包括自定义路径），仅传 `--version`，本机探测限时 3 秒；再读取上游 GitHub 最新稳定 Release（限时 5 秒、响应上限 1 MiB）。不会在每次扫描时自动执行 CLI 或联网。
- 发现更高的稳定版本时给更新建议，不阻断客户端启动，也不把“较旧”误判成“不兼容”。断网或限流时保留本机版本并提供重试提示，不显示“已是最新”。代理选项沿用应用设置。

## 检查

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --all-targets --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

Windows 原生菜单集成测试为 `tray_native`；实际 CLI 版本探测可单独运行：

```bash
cargo run --manifest-path src-tauri/Cargo.toml --example client_versions --locked
```

该探测会运行已安装 CLI 的 `--version` 并读取公开版本信息，不安装或更新客户端。菜单测试使用隔离运行时，不修改已安装应用的托盘或偏好。

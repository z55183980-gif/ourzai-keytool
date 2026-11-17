# 启动兼容性检查（2026-11-16）

本次在 Windows x64 检查 main 工作区，未改用户密钥、未启动真实客户端会话。四个本机客户端通过 `launch_preflight`：Claude 桌面版、Claude CLI、Codex 桌面版、Codex CLI。Windows 交互终端测试使用自动退出的测试脚本。

## 链路

| 目标 | 发现与启动 | 验证边界 |
| --- | --- | --- |
| Windows Claude 桌面版 | 注册应用身份、旧版 exe、自定义 exe；Explorer 或直接启动 | 本机发现和命令预检通过，Explorer 激活失败仍可能由系统弹窗报告 |
| Windows Codex 桌面版 | OpenAI.Codex 包身份、桌面 exe、自定义 exe；排除捆绑 CLI | 同上，已注册包和仅已预配包不同，后者可能需重新登录 |
| Windows 两个 CLI | PATH、常见安装目录、自定义 exe/ps1/cmd/bat；系统 PowerShell 5.1 新交互窗口 | 本机版本预检、脚本引用、退出码和交互窗口测试通过，不依赖用户选择的 PowerShell 7 或 Windows Terminal |
| Mac 两个桌面版 | /Applications、~/Applications、自定义 .app；检查 Bundle ID；系统 open | 代码审查通过，尚未在 Mac 编译或实机启动 |
| Mac 两个 CLI | PATH、原生/Homebrew/npm/Volta/asdf 常见目录、自定义可执行文件；Terminal + bash | 引用与环境构造测试通过，自动化权限、Terminal 配置及真实 Node 环境需实机测试 |

## 本次修复

- Windows 应用枚举失败返回错误，避免误报未安装；CLI 和手动路径启动不依赖该枚举。
- CLI 启动前执行有时限的 `--version` 预检，缺 Node、脚本策略阻止和程序不兼容等错误在写配置前阻断；冷启动容许 15 秒。
- Mac 自定义桌面路径只接受对应身份的完整 .app，避免误选 ChatGPT 或另一客户端。
- Mac 通过固定 bash 处理工作目录和可执行文件引用，并补充常见 PATH；固定本工具实际写入的绝对配置目录，避免相对环境变量在换目录后偏移。
- 等待短时启动分发程序返回，传回系统权限或终端错误；不等待交互客户端退出。
- 写配置后复核密钥、模型和 Codex 思考深度，检测到外部覆盖则停止启动。
- 页面提示切换服务后须完全退出已运行的桌面客户端再启动，不自动终止用户进程。

## 仍需验收的环境

- Mac Apple Silicon / Intel、Windows ARM64；本次只有 Windows x64 运行证据。
- Mac 首次授权/拒绝自动化、Gatekeeper、损坏 .app、应用被移动、只读目录。
- nvm/fnm 等只在 shell 初始化脚本中定义的工具、别名/函数和自定义 npm prefix：自动发现不保证覆盖，需明确程序路径；npm 版本仍要求可用 Node。当前不会执行任意 shell 初始化脚本来采集 PATH。
- WSL 只有 Linux 侧安装时，Windows 原生入口不视为已安装；不自动同步 Windows 与 WSL 配置或认证。
- 企业组策略、AppLocker、杀毒软件拦截、网络盘断开、安装包架构不符：可能阻止系统启动，不能承诺全部自动恢复。
- 桌面客户端已经运行时，重新激活不等于重新加载密钥；本工具不强制结束客户端。
- Mac Terminal 的已有会话可持有与 GUI 不同的认证/代理环境。已固定配置目录，但仍需用户核对 shell 中的认证变量。
- 启动请求成功不等于登录、网络、模型权限或 API 请求成功；UI 保留“请在客户端确认”的表述。

## 验证命令

```text
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo test --manifest-path src-tauri/Cargo.toml --lib launcher::tests::windows_console_smoke -- --ignored --nocapture
cargo run --manifest-path src-tauri/Cargo.toml --example launch_preflight
```

前端 47 项测试通过；后端全量 142 项通过后，新增 CMD/BAT 退出码测试也通过；交互终端专项通过。macOS 仅脚本构造测试，无 Mac 编译或系统启动证据。

官方参考：[Claude Code 安装与系统要求](https://code.claude.com/docs/en/setup)、[OpenAI Windows 应用与 WSL 配置说明](https://learn.chatgpt.com/docs/app/windows)。

## 第二轮：运行脚本与设备差异

新增修复：

- 补充 Mac `NSAppleEventsUsageDescription` 和签名所需 Apple Events entitlement。仍由系统询问用户是否允许控制 Terminal，未绕过系统授权。两份 plist 已解析验证。
- Mac 动态命令改为 UTF-8 Base64 传递，外层只保留固定 ASCII shell 语法，避免 fish/zsh/bash 对路径中的反斜杠、引号和换行有不同解释。解码后由固定 bash 运行。
- npm symlink 指向版本管理器的 `lib/node_modules` 时，将对应且存在 Node 的 `bin` 加入子进程 PATH。
- Mac CPU 探测加超时；打开安装目录检查退出状态，不再把 spawn 成功视作打开成功。
- CPU 架构仅接受 x64/AMD64/x86_64 和 ARM64/aarch64。32 位 x86、未知架构明确拒绝，不再默认为 x64。Windows 环境中原生架构优先于模拟进程架构；Apple Silicon 上的 Rosetta 进程通过 sysctl 探测原生架构。
- Windows 提权启动仅在确实收到 1223 时提示取消授权，其他失败保留错误；后台部署进程隐藏窗口，UAC 仍由系统显示。

验证证据：

| 层级 | 已执行 | 不能据此保证 |
| --- | --- | --- |
| Windows 系统 PowerShell 5.1 | ps1/cmd/bat 引用、参数、错误码、MSIX 脚本语法 | 企业 AppLocker/组策略允许执行 |
| PowerShell 7.6.9 | 同一版本探测适配器执行 ps1/cmd/bat，中文/空格/引号/方括号路径 | 产品已切换默认终端到 PS7（默认仍是系统 5.1） |
| GNU Bash 5.3.15 | 真实解码执行，中文、引号、反斜杠、换行及 shell 元字符保持为数据 | Mac 自带 Bash 3.2、fish、zsh 和 AppleScript 已实机通过；GNU 测试仅将 BSD base64 -D 换成 -d |
| Windows x64 | 全目标测试、交互控制台专项、上一轮四客户端只读预检 | ARM64 原生设备、Win10/11 各个版本均已测试 |
| Mac 配置 | plist 解析、脚本构造、打包配置审查 | 已签名/公证 app 的 TCC 首次授权实测 |

本轮前端 47 项、中继 2 项通过。后端全目标扫描含库测试及托盘/更新器集成测试；最终库测试在架构处理修改后再次执行。Mac-only 的 npm symlink 测试已加入，需 Mac/Unix runner 执行。

发现的发布边界：发布工作流生成 Mac universal 包，但运行单元测试的 runner 仍是 Intel Mac；Windows 当前发布 x64 包。Mac 工作流允许缺签名证书时产出未签名包，这类包不应被当作已验证的普通用户安装包。本轮未运行远程 CI、未签名/发布、未修改真实客户端安装。

仍待实机验收：Apple Silicon 原生和 Rosetta、Intel Mac、Mac 首次拒绝/允许自动化、Windows ARM64 原生和 x64 模拟、标准用户 UAC 使用另一管理员账号、网络盘/UNC、极长路径、MDM/AppLocker、只在交互 shell 中定义的 nvm/fnm 环境。WSL 与远程 SSH 环境仍是独立配置域，当前不自动桥接。

参考：[Tauri macOS 打包与权限配置](https://v2.tauri.app/distribute/macos-application-bundle/)、[Apple Events entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.automation.apple-events)、[PowerShell Start-Process 参数规则](https://learn.microsoft.com/powershell/module/Microsoft.PowerShell.Management/Start-Process)。

# 密钥管理工具

给 zAI 开发者控制台用户的密钥管理与启动工具。首页分别提供 **Claude / Codex 桌面版与 CLI** 入口，密钥导入、模型配置和备份恢复放在次级页面。

## 启动页

- 分别检测四种程序；Windows 支持 PATH、常见安装目录及商店应用，macOS 支持 `/Applications` 和用户应用目录。可在设置中指定程序绝对路径。Linux 桌面程序需手动指定路径。
- CLI 在选择的项目目录中启动：Windows 使用独立 PowerShell 窗口，macOS 使用 Terminal，Linux 使用已安装的常见终端。
- 默认沿用当前配置。选择 zAI 密钥或官方服务后，先检查安装与工作目录，再通过已有备份/事务机制修改配置；检查失败则不启动。配置未变化时跳过重复写入。
- 桌面版与 CLI 一样可以选择 zAI 密钥或官方服务，启动前走同一套检查与写入流程（两者共用同一份用户级配置）。选择「沿用当前配置」时只打开程序，不读写配置。配置写入成功不代表桌面版实际使用了该服务：应用内已有的登录可能优先生效，需在应用内确认。
- 安装状态、配置状态、启动请求结果分别展示。成功发出启动请求不代表登录成功、API 可用或进程仍在运行。
- 启动偏好（程序路径、所选密钥的 ID、工作目录和最近项目）单独保存在 `~/.dbkey/launcher.json`，不包含密钥值。启动命令不携带密钥。
- CLI 读取的项目级配置与客户端自身认证仍可能覆盖用户级配置，应在终端中确认实际服务。Windows 的 npm PowerShell 启动脚本只对新终端进程设置执行策略，不修改系统策略。

## 技术栈

- Tauri 2 + React 19 + TypeScript + Vite
- `toml_edit` 结构化改写 config.toml（保留注释与格式）
- `serde_json` + `preserve_order` 合并式改写 auth.json
- `reqwest` + rustls（不依赖系统 OpenSSL）
- 密钥存系统密钥库（Windows DPAPI / macOS Keychain），每把各存一条

## 它写入什么

### Codex

默认走 **内置 openai provider** 这条路，也就是多年来手动配置通行的写法：

`~/.codex/config.toml`

```toml
model = "gpt-5.6-sol"
model_reasoning_effort = "medium"
openai_base_url = "https://api.ourzai.com/v1"
```

`~/.codex/auth.json`

```json
{ "OPENAI_API_KEY": "sk-..." }
```

`model_provider` 的默认值就是 `"openai"`，所以不写；只有当它被改成别的值时才纠正回来。改动越少越不容易出事。

默认兼容现有的内置 provider + 文件凭据配置。检测到需要保留的官方登录、非文件认证存储，或无法解析的 `auth.json` 时，改用独立 provider 的 Bearer Token 配置，不改原认证。不同客户端版本的认证能力仍需实机验证。

为兼容已安装版本，本地密钥库服务名、应用 identifier、二进制名称和 provider ID `starnexus` 保持不变；界面品牌和公开服务地址已更新为 zAI。

### Claude Code — `~/.claude/settings.json`

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.ourzai.com",
    "ANTHROPIC_AUTH_TOKEN": "sk-...",
    "ANTHROPIC_MODEL": "...",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "...",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "...",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "..."
  }
}
```

三个 `DEFAULT_*_MODEL` 别名必须写齐，否则用户执行 `/model opus` 时会解析到 Anthropic 官方的模型 ID，在网关上 404。

写入时还会清掉两个东西：

- `ANTHROPIC_SMALL_FAST_MODEL` —— 官方已标记废弃，由 `ANTHROPIC_DEFAULT_HAIKU_MODEL` 取代
- `ANTHROPIC_API_KEY` —— 它走 `x-api-key` 头，和 `ANTHROPIC_AUTH_TOKEN` 的 Bearer 冲突，只能留一个

### 两个工具的 base_url 不一样

同一个网关，地址却不同 —— 这是最容易踩的坑，所以由代码推导，不让用户手填：

| 工具 | base_url | 原因 |
|---|---|---|
| Codex | `https://api.ourzai.com/v1` | 它自己拼 `/responses` |
| Claude Code | `https://api.ourzai.com` | 它自己拼 `/v1/messages` |

## 多把密钥

用户常有多把 Key（主号 / 测试号 / 不同套餐），工具里各存一条，随时切换。可以手动粘贴，也可以用 zAI 的账号登录后批量导入 —— **登录态只在内存里，不落盘**，密码用完即丢。

## 三条不可违背的规则

**1. 解析不了就绝不写入。**
`config.toml` TOML 语法有误时停止写入，让用户手动修，或走「备份并重建最小配置」。绝不静默覆盖。

**2. 只合并，绝不覆盖。**
默认合并 Codex 的 API Key 并保留其他字段。仅在用户明确选择覆盖文件中的官方登录时，切换 `auth_mode` 并移除旧 `tokens` / `last_refresh`；非文件认证存储不做此操作。
Claude Code 的 `settings.json` 只动 `env` 里我们管的那几个键，`permissions`、`hooks`、`statusLine`、`theme`、顶层 `model` 一律保留。

**3. 只动自己的地盘。**
`[marketplaces.*]`、`[plugins.*]`、`notify`、用户注释 —— 一个字不动。

## 容错

- **原子替换**：同目录唯一临时文件 → 限制权限 → 写入并 fsync → rename。Windows 不再先删除目标文件
- **多文件提交**：全部改动先暂存；提交前检查文件是否被其他程序修改。后续写入失败会恢复已写入文件；恢复失败会明确报告。多文件操作不承诺断电后的整体原子性
- **自动备份**：仅备份本次会修改的文件，记录原路径及原本是否存在。使用唯一编号，保留最近 10 份
- **一键回滚**：恢复前必须成功备份当前状态；原本不存在的文件会删除。旧格式备份仅恢复其包含的文件，不推测缺失文件应被删除。配置目录改变时停止恢复
- **权限收紧**：Windows `icacls` 去继承，macOS `chmod 600`

## 兼容性处理

| 场景 | 处理 |
|---|---|
| `CODEX_HOME` / `CLAUDE_CONFIG_DIR` 被改过 | 优先读环境变量，不硬编码 `~/.codex` 和 `~/.claude` |
| `~/.codex` 不存在 | 自动创建并提示 |
| `config.toml` 语法错误 | 停止写入，提供重建选项 |
| `settings.json` 语法错误 | 停止写入，要求用户先修 JSON |
| 两个工具 base_url 不同 | 代码自动推导，用户只填一次 |
| 中文用户名 / 路径 | 全程 `PathBuf`，不拼字符串 |
| 多行字符串 | 检测到 `"""` / `'''` 时跳过空行清理，绝不改坏用户的值 |
| 官方 ChatGPT 登录 / 系统密钥库 | 默认保留并使用独立 Bearer Token 配置；界面不把本地记录视为有效会话 |
| Win10 无 WebView2 | 打包时 `embedBootstrapper` 自动安装 |

## 品牌与服务地址

资料来源：同级 `ourzai-site/src/links.ts`、`src/console/session.ts`、`src/console/api.ts` 和 `public/brand/`。

- 开发者控制台：`https://ourzai.com/console`
- 模型 API：`https://api.ourzai.com/v1`（Claude 配置使用去掉 `/v1` 的根地址）
- 统一身份中心：`https://account.ourzai.com`，登录使用 `/idp/login`，会话令牌使用 `/idp/token`
- 密钥列表：`https://zai-api.ourzai.com/me/developer/keys`；完整密钥只在 Rust 后端处理
- 导入关联使用「服务来源 + 账号 ID + 密钥 ID」，不会把旧网关或另一个账号的同编号密钥直接覆盖
- 已停止请求旧网关的 `/api/dbkey/config`；新控制台没有对应接口，当前使用随应用发布的默认配置
- Logo 直接复用开发者控制台的 `zai-wordmark.png` / `zai-mark-192.png`，安装图标由 Tauri icon 命令生成

## 状态与密钥保存

系统密钥库不可用、写入失败或回读校验失败时明确报错。密钥写入后若元数据保存失败，会尝试恢复原密钥；损坏的本地列表不会被当成空列表覆盖。

界面中的「已配置」只代表用户配置文件里的服务地址、所选 provider 与凭据匹配本地密钥。客户端运行状态、有效登录、项目层配置和实际请求均未验证。遇到独立认证存储、其他认证来源或当前进程环境变量时显示无法确认，不冒充「已启用」。

## 开发

Windows 需要 Rust + MSVC 生成工具 + Windows SDK；macOS 需要 Xcode Command Line Tools。

```bash
npm install
npm run tauri dev
```

跑测试：

```bash
cd src-tauri && cargo test --all-targets
```

测试样本取自真实用户的 `config.toml`（含 `[plugins.*]`、`[marketplaces.*]`、手改的 model、旧脚本累积的空行），锁住「不破坏用户配置」这条底线。其中几条是事故回归测试，专门盯着上面说的那几个认证坑。

对着**本机真实配置**做一次干跑（只在内存里算，不落盘）：

```bash
cd src-tauri && cargo run --example dryrun
```

它会报告段落/键的增减、注释是否保留、是否幂等 —— 改动写入逻辑后应该先跑它。

## 出包

Windows 包可以本地打：

```bash
npm run tauri build
```

macOS 包**只能由 macOS 出**（编译要 Apple SDK，打 DMG 要 `hdiutil`，签名要 `codesign`），所以走 GitHub Actions。推一个 `v*` tag 触发，或在 Actions 页面手动运行：

```bash
git tag v0.1.0 && git push origin v0.1.0
```

流水线定义在 [.github/workflows/release.yml](.github/workflows/release.yml)，macOS 出通用包（Intel + Apple Silicon），Windows 出 NSIS / MSI / 免安装三种。

签名是可选的：配了 `APPLE_CERTIFICATE` 等 secret 就签名并公证，没配就产出未签名包。**未签名的 Mac 包只够自己测** —— 用户下载后会被 Gatekeeper 判为「已损坏」，macOS 15 之后连右键绕过都不行了。

## 尚未完成

- 代码签名与 macOS 公证（需要 Apple Developer Program）
- `tauri-plugin-updater` 自动更新
- 真实账号联调：新身份中心的登录、验证码、会话续期与密钥导入；当前已按控制台源码契约适配，自动化测试不调用真实账号
- macOS 实机回归；当前主机验证 Windows 文件替换及回滚

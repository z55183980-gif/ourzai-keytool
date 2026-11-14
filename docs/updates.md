# 自动更新与最低版本

## 客户端行为

- 启动时先检查版本策略；每 6 小时和设置中的“检查更新”会再次检查。
- 正常升级提供提示，用户点击“下载、安装并重启”后才下载和安装，不静默打断工作。
- 当前版本低于 `min_client_version` 时显示不可跳过的升级页。应用配置、模型请求、密钥操作和启动客户端的后端入口也检查版本，避免仅在界面隐藏按钮。
- 策略来自 `https://raw.githubusercontent.com/z55183980-gif/ourzai-keytool/main/updates/config.json`，不使用已停用的网关配置接口。请求超时 5 秒，配置大小上限 64 KiB。
- 成功校验的策略原子写入 `~/.dbkey/update-policy.json`。网络失败沿用最近有效策略，已收到的最低版本限制不会因断网而解除。首次启动、从未取得有效策略时使用内置默认值，允许正常使用并提示检查失败。客户端拦截不能替代网关自己的兼容性检查。
- 最低版本使用 SemVer 比较；空字符串代表明确取消最低版本限制。缺少字段、格式错误、非成功状态码不会覆盖有效策略。仅配置最低版本时，其余字段保留内置默认值。
- 更新清单检查超时 8 秒，包下载超时 180 秒，可重试。检查和下载支持“不走系统代理”；强制升级页也提供该选项。
- 包经过 Tauri updater 签名校验才可安装；手动下载按钮始终指向本仓库 Release。更新版本必须高于本机版本并满足最低版本要求。
- Windows 安装版按 NSIS / MSI 格式升级。Windows 便携版通过 NSIS 安装为安装版，不原地覆盖旧便携文件；后续使用已安装的应用。macOS 使用通用 `.app.tar.gz` 更新。

## 签名配置（首次发布前）

更新签名独立于 Apple Developer ID、公证和 Windows Authenticode。项目只保存公钥，私钥不入库。

1. 将与 `src-tauri/tauri.conf.json` 中 updater 公钥配对的私钥内容配置为本仓库 Actions secret `TAURI_SIGNING_PRIVATE_KEY`。
2. 若私钥有密码，另设 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；无密码则留空。妥善备份私钥，后续版本持续使用同一密钥。直接换公钥会导致已有客户端无法验证新包。
3. 本地打包时将 `TAURI_SIGNING_PRIVATE_KEY` 设为私钥文件路径或私钥内容，再运行 `npm run tauri build`。开发和测试无需生产私钥。

缺少更新签名私钥时发布构建会明确失败。打包后使用 `verify_update` 校验每个包与仓库公钥匹配，再汇总两端产物生成 `latest.json`，避免发布不完整或签错密钥的更新。

## 发布顺序

1. 审核代码并合并到 main，让 `updates/config.json` 可通过 GitHub Raw 访问。不要提前提高最低版本。
2. 将 `package.json` / `package-lock.json`、`src-tauri/Cargo.toml` / `Cargo.lock`、`src-tauri/tauri.conf.json` 的版本同步递增为未发布版本，运行前端与 Rust 回归。
3. 配置签名 secrets，推送对应 `v<版本>` 标签。两个平台完成后，工作流生成一个草稿 Release，附带 Windows EXE / MSI 及签名、macOS `.app.tar.gz` 及签名，以及完整 `latest.json`。
4. 核验两端安装包、签名与真实安装升级后，公开稳定版 Release（不能是 draft / prerelease）。清单使用版本固定的下载 URL；应用从 `releases/latest/download/latest.json` 检查。
5. 确认公开更新能被客户端取得，再独立提交 `updates/config.json` 提高最低版本。紧急解除限制可将其设为空字符串或降低到已验证兼容的版本，用户需联网重试检查。

现有 v0.2.6 及更早已发布程序没有 updater，无法通过此次代码改动直接收到更新；这些用户需要先手动安装一次包含本功能的新版本。首个自动更新版本发布后，再发布一个更高版本才能验证完整线上自动升级链路。

不要覆盖已发布的旧版本标签或复用旧版本号。手动触发工作流只生成 artifacts，不创建 Release，也不会更新线上清单。GitHub Raw / Releases 不可用时用户可重试或调整代理；离线不能获得尚未收到的最低版本声明。

## 验证

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --all-targets --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

`updater_download` 使用本地 HTTP 服务与独立的公开测试签名，运行真实插件的清单、下载和签名验证；覆盖有效包、被篡改的包、204 和 404，不执行安装器，不接触生产私钥。仅测试允许本地 HTTP；产品端使用 HTTPS。

开发界面预览：`?mock=configured&update=required` 为强制升级，`?mock=configured&update=available` 为可选升级。预览模式不会安装更新。

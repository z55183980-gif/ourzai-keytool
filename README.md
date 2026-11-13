# zAI Key Manager · 密钥管理工具

为 zAI 用户提供的桌面密钥管理与启动工具。集中管理 API 密钥，选择模型，配置并启动 Claude / Codex 的桌面版或 CLI。

[下载安装](https://ourzai.com/tools/key-manager) · [使用指南](https://docs.ourzai.com/api/tools/key-tool) · [版本发布](https://github.com/z55183980-gif/ourzai-keytool/releases)

## 下载

当前版本：**v0.2.6**。

| 系统 | 安装包 | 说明 |
| --- | --- | --- |
| Windows x64 | [EXE 安装包](https://github.com/z55183980-gif/ourzai-keytool/releases/download/v0.2.6/zAI-Key-Manager_Windows_x64-setup.exe) | 未做 Windows 代码签名 |
| macOS 12+ | [DMG 安装包](https://github.com/z55183980-gif/ourzai-keytool/releases/download/v0.2.6/zAI-Key-Manager_macOS.dmg) | Intel / Apple Silicon 通用版，已签名、公证 |

Claude 与 Codex 客户端需单独安装。更多安装格式及 SHA-256 校验文件见 [v0.2.6 Release](https://github.com/z55183980-gif/ourzai-keytool/releases/tag/v0.2.6)。

## 功能

- 登录 zAI 账号导入密钥，或手动添加密钥。
- 为 Claude / Codex 的桌面版和 CLI 选择密钥、服务与模型。
- 检查安装和配置状态；修改配置前备份，支持回滚。
- 密钥保存在系统密钥库，启动命令不携带密钥。

选择“沿用当前配置”时直接打开客户端。客户端自身登录和项目级设置仍可能影响实际使用的服务。

## 开发

技术栈：Tauri 2、React、TypeScript、Rust。Windows 需要 MSVC 与 Windows SDK；macOS 需要 Xcode Command Line Tools。

```bash
npm ci
npm run tauri dev
```

仅预览界面可运行 `npm run dev`。检查与测试：

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
```

## 仓库与发布

本仓库独立维护 zAI 客户端，源码、GitHub Actions、签名配置和 Release 均归属 `z55183980-gif/ourzai-keytool`。构建不检出其他产品仓库，也不触发其他产品发布。

[发布工作流](.github/workflows/release.yml)在 Windows / macOS runner 上打包。手动运行仅生成构建产物；推送新的 `v*` 标签会创建草稿 Release，核验安装包后再公开发布。

应用标识、系统密钥库和本地数据目录涉及已安装版本的升级兼容。维护时请先阅读[兼容与发布说明](docs/maintenance.md)。

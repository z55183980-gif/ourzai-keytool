# zAI Key Manager 维护说明

## 仓库边界

- 源码与构建仓库：`z55183980-gif/ourzai-keytool`。
- `zAI Key Manager Release` 工作流文件为 `.github/workflows/release.yml`，仅允许在本仓库运行。
- 工作流检出当前提交，使用本仓库的 Actions secrets，将构建产物和草稿 Release 写入本仓库。
- zAI 官网与文档站另有部署流程；打包工具本身不会触发网站或其他产品的发布。

## 已发布版本的兼容标识

下列名称已经用于 v0.2.6 及之前版本。它们是本应用的兼容接口，不构成外部仓库依赖：

| 用途 | 当前值 |
| --- | --- |
| 应用标识 / 系统密钥库服务名 | `com.starnexus.dbkey` |
| 程序文件名 | `starnexus-api` |
| Rust crate / library | `dbkey` / `dbkey_lib` |
| 密钥元数据和启动偏好目录 | `~/.dbkey/` |
| Codex 配置备份目录 | `CODEX_HOME/.dbkey-backups/` |
| Codex 自定义 provider ID | `starnexus` |
| zAI 登录回调协议 | `com.ourzai.launcher` |

仅修改这些名称会使升级后的应用无法读取原密钥或偏好，或生成重复安装。若需改名，应先实现数据迁移、升级路径和回滚验证，再发布新版本。仓库展示名称和 npm 工程名可以独立调整。

应用不读取其他产品的数据目录、不注册其他产品的登录协议。Windows 安装钩子只匹配旧版 `zAI Key Manager` 的卸载记录。

Claude / Codex 自身的用户配置属于这些客户端的共享资源。用户主动应用密钥或切换服务时，本工具会修改相应客户端配置并提前备份；两个管理工具不应同时改写同一个客户端的配置。

## 发布核验

1. 同步 npm、Tauri 和 Cargo 版本，运行前端与 Rust 测试。
2. 在本仓库推送新版本标签，等待 Windows 与 macOS 构建完成。
3. 核对包内版本、SHA-256、macOS Developer ID 签名与 Apple 公证结果。
4. 公开草稿 Release，再同步官网和文档站的下载链接。

Windows 签名取决于本仓库是否配置 Azure 签名凭据；当前公开的 v0.2.6 Windows 安装包未签名。

历史提交和已发布标签保留原始记录。GitHub 文件列表显示的是该路径最近一次提交的说明，历史名称不代表仓库之间存在关联；不为修改展示文案重写已发布历史。

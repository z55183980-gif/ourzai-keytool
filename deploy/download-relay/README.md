# 客户端安装下载中继

应用内的 Claude / Codex 桌面版与 CLI 共用 `client_download.rs`。每个资源先访问官方 HTTPS 地址；连接失败、非成功状态、下载中断、8 秒无数据，或连续 15 秒平均低于 64 KiB/s 时，自动重新从 VPS001 下载。中继失败后停止并提示重试，不无限循环。页面只有一个安装按钮，不提供网络模式选择。

## 安装行为

| 客户端 | Windows x64 / ARM64 | macOS Intel / Apple Silicon |
| --- | --- | --- |
| Claude CLI | 官方原生二进制，校验官方 manifest SHA-256 | 官方原生二进制，校验官方 manifest SHA-256 |
| Codex CLI | GitHub 官方 release ZIP，校验 release SHA-256 | GitHub 官方 release tar.gz，校验 release SHA-256 |
| Claude 桌面版 | 官方 MSIX，校验签名、身份、架构与系统版本，获管理员批准后按官方方式部署 | Homebrew cask 元数据定位官方 ZIP，校验 SHA-256 与 Gatekeeper 后打开文件夹；用户拖入 Applications |
| Codex 桌面版 | 官方离线 MSIX + ChatGPT-License.xml，校验后获管理员批准部署 | 官方 appcast 定位完整版本 ZIP，校验 Bundle ID、版本与 Gatekeeper 后打开；目前仅 Apple Silicon，Intel 显示不支持提示 |

四个客户端共用版本解析与安装来源。打开管理窗口自动检查；已安装时只有确认存在较新版本才显示“更新至”按钮，同版或更高版本显示无需更新。检查失败保留本机版本并允许重试，不允许盲目覆盖。下载前和实际安装前再次读取本机版本，拒绝同版和降级；CLI 安装后重新检测实际版本，桌面版未完成系统注册前显示待检测状态。Windows 版本查询通过有限 Range 请求读取 MSIX 的 ZIP/ZIP64 目录与清单，不下载整个安装包；分段响应须匹配请求范围与长度。Mac 读取官方 appcast 或 cask 的版本并核对下载包内的版本。

CLI 安装于当前用户 `.dbkey/clients/<唯一编号>/`，验证 `--version` 成功后才更新本工具的启动路径；不要求 npm，不修改系统 PATH，不覆盖已有全局安装。手动命令折叠区仍提供 PowerShell 5.1 / 7+、CMD、zsh / bash 的官方命令；手动命令不经过中继。

Windows 桌面版使用系统 Windows PowerShell 5.1 和官方 `Add-AppxProvisionedPackage` 流程，需要 UAC 管理员批准，并向此电脑部署客户端；页面在点击前说明。系统安装结束后提示保存工作、重新登录 Windows 后检测，不把仅完成下载或启动进程当作安装成功。Codex Store 包的签名主体是 GUID，按有效签名和精确的包身份验证，不能通过 OpenAI/Microsoft 字样判断。Claude 的完整 MSIX 含 Cowork 服务，不能当作无管理员权限的普通应用安装。

脚本内再次锁定并校验包，校验失败不部署；取消 UAC 或系统部署失败返回错误和结果记录。脚本不修改执行策略、不关闭运行中的客户端、不卸载旧版或自动重启。桌面版仍遵循系统权限、组件与签名要求；系统安装可能需要额外依赖。本中继不代理操作系统、客户端后续自更新、登录或 API 请求。

单文件最多 2 GiB、单次传输最多 30 分钟。CLI 压缩包拒绝越界路径和符号链接，并限制展开大小。下载失败和 CLI 安装失败清除本次目录；已进入桌面安装阶段的文件与结果记录保留，避免系统进程仍使用它们时删除。成功的目录保留用于启动或排障。

## 已部署入口

- SSH：本机 `~/.ssh/config` 的 `ourzai-prod`，主机名 VPS001。
- HTTPS：`https://ourzai.com/keytool-download/v1/`
- 健康检查：`GET /health`。
- 下载：`GET /fetch?url=<官方 URL 的无填充 base64url>`。
- Python 服务：`127.0.0.1:18942`，systemd 单元 `ourzai-download-relay.service`。
- 程序：`/opt/ourzai-download-relay/relay.py`，以 `www-data` 运行。

只接受代码中列出的供应商主机与资源路径，逐跳校验重定向；不转发客户端 Cookie 或 Authorization，不接收脚本命令。最多 12 个并发下载，超出返回 503。流式转发、不落盘缓存，访问日志关闭以避免记录带签名的上游 URL。HTTPS 由现有 nginx / Cloudflare 链路提供。

nginx 配置由相邻 `platform` 项目管理：

- `environments/ourzai-staging/host.toml` 添加 `keytool_download_relay = 18942`。
- `nginx/sites/ourzai.com.conf` 添加 `/keytool-download/v1/` location（去掉此前缀后转发本地服务，关闭缓冲与临时文件，限制 GET，移除认证头）。
- 通过 `python bin/platform-remote ourzai-staging nginx apply` 部署；不要直接修改在线生成配置。

## 更新与排障

先在本地运行 `python -B -m unittest discover -s deploy/download-relay -p 'test_*.py'`。将 `relay.py` 与 service 文件上传临时目录，再使用 `sudo install` 更新以上固定服务路径，执行 `sudo systemctl daemon-reload`、`sudo systemctl restart ourzai-download-relay`。

检查 `systemctl status ourzai-download-relay`、`journalctl -u ourzai-download-relay` 和 HTTPS `/health`。修改来源白名单时同时更新 Rust 与 Python 的规则及测试。验证大文件可使用 `Range: bytes=0-1023`，无需完整下载或执行安装器。

回滚：还原 platform 中的 location 和端口配置并运行受管 nginx apply，然后停止中继服务。应用仍会首先尝试官方直连，直连不可用时提示重试。

前端预览 `?mock=configured&setup=missing` 模拟安装状态和进度，不执行真实安装。真实下载和系统安装行为须使用 Tauri 桌面运行环境。

更新状态预览使用 `?mock=configured&update=current`、`update=available` 或 `update=error`，分别验证已最新、有更新与查询失败。运行 `cargo run --manifest-path src-tauri/Cargo.toml --example client_versions` 可只读核对四个客户端的本机和上游版本。

2026-11-16 本机实测：Codex CLI 已从 0.167.0 更新至 0.169.0，与官方稳定版一致；Claude CLI 2.1.322 可更新至 2.1.325；Claude 桌面版 5.11492.5.0、Codex 桌面版 26.1111.2228.0 均与当前官方 Windows 安装包一致。检查过程没有重新安装任何客户端。前端 46 项、Rust 140 项测试通过，额外的两个桌面版在线元数据探测通过。macOS 路径已做代码与解析测试，系统安装仍需 Mac 实机验收。

## 桌面链路验证（2026-11-16）

- Windows x64 两个官方 MSIX 均完整下载，Claude 299,362,172 字节、Codex 1,057,802,768 字节。
- 只读校验脚本确认签名有效、身份分别为 `Claude` / `OpenAI.Codex`、架构 x64、两个包要求 Windows 10.0.19041.0 及以上。
- Claude 整包经 VPS001 再次传输，与官方直连文件 SHA-256 完全一致：`4625eaa902e05c81d35d247423ae24a2a1c30e60cae9b355c07264998a89e453`。
- Codex 离线许可证的直连与中继均返回完整 XML。
- Mac Claude 官方 ZIP 根目录确有 `Claude.app`，Bundle ID 为 `com.anthropic.claudefordesktop`，最低 macOS 13.0。Mac Codex DMG 此前已验证中继分段下载。
- 此轮未运行真实系统安装、未触发 UAC、未改动已安装客户端；macOS 的 Gatekeeper 与安装结束后的检测仍需实机验证。

官方依据：[Claude Windows 部署](https://support.claude.com/en/articles/12622703-deploy-claude-desktop-for-windows)、[Codex Windows 离线部署](https://learn.chatgpt.com/docs/enterprise/windows-deployment)、[Claude macOS 部署](https://support.claude.com/en/articles/12611117-deploy-claude-desktop-for-macos)。

// Source: ourzai-site/src/links.ts and console/{session,api}.ts.
pub const SITE: &str = "https://ourzai.com";
pub const ACCOUNT: &str = "https://account.ourzai.com";
pub const DEVELOPER_API: &str = "https://zai-api.ourzai.com";
pub const MODEL_API: &str = "https://api.ourzai.com/v1";
pub const CLIENT_CONFIG: &str = "https://raw.githubusercontent.com/z55183980-gif/ourzai-keytool/main/updates/config.json";
pub const RELEASES: &str = "https://github.com/z55183980-gif/ourzai-keytool/releases/latest";

// 浏览器登录（授权码 + PKCE）用的桌面客户端。必须与身份中心登记的一字不差：
// 回调地址在授权和换票两处都是整串精确匹配（zai 仓 backend/oidc/clients.py）。
pub const DESKTOP_CLIENT_ID: &str = "zai-desktop";
pub const DESKTOP_SCHEME: &str = "com.ourzai.launcher";
pub const DESKTOP_REDIRECT_URI: &str = "com.ourzai.launcher://auth/callback";

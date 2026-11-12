//! zAI developer-console integration. Identity cookies, access tokens and keys
//! fetched for import stay in backend memory; no account session is persisted.
use crate::brand;
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub struct Session {
    client: reqwest::Client,
    user: Mutex<Option<Identity>>,
    /// 浏览器登录拿到的刷新令牌。有它就不走 Cookie：每次用它换一枚新的访问令牌。只在内存里。
    bearer: Mutex<Option<String>>,
    requests: tokio::sync::Mutex<()>,
}

/// `/auth/oidc/exchange` 与 `/auth/refresh` 的响应（zai 仓 backend/auth.py 的 AuthOut）。
#[derive(Deserialize)]
struct AuthOut {
    user_id: String,
    #[serde(default)]
    account: String,
    #[serde(default)]
    display_name: String,
    access_token: String,
    refresh_token: String,
}

#[derive(Clone, Deserialize)]
struct Identity {
    user_id: String,
    #[serde(default)]
    account: String,
    #[serde(default)]
    display_name: String,
}
impl Identity {
    fn name(&self) -> String {
        if self.display_name.is_empty() {
            self.account.clone()
        } else {
            self.display_name.clone()
        }
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    user: Identity,
}

impl Session {
    pub fn new(ignore_proxy: bool) -> Result<Self> {
        let mut builder = reqwest::Client::builder()
            .cookie_store(true)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(25))
            .connect_timeout(Duration::from_secs(10))
            .user_agent(concat!("zAI-Key-Manager/", env!("CARGO_PKG_VERSION")));
        if ignore_proxy {
            builder = builder.no_proxy();
        }
        Ok(Self {
            client: builder
                .build()
                .map_err(|e| AppError::Network(e.to_string()))?,
            user: Mutex::new(None),
            bearer: Mutex::new(None),
            requests: tokio::sync::Mutex::new(()),
        })
    }
    pub fn current_user(&self) -> Option<String> {
        self.user.lock().ok()?.as_ref().map(Identity::name)
    }
    pub fn account_scope(&self) -> Result<String> {
        self.user
            .lock()
            .map_err(|_| AppError::Other("内部状态异常".into()))?
            .as_ref()
            .map(|u| format!("{}|{}", brand::DEVELOPER_API, u.user_id))
            .ok_or_else(|| AppError::Other("请先登录 zAI 账号".into()))
    }
    async fn token(&self) -> Result<TokenResponse> {
        let refresh = self.bearer.lock().ok().and_then(|held| held.clone());
        if let Some(refresh_token) = refresh {
            return self.refresh_bearer(&refresh_token).await;
        }
        let response = self
            .client
            .post(format!("{}/idp/token", brand::ACCOUNT))
            .header("Origin", brand::SITE)
            .send()
            .await
            .map_err(network)?;
        decode(response, "获取登录会话失败，请重新登录").await
    }

    /// 浏览器登录的会话：用刷新令牌换新的访问令牌，并记下轮换后的刷新令牌。
    async fn refresh_bearer(&self, refresh_token: &str) -> Result<TokenResponse> {
        let response = self
            .client
            .post(format!("{}/auth/refresh", brand::DEVELOPER_API))
            .json(&serde_json::json!({ "refresh_token": refresh_token }))
            .send()
            .await
            .map_err(network)?;
        let out: AuthOut = decode(response, "登录已过期，请重新登录").await?;
        Ok(self.adopt(out))
    }

    fn adopt(&self, out: AuthOut) -> TokenResponse {
        if let Ok(mut held) = self.bearer.lock() {
            *held = Some(out.refresh_token);
        }
        TokenResponse {
            access_token: out.access_token,
            user: Identity {
                user_id: out.user_id,
                account: out.account,
                display_name: out.display_name,
            },
        }
    }
}

// ——————————— 浏览器登录（授权码 + PKCE，自定义协议回调） ———————————
//
// 流程同 Zai 手机应用（zai 仓 `zai-mobile` 客户端）：系统浏览器打开身份中心的 /idp/authorize，
// 用户在那里登录（Apple、Google、邮箱码、密码，或者本来就登着），身份中心把一次性授权码
// 重定向到本程序注册的协议；程序凭 PKCE verifier 换成会话。密码不经过本程序。

/// 一次进行中的浏览器登录。只认它发出去的 state；别处来的回调一律不理。
pub struct PendingBrowserLogin {
    state: String,
    verifier: String,
    started: std::time::Instant,
}

/// 浏览器那边登录最多等这么久，超过就要重新发起。
const BROWSER_LOGIN_TTL: Duration = Duration::from_secs(10 * 60);

fn random_token(bytes: usize) -> Result<String> {
    use base64::Engine;
    let mut buffer = vec![0u8; bytes];
    getrandom::getrandom(&mut buffer).map_err(|_| AppError::Other("无法生成随机数".into()))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buffer))
}

fn pkce_challenge(verifier: &str) -> String {
    use base64::Engine;
    use sha2::Digest;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(verifier.as_bytes()))
}

/// 生成一次登录请求，返回（待核对的状态，给浏览器打开的地址）。
///
/// `switch_account`：「切换账号」时带 `prompt=login`，身份中心总是显示登录表单——
/// 不然浏览器里还登着上一个账号，一打开就原样把它带回来。
pub fn begin_browser_login(switch_account: bool) -> Result<(PendingBrowserLogin, String)> {
    let state = random_token(24)?;
    let verifier = random_token(48)?; // 64 个字符，在 PKCE 要求的 43–128 之内
    let challenge = pkce_challenge(&verifier);
    let mut params = vec![
        ("response_type", "code"),
        ("client_id", brand::DESKTOP_CLIENT_ID),
        ("redirect_uri", brand::DESKTOP_REDIRECT_URI),
        ("scope", "openid profile email"),
        ("state", state.as_str()),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
    ];
    if switch_account {
        params.push(("prompt", "login"));
    }
    let url = reqwest::Url::parse_with_params(&format!("{}/idp/authorize", brand::ACCOUNT), &params)
        .map_err(|_| AppError::Other("无法生成登录地址".into()))?;
    let pending = PendingBrowserLogin {
        state,
        verifier,
        started: std::time::Instant::now(),
    };
    Ok((pending, url.into()))
}

impl PendingBrowserLogin {
    /// 回调带回来的 state 对得上、也没过期，才交出 verifier。
    pub fn verifier_for(&self, state: &str) -> Result<&str> {
        if self.started.elapsed() > BROWSER_LOGIN_TTL {
            return Err(AppError::Other("这次登录已超时，请重新在浏览器登录".into()));
        }
        let same = state.len() == self.state.len()
            && state
                .bytes()
                .zip(self.state.bytes())
                .fold(true, |same, (a, b)| same & (a == b));
        if state.is_empty() || !same {
            return Err(AppError::Other("登录回调与本次请求不匹配，已忽略".into()));
        }
        Ok(&self.verifier)
    }
}

/// 服务端是否已开放桌面浏览器登录：登记了本客户端、回调地址也和本程序一致。
/// 没开放（接口不存在、未登记、网络不通）一律当作不可用，界面就不出这颗键。
pub async fn browser_login_available(s: &Session) -> bool {
    #[derive(Deserialize)]
    struct Config {
        client_id: String,
        redirect_uri: String,
    }
    let Ok(response) = s
        .client
        .get(format!("{}/auth/oidc/desktop-config", brand::DEVELOPER_API))
        .send()
        .await
    else {
        return false;
    };
    if !response.status().is_success() {
        return false;
    }
    response.json::<Config>().await.is_ok_and(|config| {
        config.client_id == brand::DESKTOP_CLIENT_ID && config.redirect_uri == brand::DESKTOP_REDIRECT_URI
    })
}

/// 把浏览器带回来的一次性授权码换成会话。
pub async fn finish_browser_login(s: &Session, code: &str, verifier: &str) -> Result<String> {
    let _guard = s.requests.lock().await;
    logout(s);
    let response = s
        .client
        .post(format!("{}/auth/oidc/exchange", brand::DEVELOPER_API))
        .json(&serde_json::json!({
            "client_id": brand::DESKTOP_CLIENT_ID,
            "code": code,
            "redirect_uri": brand::DESKTOP_REDIRECT_URI,
            "code_verifier": verifier,
        }))
        .send()
        .await
        .map_err(network)?;
    let status = response.status();
    if !status.is_success() {
        return Err(AppError::Other(match status.as_u16() {
            400 | 401 | 422 => "授权码无效或已过期，请重新在浏览器登录".into(),
            429 => "请求太频繁，请稍后再试".into(),
            503 => "浏览器登录暂未开放，请先手动粘贴 API Key".into(),
            code => format!("登录失败（{}）", code),
        }));
    }
    let out: AuthOut = response
        .json()
        .await
        .map_err(|_| AppError::Other("登录失败：服务器响应格式不正确".into()))?;
    if out.access_token.trim().is_empty() || out.user_id.is_empty() {
        return Err(AppError::Other("登录响应不完整，请重新登录".into()));
    }
    let token = s.adopt(out);
    let name = token.user.name();
    *s.user
        .lock()
        .map_err(|_| AppError::Other("内部状态异常".into()))? = Some(token.user);
    Ok(name)
}

async fn decode<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
    fallback: &str,
) -> Result<T> {
    let status = response.status();
    if !status.is_success() {
        // 只有登录之后的请求（列密钥、导入）会走到这里：登录本身在浏览器里完成
        return Err(AppError::Other(match status.as_u16() {
            401 => "登录已过期，请重新登录".into(),
            403 => "请求被拒绝，请检查账号权限".into(),
            429 => "请求太频繁，请稍后再试".into(),
            code => format!("{}（{}）", fallback, code),
        }));
    }
    response
        .json()
        .await
        .map_err(|_| AppError::Other(format!("{}：服务器响应格式不正确", fallback)))
}

pub fn logout(s: &Session) {
    if let Ok(mut user) = s.user.lock() {
        *user = None;
    }
    if let Ok(mut held) = s.bearer.lock() {
        *held = None;
    }
    // SessionState::reset drops the cookie jar. No shared browser logout is performed.
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayToken {
    pub id: i64,
    pub name: String,
    pub usable: bool,
    pub note: String,
}

#[derive(Deserialize)]
struct DeveloperKey {
    id: i64,
    name: String,
    #[serde(default)]
    key: String,
    status: String,
    #[serde(default)]
    expires_at: Option<String>,
}
impl DeveloperKey {
    fn view(&self) -> GatewayToken {
        let expired = self
            .expires_at
            .as_deref()
            .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
            .is_some_and(|t| t < chrono::Utc::now());
        let usable = self.status == "active" && !expired && !self.key.trim().is_empty();
        let note = if expired || self.status == "expired" {
            "已过期"
        } else if self.status == "quota_exhausted" {
            "额度已用完"
        } else if self.status != "active" {
            "已停用或状态未知"
        } else if self.key.trim().is_empty() {
            "控制台未返回可导入的密钥"
        } else {
            ""
        };
        GatewayToken {
            id: self.id,
            name: self.name.clone(),
            usable,
            note: note.into(),
        }
    }
}

async fn keys(s: &Session) -> Result<Vec<DeveloperKey>> {
    let _guard = s.requests.lock().await;
    let expected = s.account_scope()?;
    // Refresh from the in-memory identity cookie before each request.
    let token = s.token().await?;
    if token.access_token.trim().is_empty()
        || expected != format!("{}|{}", brand::DEVELOPER_API, token.user.user_id)
    {
        logout(s);
        return Err(AppError::Other("登录账号已变化，请重新登录".into()));
    }
    let response = s
        .client
        .get(format!("{}/me/developer/keys", brand::DEVELOPER_API))
        .bearer_auth(token.access_token)
        .send()
        .await
        .map_err(network)?;
    decode(response, "读取密钥列表失败").await
}

pub async fn list_tokens(s: &Session) -> Result<Vec<GatewayToken>> {
    Ok(keys(s).await?.iter().map(DeveloperKey::view).collect())
}

pub async fn fetch_key(s: &Session, token_id: i64) -> Result<String> {
    let key = keys(s)
        .await?
        .into_iter()
        .find(|k| k.id == token_id)
        .ok_or_else(|| AppError::Other("找不到这把密钥，请刷新列表".into()))?;
    if !key.view().usable {
        return Err(AppError::Other("这把密钥不可用，请在控制台检查状态".into()));
    }
    // New console already returns the complete key. Do not guess or add a prefix.
    Ok(key.key)
}

fn network(e: reqwest::Error) -> AppError {
    AppError::Network(if e.is_timeout() {
        "连接超时，请检查网络或代理设置".into()
    } else {
        "无法连接 zAI 服务，请检查网络或代理设置".into()
    })
}

pub struct SessionState(pub Arc<Mutex<Option<Arc<Session>>>>);
impl Default for SessionState {
    fn default() -> Self {
        Self::new()
    }
}
impl SessionState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(None)))
    }
    pub fn get_or_init(&self, ignore_proxy: bool) -> Result<Arc<Session>> {
        let mut guard = self
            .0
            .lock()
            .map_err(|_| AppError::Other("内部状态异常".into()))?;
        if let Some(s) = guard.as_ref() {
            return Ok(s.clone());
        }
        let session = Arc::new(Session::new(ignore_proxy)?);
        *guard = Some(session.clone());
        Ok(session)
    }
    pub fn reset(&self) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_login_request_carries_pkce_and_registered_callback() {
        let (pending, url) = begin_browser_login(false).unwrap();
        let url = reqwest::Url::parse(&url).unwrap();
        let param = |name: &str| {
            url.query_pairs()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.into_owned())
                .unwrap_or_default()
        };
        assert_eq!(url.origin().ascii_serialization(), brand::ACCOUNT);
        assert_eq!(url.path(), "/idp/authorize");
        assert_eq!(param("response_type"), "code");
        assert_eq!(param("client_id"), brand::DESKTOP_CLIENT_ID);
        assert_eq!(param("redirect_uri"), brand::DESKTOP_REDIRECT_URI);
        assert_eq!(param("code_challenge_method"), "S256");
        assert_eq!(param("code_challenge"), pkce_challenge(&pending.verifier));
        assert!((43..=128).contains(&pending.verifier.len()));
        // The verifier never leaves the process in the URL.
        assert!(!url.as_str().contains(&pending.verifier));
        assert_eq!(pending.verifier_for(&param("state")).unwrap(), pending.verifier);
        // 平常不带 prompt：浏览器里已登录就直接回来
        assert_eq!(param("prompt"), "");
    }
    #[test]
    fn switching_account_forces_the_sign_in_form() {
        let (_, url) = begin_browser_login(true).unwrap();
        let url = reqwest::Url::parse(&url).unwrap();
        assert!(url.query_pairs().any(|(key, value)| key == "prompt" && value == "login"));
    }
    #[test]
    fn browser_login_callback_must_match_the_pending_state() {
        let (pending, _) = begin_browser_login(false).unwrap();
        assert!(pending.verifier_for("").is_err());
        assert!(pending.verifier_for("someone-elses-state").is_err());
        let (other, _) = begin_browser_login(false).unwrap();
        assert!(pending.verifier_for(&other.state).is_err());
    }
    #[test]
    fn pkce_challenge_matches_rfc7636_example() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
    #[test]
    fn new_console_key_status_and_full_secret_contract() {
        let key: DeveloperKey = serde_json::from_str(
            r#"{"id":7,"name":"dev","key":"sk-complete","status":"active","expires_at":null}"#,
        )
        .unwrap();
        assert!(key.view().usable);
        let view = serde_json::to_string(&key.view()).unwrap();
        assert!(!view.contains("sk-complete"));
        for status in ["inactive", "quota_exhausted", "expired", "unknown"] {
            let key = DeveloperKey {
                status: status.into(),
                ..serde_json::from_str(r#"{"id":7,"name":"dev","key":"secret","status":"active"}"#)
                    .unwrap()
            };
            assert!(!key.view().usable);
        }
    }
    #[test]
    fn expired_or_missing_secrets_are_not_importable() {
        for json in [
            r#"{"id":1,"name":"old","key":"secret","status":"active","expires_at":"2000-01-01T00:00:00Z"}"#,
            r#"{"id":2,"name":"hidden","status":"active"}"#,
        ] {
            assert!(
                !serde_json::from_str::<DeveloperKey>(json)
                    .unwrap()
                    .view()
                    .usable
            );
        }
    }
}

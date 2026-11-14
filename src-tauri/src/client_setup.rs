//! Official install guidance and opt-in version checks. No installation is executed here.
use crate::{
    api,
    error::{AppError, Result},
    launcher::{self, Target},
};
use semver::Version;
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Guide {
    url: &'static str,
    command: Option<&'static str>,
    shell: &'static str,
    note: &'static str,
}

fn guide(target: Target, platform: &str) -> Guide {
    match target {
        Target::ClaudeCli => Guide {
            url: "https://code.claude.com/docs/en/setup",
            command: Some(if platform == "windows" { "irm https://claude.ai/install.ps1 | iex" } else { "curl -fsSL https://claude.ai/install.sh | bash" }),
            shell: if platform == "windows" { "PowerShell" } else { "Terminal" },
            note: "使用官方原生安装器。已有安装请按官方文档选择对应的更新方式。",
        },
        Target::CodexCli => Guide {
            url: "https://github.com/openai/codex#installation",
            command: Some("npm install -g @openai/codex@latest"),
            shell: if platform == "windows" { "PowerShell" } else { "Terminal" },
            note: "需要先安装 Node.js 和 npm；已有 npm 安装可使用同一命令更新。其他安装方式请查看官方文档。",
        },
        Target::ClaudeDesktop => Guide { url: "https://claude.com/download", command: None, shell: "", note: "从官方页面选择适合系统的安装包，安装完成后重新检测。" },
        Target::CodexDesktop => Guide { url: "https://developers.openai.com/codex/app", command: None, shell: "", note: "从官方页面选择适合系统的安装包，安装完成后重新检测。" },
    }
}

#[tauri::command]
pub fn client_install_guide(target: Target) -> Guide {
    guide(target, std::env::consts::OS)
}

#[tauri::command]
pub fn open_client_download(app: tauri::AppHandle, target: Target) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(guide(target, std::env::consts::OS).url, None::<&str>)
        .map_err(|_| AppError::Other("无法打开官方页面，请检查默认浏览器".into()))
}

pub(crate) fn parse_version_output(text: &str) -> Option<String> {
    text.lines()
        .take(8)
        .filter(|line| {
            let line = line.trim();
            line.starts_with("codex-cli ") || line.ends_with("(Claude Code)") || line.split_whitespace().count() == 1
        })
        .flat_map(str::split_whitespace)
        .filter_map(|s| {
            Version::parse(s.trim_matches(['(', ')', ',']).trim_start_matches('v')).ok()
        })
        .next()
        .map(|v| v.to_string())
}

fn release_version(document: &[u8]) -> Result<String> {
    let data: serde_json::Value = serde_json::from_slice(document)?;
    if data["draft"].as_bool() != Some(false) || data["prerelease"].as_bool() != Some(false) {
        return Err(AppError::Other("最新稳定版本信息不可用".into()));
    }
    let tag = data["tag_name"]
        .as_str()
        .ok_or_else(|| AppError::Other("最新稳定版本信息不可用".into()))?;
    let raw = tag
        .strip_prefix("rust-v")
        .or_else(|| tag.strip_prefix('v'))
        .unwrap_or(tag);
    let version =
        Version::parse(raw).map_err(|_| AppError::Other("最新稳定版本信息不可用".into()))?;
    if !version.pre.is_empty() {
        return Err(AppError::Other("最新稳定版本信息不可用".into()));
    }
    Ok(version.to_string())
}

async fn latest_version(target: Target, ignore_proxy: bool) -> Result<String> {
    let url = match target {
        Target::ClaudeCli => "https://api.github.com/repos/anthropics/claude-code/releases/latest",
        Target::CodexCli => "https://api.github.com/repos/openai/codex/releases/latest",
        _ => return Err(AppError::Other("版本检查仅支持 CLI".into())),
    };
    let mut response = api::client(ignore_proxy)?
        .get(url)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| AppError::Network(e.to_string()))?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
    {
        if bytes.len() + chunk.len() > 1024 * 1024 {
            return Err(AppError::Other("版本响应过大".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    release_version(&bytes)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientVersion {
    pub current: String,
    pub latest: Option<String>,
    pub update_available: Option<bool>,
    pub path: String,
    pub warning: Option<&'static str>,
}

fn version_status(current: String, path: String, latest: Result<String>) -> ClientVersion {
    let latest = latest.ok();
    let update_available = latest.as_ref().and_then(|v| {
        Some(
            Version::parse(v)
                .ok()?
                .cmp_precedence(&Version::parse(&current).ok()?)
                .is_gt(),
        )
    });
    ClientVersion {
        current,
        path,
        update_available,
        warning: latest
            .is_none()
            .then_some("无法获取最新版本，已保留本机版本信息，可稍后重试"),
        latest,
    }
}

static CHECK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
#[tauri::command]
pub async fn check_client_version(target: Target, ignore_proxy: bool) -> Result<ClientVersion> {
    crate::updates::ensure_supported()?;
    let _guard = CHECK
        .try_lock()
        .map_err(|_| AppError::Other("正在检查 CLI 版本，请稍候".into()))?;
    let (current, path) = crate::commands::blocking(move || launcher::cli_version(target)).await?;
    Ok(version_status(
        current,
        path,
        latest_version(target, ignore_proxy).await,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn version_parsing_and_stable_release_comparison() {
        assert_eq!(
            parse_version_output("codex-cli 0.99.0\n"),
            Some("0.99.0".into())
        );
        assert_eq!(
            parse_version_output("2.1.89 (Claude Code)"),
            Some("2.1.89".into())
        );
        assert_eq!(parse_version_output("command not found"), None);
        assert_eq!(parse_version_output("Warning: requires Node 22.0.0\ncodex-cli 0.99.0"), Some("0.99.0".into()));
        assert_eq!(parse_version_output("Warning: requires Node 22.0.0"), None);
        assert_eq!(
            release_version(br#"{"tag_name":"rust-v0.100.0","draft":false,"prerelease":false}"#)
                .unwrap(),
            "0.100.0"
        );
        for data in [
            r#"{"tag_name":"v2.0.0-beta.1","draft":false,"prerelease":false}"#,
            r#"{"tag_name":"v2.0.0","draft":true,"prerelease":false}"#,
            "{}",
        ] {
            assert!(release_version(data.as_bytes()).is_err());
        }
        assert_eq!(
            version_status("0.99.0".into(), "path".into(), Ok("0.100.0".into())).update_available,
            Some(true)
        );
        assert_eq!(
            version_status("2.0.0+custom".into(), "path".into(), Ok("2.0.0".into()))
                .update_available,
            Some(false)
        );
        let offline = version_status(
            "1.0.0".into(),
            "path".into(),
            Err(AppError::Other("offline".into())),
        );
        assert_eq!(offline.current, "1.0.0");
        assert!(offline.update_available.is_none() && offline.warning.is_some());
    }
    #[test]
    fn official_guides_are_platform_specific_and_never_accept_commands_from_the_ui() {
        assert_eq!(
            guide(Target::ClaudeCli, "windows").command,
            Some("irm https://claude.ai/install.ps1 | iex")
        );
        assert!(guide(Target::ClaudeCli, "macos")
            .command
            .unwrap()
            .contains("install.sh"));
        assert!(guide(Target::CodexCli, "windows")
            .command
            .unwrap()
            .contains("@openai/codex@latest"));
        for target in Target::all() {
            assert!(guide(target, "windows").url.starts_with("https://"));
        }
        assert!(guide(Target::ClaudeDesktop, "windows").command.is_none());
        assert!(guide(Target::CodexDesktop, "macos").command.is_none());
    }
}

import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import { t, useLang } from "./i18n";
import { useUpdates } from "./Updates";
import type { LaunchTarget } from "./types";
import "./ClientSetup.css";

/** Explicit guidance: copying/opening instructions never executes an installer. */
export function ClientSetup({ target, installed, refresh, disabled }: { target: LaunchTarget; installed: boolean; refresh: () => Promise<unknown>; disabled: boolean }) {
  useLang();
  const { ignoreProxy } = useUpdates();
  const [guide, setGuide] = useState<api.ClientGuide | null>(null);
  const [version, setVersion] = useState<api.ClientVersion | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const active = useRef(true);
  const checkingRef = useRef(false);
  useEffect(() => {
    active.current = true;
    void api.clientInstallGuide(target).then(value => { if (active.current) setGuide(value); }).catch(e => { if (active.current) setError(String(e)); });
    return () => { active.current = false; };
  }, [target]);
  const check = async () => {
    if (checkingRef.current || disabled) return;
    checkingRef.current = true; setChecking(true); setError(""); setVersion(null);
    try { const result = await api.checkClientVersion(target, ignoreProxy); if (active.current) setVersion(result); }
    catch (e) { if (active.current) setError(String(e)); }
    finally { checkingRef.current = false; if (active.current) setChecking(false); }
  };
  return <section className="client-setup" aria-label={t("客户端安装与更新")}>
    <p>{t(guide?.note ?? "正在读取安装说明…")}</p>
    {guide?.command && <>
      <p>{t("在 {shell} 中执行以下官方命令：", { shell: guide.shell })}</p>
      <pre className="install-command"><code>{guide.command}</code></pre>
      <button disabled={disabled} onClick={() => void navigator.clipboard.writeText(guide.command!).then(() => setCopied(true)).catch(() => setError(t("复制失败，请手动选择命令复制")))}>{t(copied ? "已复制" : "复制安装命令")}</button>
    </>}
    <div className="setup-actions">
      <button disabled={disabled} onClick={() => void api.openClientDownload(target).catch(e => setError(String(e)))}>{t("打开官方安装 / 更新页面")}</button>
      <button disabled={disabled || checking} onClick={() => void refresh().catch(e => setError(String(e)))}>{t("安装完成，重新检测")}</button>
      {target.endsWith("cli") && installed && <button disabled={disabled || checking} onClick={() => void check()}>{t(checking ? "检查中…" : "检查 CLI 版本")}</button>}
    </div>
    <p className="setup-hint">{t("安装完成后重新检测；若仍未找到，请重启本工具或设置程序路径。")}</p>
    {version && <div aria-live="polite">
      <p>{t("本机 CLI 版本：{version}", { version: version.current })}</p>
      <p className="setup-path">{version.path}</p>
      {version.latest && <p>{t(version.updateAvailable ? "有较新稳定版本 {version}，建议按官方说明更新。" : "未发现更高的稳定版本。", { version: version.latest })}</p>}
      {version.warning && <p className="setup-hint">{t(version.warning)}</p>}
    </div>}
    {error && <p className="setup-error" role="alert">{t(error)}</p>}
  </section>;
}

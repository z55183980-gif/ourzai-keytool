import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "./api";
import { UiIcon } from "./UiIcon";
import wordmarkUrl from "./assets/wordmark.png";
import type { GatewayToken } from "./types";
import { t } from "./i18n";
import "./LoginPanel.css";

/**
 * 登录导入：只走浏览器。点开就用系统浏览器打开身份中心（account.ourzai.com）的授权页，
 * 在那里用 Apple、Google、邮箱验证码或密码登录——和开发者控制台是同一张登录表单、同一个
 * 登录状态，控制台已经登着的话一打开就直接回来。身份中心再通过本程序注册的协议把一次性
 * 授权码交回来（授权码 + PKCE，见 src-tauri/src/gateway.rs），账号密码不经过本程序。
 *
 * 服务端没开放这条路（或连不上）时，只给「手动粘贴 API Key」。
 */

async function openExternal(url: string) {
  try { await openUrl(url); }
  catch { window.open(url, "_blank", "noopener,noreferrer"); }
}

/** checking：问服务端开没开放；start：等用户点（失败、取消、切换账号后也回到这里）；browser：浏览器里登录中；unavailable：没开放 */
type View = "checking" | "start" | "browser" | "unavailable";
type Working = null | "login" | "list" | "import" | "logout" | "browser";
type BrowserCallback = { code: string; state: string; error: string };

export function LoginPanel(props: {
  loggedAs: string | null;
  tokens: GatewayToken[] | null;
  ignoreProxy: boolean;
  busy: boolean;
  onLoggedIn: (user: string, tokens: GatewayToken[]) => void;
  onLogout: () => void | Promise<void>;
  onImported: (created: string[], updated: string[], unchanged: string[], skipped: string[]) => void | Promise<void>;
  onManualKey: () => void;
  onClose: () => void;
}) {
  const { loggedAs, tokens, ignoreProxy, busy, onLoggedIn, onLogout, onImported, onManualKey, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const requestInFlight = useRef(false);
  const id = useId();
  const [view, setView] = useState<View>("checking");
  const [error, setError] = useState<string | null>(null);
  const [authenticatedAs, setAuthenticatedAs] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [working, setWorking] = useState<Working>(null);
  /** 打开窗口时自动拉起浏览器只做一次（开发模式 StrictMode 会把 effect 跑两遍） */
  const autoOpened = useRef(false);
  const signedIn = loggedAs || authenticatedAs;
  const disabled = busy || working !== null;
  const fresh = tokens?.filter(x => x.usable && !x.linkedProfile) ?? [];

  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    setPicked(new Set(tokens?.filter(x => x.usable && !x.linkedProfile).map(x => x.id) ?? []));
  }, [tokens]);

  async function run(kind: NonNullable<Working>, action: () => Promise<void>) {
    if (busy || requestInFlight.current) return;
    requestInFlight.current = true;
    setWorking(kind); setError(null);
    try { await action(); }
    catch (e) { setError(t(String(e).replace(/^Error:\s*/, ""))); }
    finally { requestInFlight.current = false; setWorking(null); }
  }

  async function loadTokens(name: string) {
    const list = await api.gatewayListTokens();
    onLoggedIn(name, list);
  }

  // —— 浏览器登录 ——
  /** switchAccount：身份中心总是显示登录表单，不直接带回浏览器里登着的那个账号 */
  const openBrowserLogin = (switchAccount = false) => run("browser", async () => {
    await openExternal(await api.gatewayBrowserLoginStart(switchAccount));
    setView("browser");
  });

  /** 服务端开没开放浏览器登录。autoOpen：开放了就直接打开浏览器（点「登录导入」就是要登录） */
  const checkAvailable = (autoOpen: boolean) => {
    setView("checking");
    return api.gatewayBrowserLoginAvailable(ignoreProxy)
      .then(ok => {
        setView(ok ? "start" : "unavailable");
        if (ok && autoOpen) void openBrowserLogin();
      })
      .catch(() => setView("unavailable"));
  };
  useEffect(() => {
    if (signedIn || autoOpened.current) return;
    autoOpened.current = true;
    void checkAvailable(true);
    // 只在打开窗口时做一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finishBrowserLogin(callback: BrowserCallback) {
    if (callback.error || !callback.code) {
      setView("start");
      setError(callback.error === "access_denied" ? t("已在浏览器中取消登录。") : t("浏览器登录没有完成，请重试。"));
      return;
    }
    await run("login", async () => {
      try {
        const name = await api.gatewayBrowserLoginFinish(callback.code, callback.state, ignoreProxy);
        setAuthenticatedAs(name);
        await loadTokens(name);
      } catch (e) { setView("start"); throw e; }
    });
  }
  // 回调来自后端事件；用 ref 让监听器始终调到最新的处理函数
  const onBrowserCallback = useRef(finishBrowserLogin);
  onBrowserCallback.current = finishBrowserLogin;
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    listen<BrowserCallback>("browser-login-callback", event => void onBrowserCallback.current(event.payload))
      .then(unlisten => { if (gone) unlisten(); else stop = unlisten; })
      .catch(() => {}); // 浏览器预览里没有 Tauri
    return () => { gone = true; stop?.(); };
  }, []);

  /** 切换账号：退出本程序里的登录，再打开浏览器，并要求身份中心显示登录表单 */
  const switchAccount = async () => {
    await run("logout", async () => {
      await onLogout();
      setAuthenticatedAs(null);
      setView("start");
    });
    await openBrowserLogin(true);
  };

  const importKeys = (ids: number[]) => run("import", async () => {
    const result = await api.gatewayImportTokens(ids);
    await onImported(result.created, result.updated, result.unchanged, result.skipped);
  });

  const title = t(signedIn ? "选择要导入的密钥" : "登录 zAI 账号");
  const lede = t(signedIn ? "导入后，即可在启动页和密钥页选择使用。"
    : view === "unavailable" ? "暂时无法在浏览器中登录。可以先手动粘贴 API Key，不登录也能使用全部功能。"
    : "支持 Apple、Google 或邮箱验证码；已登录控制台可继续。");
  const alert = error && <p className="cauth-error" role="alert">{error}</p>;
  const spinner = <span className="account-spinner" />;
  const manual = <button type="button" className="cauth-link" disabled={disabled} onClick={onManualKey}>{t("手动粘贴 API Key")}</button>;

  return createPortal(
    <dialog ref={dialog} className="account-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-lede`}
      onCancel={event => { event.preventDefault(); if (!disabled && !requestInFlight.current) onClose(); }}>
      <div className="cauth">
        <button className="cauth-close" aria-label={t("关闭登录导入")} title={t("关闭")} disabled={disabled} onClick={onClose}><UiIcon name="close"/></button>
        <header className="cauth-head">
          <div className="cauth-heading-row"><img className="cauth-logo" src={wordmarkUrl} alt="zAI" draggable={false}/><h1 className="cauth-title" id={`${id}-title`}>{title}</h1></div>
          <p className="cauth-lede" id={`${id}-lede`}>{lede}</p>
        </header>

        {signedIn ? <div className="cauth-body">
          <div className="account-identity"><span className="account-avatar">{signedIn.slice(0, 1).toUpperCase()}</span><div><strong>{signedIn}</strong><span>{t("已连接 zAI 账号")}</span></div><button className="cauth-link" disabled={disabled} onClick={() => void switchAccount()}>{t("切换账号")}</button></div>
          {tokens === null ? <div className="account-empty"><UiIcon name="refresh"/><strong>{working === "login" || working === "list" ? t("正在读取密钥…") : t("密钥列表尚未加载")}</strong><button className="cauth-link" disabled={disabled} onClick={() => void run("list", () => loadTokens(signedIn))}>{t("重新加载")}</button></div> : tokens.length === 0 ? <div className="account-empty"><UiIcon name="key"/><strong>{t("还没有可导入的密钥")}</strong><p>{t("在开发者控制台创建后，回来刷新列表。")}</p><button className="cauth-link" disabled={disabled} onClick={() => void run("list", () => loadTokens(signedIn))}>{t("刷新列表")}</button></div> : <>
            <div className="account-list-heading"><span>{t("{n} 个密钥 · 已选 {picked} 个", { n: tokens.length, picked: picked.size })}</span><button className="cauth-link" disabled={disabled || fresh.length === 0} onClick={() => setPicked(picked.size === fresh.length ? new Set() : new Set(fresh.map(x => x.id)))}>{picked.size === fresh.length && fresh.length > 0 ? t("取消全选") : t("全选可导入项")}</button></div>
            <div className="account-token-list">{tokens.map(token => token.linkedProfile ? <div className="account-token linked" key={token.id}><UiIcon name="check"/><div><strong>{token.name}</strong><span>{token.usable ? t("已关联「{name}」", { name: token.linkedProfile }) : t(token.note || "当前不可用")}</span></div><button className="cauth-link" disabled={disabled || !token.usable} onClick={() => void importKeys([token.id])}>{t("更新")}</button></div> : <label className={`account-token ${picked.has(token.id) ? "selected" : ""} ${token.usable ? "" : "unavailable"}`} key={token.id}><input type="checkbox" checked={picked.has(token.id)} disabled={disabled || !token.usable} onChange={() => setPicked(previous => { const next = new Set(previous); if (next.has(token.id)) next.delete(token.id); else next.add(token.id); return next; })}/><div><strong>{token.name}</strong><span>{t(token.note || "可导入")}</span></div></label>)}</div>
          </>}
          {alert}
          <button className="cauth-submit primary" disabled={disabled || picked.size === 0} onClick={() => void importKeys([...picked])}>{working === "import" ? <>{spinner}{t("正在导入…")}</> : t("导入选中的 {n} 个密钥", { n: picked.size })}</button>
        </div>

        : view === "browser" ? <div className="cauth-body">
          <div className="cauth-waiting">{spinner}<strong>{working === "login" ? t("正在登录…") : t("请在浏览器中完成登录")}</strong></div>
          {alert}
          <div className="cauth-row">
            {manual}
            <button type="button" className="cauth-link" disabled={disabled} onClick={() => void openBrowserLogin()}>{t("重新打开浏览器")}</button>
          </div>
        </div>

        : view === "unavailable" ? <div className="cauth-body">
          {alert}
          <button type="button" className="cauth-submit primary" disabled={disabled} onClick={onManualKey}>{t("手动粘贴 API Key")}</button>
          <p className="cauth-foot"><button type="button" className="cauth-link" disabled={disabled} onClick={() => void checkAvailable(false)}>{t("重新检查")}</button></p>
        </div>

        : <div className="cauth-body">
          {alert}
          <button type="button" className="cauth-submit primary" disabled={disabled || view === "checking"} onClick={() => void openBrowserLogin()}>
            {view === "checking" || working === "browser" ? <>{spinner}{t("正在打开浏览器…")}</> : <><UiIcon name="external"/>{t("在浏览器中登录")}</>}
          </button>
          <p className="cauth-foot">{manual}</p>
        </div>}

        {!signedIn && <p className="cauth-trust"><UiIcon name="shield"/>{t("在 account.ourzai.com 登录，密码不会经过本程序")}</p>}
      </div>
    </dialog>, document.body,
  );
}

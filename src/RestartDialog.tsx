import { useState } from "react";
import * as api from "./api";
import { t } from "./i18n";
import type { LaunchTarget } from "./types";
import "./RestartDialog.css";

/** 写入配置后要弹窗的内容：需要重启的桌面版，以及 Claude 桌面版是否选了官方登录 */
export interface RestartPrompt { targets: LaunchTarget[]; officialLogin: boolean }

const NAME: Partial<Record<LaunchTarget, string>> = { "claude-desktop": "Claude 桌面版", "codex-desktop": "Codex 桌面版" };
export const OFFICIAL_LOGIN_CHOSEN = "Claude 桌面版当前选的是 Claude.ai 官方登录，不会使用第三方推理配置：请在桌面版里切换到第三方推理后重新打开";

/** 把新一次写入的提示并进还没关掉的弹窗（引导页会连续写好几个客户端） */
export function mergePrompt(prev: RestartPrompt | null, next: RestartPrompt): RestartPrompt {
  return { targets: [...new Set([...(prev?.targets ?? []), ...next.targets])], officialLogin: !!prev?.officialLogin || next.officialLogin };
}

/** 运行中的桌面版只在启动时读配置：请用户确认后由本工具直接退出并重新打开它 */
export function RestartDialog({ prompt, onClose, log }: {
  prompt: RestartPrompt;
  onClose: () => void;
  log: (kind: "ok" | "err" | "info", text: string) => void;
}) {
  const [working, setWorking] = useState(false);
  const names = prompt.targets.map(x => t(NAME[x] ?? x)).join(t("、"));
  const restart = async () => {
    setWorking(true);
    for (const target of prompt.targets) {
      const name = t(NAME[target] ?? target);
      log("info", t("正在重启 {name}", { name }));
      try {
        await api.restartDesktopClient(target);
        log("ok", t("{name} 已重新打开，新配置已生效", { name }));
      } catch (e) {
        log("err", t(String(e).replace(/^Error:\s*/, "")));
      }
    }
    setWorking(false);
    onClose();
  };
  const needsRestart = prompt.targets.length > 0;
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget && !working) onClose(); }}>
    <div className="modal restart-dialog" role="alertdialog" aria-modal="true" aria-labelledby="restart-title" aria-describedby="restart-body">
      <div className="modal-hd"><strong id="restart-title">{t(needsRestart ? "需要重启客户端" : "配置暂不会生效")}</strong></div>
      <div className="modal-body" id="restart-body">
        {needsRestart && <>
          <p>{t("{names} 正在运行，它只在启动时读取配置，重启后新配置才会生效。", { names })}</p>
          <p className="restart-note">{t("重启会关闭它的所有窗口和后台进程，进行中的对话或任务会被中断。")}</p>
        </>}
        {prompt.officialLogin && <p className="restart-official">{t(OFFICIAL_LOGIN_CHOSEN)}</p>}
      </div>
      <div className="restart-actions">
        {needsRestart
          ? <>
            <button type="button" className="ghost" disabled={working} onClick={onClose}>{t("稍后自己重启")}</button>
            <button type="button" className="primary" disabled={working} onClick={() => void restart()} autoFocus>{t(working ? "正在重启…" : "立即重启")}</button>
          </>
          : <button type="button" className="primary" onClick={onClose} autoFocus>{t("知道了")}</button>}
      </div>
    </div>
  </div>;
}

/** 把 Claude 桌面版从官方登录切到第三方推理：会关闭它再重新打开，先让用户确认 */
export function SwitchModeDialog({ onConfirm, onCancel }: { onConfirm: () => Promise<void>; onCancel: () => void }) {
  const [working, setWorking] = useState(false);
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget && !working) onCancel(); }}>
    <div className="modal restart-dialog" role="alertdialog" aria-modal="true" aria-labelledby="switch-title" aria-describedby="switch-body">
      <div className="modal-hd"><strong id="switch-title">{t("切换到第三方推理")}</strong></div>
      <div className="modal-body" id="switch-body">
        <p>{t("Claude 桌面版将退出，改用本工具写入的网关和密钥后重新打开。")}</p>
        <p className="restart-note">{t("进行中的对话或任务会被中断。你的 Claude.ai 账号不受影响，之后可在桌面版里切回官方登录；这次改动也可以撤销。")}</p>
      </div>
      <div className="restart-actions">
        <button type="button" className="ghost" disabled={working} onClick={onCancel}>{t("取消")}</button>
        <button type="button" className="primary" disabled={working} autoFocus onClick={async () => { setWorking(true); await onConfirm(); }}>{t(working ? "正在切换…" : "切换并重启")}</button>
      </div>
    </div>
  </div>;
}

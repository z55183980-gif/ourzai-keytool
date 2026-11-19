import { useState } from "react";
import * as api from "./api";
import { t } from "./i18n";
import type { LaunchTarget } from "./types";
import "./RestartDialog.css";

/** 写入配置后要重启的桌面版 */
export interface RestartPrompt { targets: LaunchTarget[] }

export const DESKTOP_NAME: Partial<Record<LaunchTarget, string>> = { "claude-desktop": "Claude 桌面版", "codex-desktop": "Codex 桌面版" };

/** 把新一次写入的提示并进还没关掉的弹窗（引导页会连续写好几个客户端） */
export function mergePrompt(prev: RestartPrompt | null, next: RestartPrompt): RestartPrompt {
  return { targets: [...new Set([...(prev?.targets ?? []), ...next.targets])] };
}

/** 运行中的桌面版只在启动时读配置：请用户确认后由本工具直接退出并重新打开它 */
export function RestartDialog({ prompt, onClose, log }: {
  prompt: RestartPrompt;
  onClose: () => void;
  log: (kind: "ok" | "err" | "info", text: string) => void;
}) {
  const names = prompt.targets.map(x => t(DESKTOP_NAME[x] ?? x)).join(t("、"));
  const restart = async () => {
    for (const target of prompt.targets) {
      const name = t(DESKTOP_NAME[target] ?? target);
      log("info", t("正在重启 {name}", { name }));
      try {
        await api.restartDesktopClient(target);
        log("ok", t("{name} 已重新打开，新配置已生效", { name }));
      } catch (e) {
        log("err", t(String(e).replace(/^Error:\s*/, "")));
      }
    }
    onClose();
  };
  return <ConfirmDialog title={t("需要重启客户端")}
    body={t("{names} 正在运行，它只在启动时读取配置，重启后新配置才会生效。", { names })}
    note={t("重启会关闭它的所有窗口和后台进程，进行中的对话或任务会被中断。")}
    cancelLabel={t("稍后自己重启")} confirmLabel={t("立即重启")} workingLabel={t("正在重启…")}
    onCancel={onClose} onConfirm={restart} />;
}

/** 通用确认弹窗：确认后执行，执行期间锁住按钮 */
export function ConfirmDialog({ title, body, note, cancelLabel, confirmLabel, workingLabel, onConfirm, onCancel }: {
  title: string; body: string; note?: string; cancelLabel: string; confirmLabel: string; workingLabel: string;
  onConfirm: () => Promise<void>; onCancel: () => void;
}) {
  const [working, setWorking] = useState(false);
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget && !working) onCancel(); }}>
    <div className="modal restart-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
      <div className="modal-hd"><strong id="confirm-title">{title}</strong></div>
      <div className="modal-body" id="confirm-body">
        <p>{body}</p>
        {note && <p className="restart-note">{note}</p>}
      </div>
      <div className="restart-actions">
        <button type="button" className="ghost" disabled={working} onClick={onCancel}>{cancelLabel}</button>
        <button type="button" className="primary" disabled={working} autoFocus onClick={async () => { setWorking(true); try { await onConfirm(); } finally { setWorking(false); } }}>{working ? workingLabel : confirmLabel}</button>
      </div>
    </div>
  </div>;
}

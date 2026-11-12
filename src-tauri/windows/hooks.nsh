; 安装程序钩子（tauri.conf.json → bundle.windows.nsis.installerHooks）
;
; 产品名从「zAI Key Manager」改成了「密钥管理工具」。NSIS 的安装目录和卸载记录都按产品名区分，
; 不处理的话，老用户升级会多出一份旧版本。所以安装前先找旧版本的卸载记录，有就静默卸载。
;
; 不影响用户数据：配置在 ~/.dbkey，密钥在系统密钥库，应用数据目录按应用标识（com.starnexus.dbkey）存放，
; 这些都和产品名无关；静默卸载也不会勾选「删除应用数据」。

!macro ZAI_REMOVE_LEGACY ROOT
  ReadRegStr $R0 ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\zAI Key Manager" "UninstallString"
  ${If} $R0 != ""
    ; 安装界面有简体、繁体、英文三种，这行用英文兜底
    DetailPrint "Removing old version: zAI Key Manager…"
    ExecWait '$R0 /S'
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro ZAI_REMOVE_LEGACY HKCU
  !insertmacro ZAI_REMOVE_LEGACY HKLM
!macroend

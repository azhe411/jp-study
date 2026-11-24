; 一駅 安装器钩子（Tauri NSIS installerHooks）。
; 0.8.0 起应用从「日语学习中枢」改名为「一駅」，NSIS 按产品名区分安装，旧版不会被新版覆盖。
; 安装完成后，如果发现旧名字的安装，就用它自己的卸载程序静默卸掉。
; 静默卸载不勾选"删除应用数据"，而两个版本的数据目录都按 identifier（top.azclient.jp）存放，登录状态与缓存不受影响。

!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\日语学习中枢" "UninstallString"
  ${If} $R0 == ""
    ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\日语学习中枢" "UninstallString"
  ${EndIf}
  ${If} $R0 != ""
    DetailPrint "正在卸载旧版「日语学习中枢」…"
    ExecWait '$R0 /S' $R1
    Delete "$SMPROGRAMS\日语学习中枢.lnk"
    Delete "$DESKTOP\日语学习中枢.lnk"
  ${EndIf}
!macroend

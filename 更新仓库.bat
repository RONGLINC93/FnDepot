@echo off
chcp 65001 >nul 2>&1

rem ---------------------------------------------------------------------------
rem  更新仓库
rem  默认只同步每个仓库最新版本；已有应用直接用 GitHub 资产 digest，不下载 FPK。
rem  新应用、资产缺 digest 时会自动下载解析；传 --download 可强制逐个下载校对。
rem ---------------------------------------------------------------------------
node "%~dp0update.js" %*

if errorlevel 1 (
    echo.
    echo [ERROR] Update failed. See messages above.
    call :countdown 5
    exit /b 1
)

call :countdown 5
exit /b 0

rem ---------------------------------------------------------------------------
rem  :countdown <秒数>
rem  从 <秒数> 倒数到 0, 每秒打印剩余秒数 (Ctrl+C 可中断).
rem  本子例程只倒计时不退出, 调用方负责 exit /b.
rem ---------------------------------------------------------------------------
:countdown
echo.
echo %~1 秒后自动关闭窗口... (按 Ctrl+C 取消)
for /l %%i in (%~1,-1,1) do (
    echo   %%i...
    ping -n 2 127.0.0.1 >nul
)
exit /b 0

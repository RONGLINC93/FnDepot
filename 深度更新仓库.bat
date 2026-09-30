@echo off
chcp 65001 >nul 2>&1

rem ---------------------------------------------------------------------------
rem  深度更新仓库
rem  完整同步每个仓库的【全部】 Release（不仅是最新版本）。
rem  由于要逐个下载历史 FPK 解析 manifest，耗时较长，仅在需要补录全部历史版本
rem  时使用；日常更新请用 更新仓库.bat。
rem ---------------------------------------------------------------------------
node "%~dp0update.js" --deep %*

if errorlevel 1 (
    echo.
    echo [ERROR] Deep update failed. See messages above.
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

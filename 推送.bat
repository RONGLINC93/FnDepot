@echo off
chcp 65001 >nul 2>&1

node "%~dp0push.js" %*

if errorlevel 1 (
    echo.
    echo [ERROR] Push failed. See messages above.
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

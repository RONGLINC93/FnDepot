@echo off
chcp 65001 >nul 2>&1

rem ---------------------------------------------------------------------------
rem  运行网站
rem  启动 FnDepot 网站服务（应用目录 + 更新管理），默认端口 9555。
rem  可用环境变量指定端口，例如： set PORT=8080  再运行本脚本。
rem  启动后浏览器打开 http://localhost:9555
rem ---------------------------------------------------------------------------
start "" cmd /c "ping -n 4 127.0.0.1 >nul & start http://localhost:9555"
node "%~dp0server.js" %*

if errorlevel 1 (
    echo.
    echo [ERROR] 网站启动失败。请查看上方信息。
    call :countdown 8
    exit /b 1
)

call :countdown 8
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

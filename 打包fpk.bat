@echo off
rem ===========================================================================
rem FnDepot fpk builder (Windows)
rem 模仿 reminder 的 fnos/build-fpk.sh 流程，把 FnDepot 网站打包成 fnOS 安装包。
rem 前置：fnpack.exe 放在 fnos\ 或系统 PATH（https://developer.fnnas.com/docs/cli/fnpack/）
rem 产物：dist\fndepot-<version>.fpk
rem 说明：本文件保持 ASCII，避免批处理对非 ASCII 解析不稳定。
rem ===========================================================================
setlocal
chcp 65001 >nul 2>&1
set "PROJ=%~dp0"
set "TOOLS=%PROJ%fnos"
set "PKG=%TOOLS%\fndepot"
set "SERVER=%PKG%\app\server"
set "OUTDIR=%PROJ%dist"

echo === Build fnOS fpk: FnDepot ===
echo.

echo [1/6] Check icon...
if not exist "%PKG%\ICON_256.PNG" (
  echo  ICON_256.PNG missing. Place a 256x256 icon at: %PKG%\ICON_256.PNG
  goto fail
)

echo [2/6] Copy app files to %SERVER% ...
if exist "%SERVER%" rmdir /s /q "%SERVER%"
mkdir "%SERVER%" 2>nul
copy /y "%PROJ%server.js" "%SERVER%\server.js" >nul || goto fail
xcopy "%PROJ%public" "%SERVER%\public" /e /i /y /q >nul || goto fail
copy /y "%PROJ%fnpack.json" "%SERVER%\fnpack.json" >nul || goto fail
xcopy "%PROJ%apps" "%SERVER%\apps" /e /i /y /q >nul || goto fail
xcopy "%PROJ%assets" "%SERVER%\assets" /e /i /y /q >nul || goto fail
copy /y "%PROJ%update.js" "%SERVER%\update.js" >nul
copy /y "%PROJ%push.js" "%SERVER%\push.js" >nul
copy /y "%PROJ%pull.js" "%SERVER%\pull.js" >nul
copy /y "%PROJ%README.md" "%SERVER%\README.md" >nul
copy /y "%PROJ%CHANGELOG.md" "%SERVER%\CHANGELOG.md" >nul
for %%B in (更新仓库.bat 深度更新仓库.bat 推送.bat 拉取.bat 一键更新.bat 运行网站.bat) do copy /y "%PROJ%%%B" "%SERVER%\%%B" >nul

echo [3/6] Sync version from package.json (single source of truth) ...
node -e "console.log(require('./package.json').version)" > "%TEMP%\fpkver.txt" 2>nul
set /p VERSION=<"%TEMP%\fpkver.txt"
set "VERSION=%VERSION: =%"
if not defined VERSION (
  echo  Could not read version from package.json
  goto fail
)
echo  version = %VERSION%
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=Get-Content 'fnos\fndepot\manifest' -Encoding UTF8 -Raw; $c=$c -replace '(?m)^(version\s*=\s*).*', ('${1}' + '%VERSION%'); [IO.File]::WriteAllText('fnos\fndepot\manifest', $c, [System.Text.UTF8Encoding]::new($false))"

echo [3b/6] Sync display_name from package.json name (single source of truth) ...
node -e "console.log(require('./package.json').name)" > "%TEMP%\fpkname.txt" 2>nul
set /p APPDISP=<"%TEMP%\fpkname.txt"
set "APPDISP=%APPDISP: =%"
if not defined APPDISP (
  echo  Could not read name from package.json
  goto fail
)
echo  display_name = %APPDISP%
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=Get-Content 'fnos\fndepot\manifest' -Encoding UTF8 -Raw; $c=$c -replace '(?m)^(display_name\s*=\s*).*', ('${1}' + '%APPDISP%'); [IO.File]::WriteAllText('fnos\fndepot\manifest', $c, [System.Text.UTF8Encoding]::new($false))"

echo [3c/6] Ensure cmd/* lifecycle scripts are executable (requires Git Bash chmod) ...
set "CHMOD="
if exist "C:\Program Files\Git\usr\bin\chmod.exe" set "CHMOD=C:\Program Files\Git\usr\bin\chmod.exe"
if not defined CHMOD if exist "C:\Program Files (x86)\Git\usr\bin\chmod.exe" set "CHMOD=C:\Program Files (x86)\Git\usr\bin\chmod.exe"
if defined CHMOD (
  "%CHMOD%" -R 755 "%PKG%\cmd" >nul 2>&1
  echo  chmod +x applied to cmd scripts
) else (
  echo  Git Bash chmod not found; relying on fnpack to set permissions
)

echo [4/6] Normalize newlines to LF in pkg text files ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$cr=[char]13; $enc=[System.Text.UTF8Encoding]::new($false); Get-ChildItem '%PKG%' -Recurse -File | Where-Object { $_.Extension -notmatch '\.(png|fpk|zip|gz)$' } | ForEach-Object { $b=[IO.File]::ReadAllBytes($_.FullName); $hasBom=$b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF; $c=[IO.File]::ReadAllText($_.FullName); if ($hasBom -or $c.Contains($cr)) { [IO.File]::WriteAllText($_.FullName, $c.Replace([string]$cr, ''), $enc) } }"
if errorlevel 1 goto fail

echo [5/6] Locate fnpack ...
set "FNPACK="
if exist "%TOOLS%\fnpack.exe" set "FNPACK=%TOOLS%\fnpack.exe"
if not defined FNPACK if exist "%PROJ%fnpack.exe" set "FNPACK=%PROJ%fnpack.exe"
if not defined FNPACK for %%I in (fnpack.exe) do if not "%%~$PATH:I"=="" set "FNPACK=%%~$PATH:I"
if not defined FNPACK goto nofnpack
echo  using %FNPACK%

echo [6/6] fnpack build + rename ...
pushd "%PKG%"
"%FNPACK%" build
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" goto fail

echo Read appname from manifest ...
node -e "const fs=require('fs');const t=fs.readFileSync('fnos/fndepot/manifest','utf8');const m=t.match(/^appname\s*=\s*(.+)$/m);process.stdout.write(m?m[1].trim():'')" > "%TEMP%\fpkapp.txt" 2>nul
set /p APPNAME=<"%TEMP%\fpkapp.txt"
if not defined APPNAME (
  echo  Could not read appname from manifest
  goto fail
)
echo  appname = %APPNAME%
set "RAW=%PKG%\%APPNAME%.fpk"
if not exist "%RAW%" goto fail
if not exist "%OUTDIR%" mkdir "%OUTDIR%"
set "OUT=%OUTDIR%\%APPNAME%-%VERSION%.fpk"
move /y "%RAW%" "%OUT%" >nul || goto fail

echo.
echo === Done: %OUT% ===
echo  Install: upload it in the fnOS App Center, or over SSH run:
echo  appcenter-cli install-fpk "%OUT%"
echo.
goto endok

:nofnpack
echo.
echo fnpack.exe not found.
echo Download the Windows x86 build from https://developer.fnnas.com/docs/cli/fnpack/
echo Rename to fnpack.exe and put it in: %TOOLS%
goto end

:fail
echo.
echo Build FAILED. See output above.

:endok
if not defined PACKAGE_ALL (
  echo.
  echo window closes in:
  for /l %%n in (5,-1,1) do (echo %%n & timeout /t 1 /nobreak >nul)
)
exit /b 0

:end
if not defined PACKAGE_ALL (
  echo.
  echo window closes in:
  for /l %%n in (5,-1,1) do (echo %%n & timeout /t 1 /nobreak >nul)
)
exit /b 1

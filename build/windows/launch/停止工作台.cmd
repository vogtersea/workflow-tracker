@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
"runtime\node.exe" "launch\launcher.js" --stop
echo.
pause
endlocal

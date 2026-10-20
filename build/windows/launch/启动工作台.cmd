@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 工作流程跟踪工作台

if not exist "runtime\node.exe" (
  echo.
  echo [错误] 缺少 runtime\node.exe，安装不完整。
  echo 请重新解压完整的压缩包，或重新运行安装程序。
  echo.
  pause
  exit /b 1
)

"runtime\node.exe" "launch\launcher.js" %*

if errorlevel 1 (
  echo.
  echo 启动未成功，请根据上方提示排查。
  echo.
  pause
)
endlocal

# 工作流程跟踪工作台 · 卸载
# 只删除程序文件与快捷方式，data 目录（数据库）一律保留，
# 需要清空数据请自行删除 data 目录。

$ErrorActionPreference = 'Continue'

$appName = '工作流程跟踪工作台'
$target  = Split-Path -Parent $PSScriptRoot   # <安装目录>\launch -> <安装目录>
$dataDir = Join-Path $target 'data'

Write-Host ''
Write-Host "== $appName · 卸载 ==" -ForegroundColor Cyan
Write-Host "  安装目录：$target"

$answer = Read-Host '  确认卸载？(Y/N)'
if ($answer -notmatch '^[Yy]') {
    Write-Host '  已取消。'
    exit 0
}

# 1. 停止服务
$nodeExe  = Join-Path $target 'runtime\node.exe'
$launcher = Join-Path $target 'launch\launcher.js'
if ((Test-Path $nodeExe) -and (Test-Path $launcher)) {
    & $nodeExe $launcher --stop 2>$null | Out-Null
}

# 2. 删除快捷方式
$startDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$appName"
if (Test-Path $startDir) { Remove-Item -LiteralPath $startDir -Recurse -Force }
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$appName.lnk"
if (Test-Path $desktopLnk) { Remove-Item -LiteralPath $desktopLnk -Force }

# 3. 清理注册表
Remove-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WorkflowTracker' -Recurse -Force -ErrorAction SilentlyContinue
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'WorkflowTracker' -ErrorAction SilentlyContinue

# 4. 删除程序文件（保留 data），交给独立进程延时执行，避免占用自身
$keep = $dataDir.TrimEnd('\')
$script = @"
@echo off
timeout /t 2 /nobreak >nul
for /d %%D in ("$target\*") do (
  if /I not "%%~fD"=="$keep" rd /s /q "%%~fD" 2>nul
)
for %%F in ("$target\*") do del /f /q "%%F" 2>nul
exit
"@
$tmp = Join-Path $env:TEMP 'wt-uninstall.cmd'
Set-Content -LiteralPath $tmp -Value $script -Encoding ASCII
Start-Process -FilePath $env:ComSpec -ArgumentList '/c', "`"$tmp`"" -WindowStyle Hidden

Write-Host ''
Write-Host '  已卸载。' -ForegroundColor Green
Write-Host "  数据目录保留在：$dataDir"
Write-Host '  如确认不再需要，可手动删除该目录。'
Write-Host ''

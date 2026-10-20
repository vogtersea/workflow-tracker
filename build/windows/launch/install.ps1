# 工作流程跟踪工作台 · 安装到本机
# 以当前用户身份安装，不需要管理员权限。
# 安装位置：%LOCALAPPDATA%\Programs\WorkflowTracker
#
# 参数：
#   -NoDesktop  不创建桌面快捷方式
#   -AutoStart  设置为开机自动启动（后台运行，不弹浏览器）

param(
    [switch]$NoDesktop,
    [switch]$AutoStart
)

$ErrorActionPreference = 'Stop'

$pkgRoot = Split-Path -Parent $PSScriptRoot
$target  = Join-Path $env:LOCALAPPDATA 'Programs\WorkflowTracker'
$appName = '工作流程跟踪工作台'

Write-Host ''
Write-Host "== $appName · 安装到本机 ==" -ForegroundColor Cyan
Write-Host "  源目录：$pkgRoot"
Write-Host "  安装到：$target"
Write-Host ''

if ($pkgRoot.TrimEnd('\') -eq $target.TrimEnd('\')) {
    Write-Host '  当前已在安装目录中运行，无需重复安装。' -ForegroundColor Yellow
    exit 0
}

$nodeExe  = Join-Path $target 'runtime\node.exe'
$launcher = Join-Path $target 'launch\launcher.js'
$srcNode  = Join-Path $pkgRoot 'runtime\node.exe'
$srcInit  = Join-Path $pkgRoot 'launch\launcher.js'

if (-not (Test-Path $srcNode) -or -not (Test-Path $srcInit)) {
    throw '安装包不完整：缺少 runtime\node.exe 或 launch\launcher.js。'
}

# 1. 若该目录已有实例在运行，先停掉，避免文件占用
if ((Test-Path $nodeExe) -and (Test-Path $launcher)) {
    & $nodeExe $launcher --stop 2>$null | Out-Null
}

# 2. 复制文件（排除 data，避免覆盖既有数据）
Write-Host '  复制程序文件…'
New-Item -ItemType Directory -Path $target -Force | Out-Null
$exclude = Join-Path $pkgRoot 'data'
& robocopy.exe $pkgRoot $target /E /XD $exclude /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) {
    throw "文件复制失败（robocopy 退出码 $LASTEXITCODE）。请确认没有杀毒软件拦截。"
}

# 3. 创建快捷方式
$shell = New-Object -ComObject WScript.Shell
function New-Lnk {
    param($LnkPath, $CmdPath, $Icon)
    $sc = $shell.CreateShortcut($LnkPath)
    $sc.TargetPath       = $env:ComSpec
    $sc.Arguments        = '/c ""' + $CmdPath + '""'
    $sc.WorkingDirectory = $target
    $sc.IconLocation     = $Icon
    $sc.Description      = $appName
    $sc.Save()
}

$startDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$appName"
New-Item -ItemType Directory -Path $startDir -Force | Out-Null

New-Lnk (Join-Path $startDir "$appName.lnk")        (Join-Path $target '启动工作台.cmd') $nodeExe
New-Lnk (Join-Path $startDir '停止工作台.lnk')       (Join-Path $target '停止工作台.cmd') $nodeExe
New-Lnk (Join-Path $startDir '查看运行状态.lnk')     (Join-Path $target '查看状态.cmd')   $nodeExe
New-Lnk (Join-Path $startDir '卸载工作台.lnk')       (Join-Path $target 'launch\卸载.cmd') $nodeExe

if (-not $NoDesktop) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    New-Lnk (Join-Path $desktop "$appName.lnk") (Join-Path $target '启动工作台.cmd') $nodeExe
    Write-Host '  已创建桌面快捷方式'
}

# 4. 注册到「应用和功能」，便于常规卸载
$reg = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WorkflowTracker'
New-Item -Path $reg -Force | Out-Null
$ver = '1.0.0'
$appPkg = Join-Path $target 'app\package.json'
if (Test-Path $appPkg) {
    try { $ver = (Get-Content $appPkg -Raw | ConvertFrom-Json).version } catch { }
}
Set-ItemProperty -Path $reg -Name 'DisplayName'     -Value $appName
Set-ItemProperty -Path $reg -Name 'DisplayVersion'  -Value $ver
Set-ItemProperty -Path $reg -Name 'Publisher'       -Value '本地部署'
Set-ItemProperty -Path $reg -Name 'InstallLocation' -Value $target
Set-ItemProperty -Path $reg -Name 'DisplayIcon'     -Value $nodeExe
Set-ItemProperty -Path $reg -Name 'UninstallString' -Value ('"' + $env:ComSpec + '" /c ""' + (Join-Path $target 'launch\卸载.cmd') + '""')
Set-ItemProperty -Path $reg -Name 'NoModify'        -Value 1 -Type DWord
Set-ItemProperty -Path $reg -Name 'NoRepair'        -Value 1 -Type DWord

# 5. 可选：开机自启（后台运行、不弹浏览器）
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if ($AutoStart) {
    $value = '"' + $nodeExe + '" "' + $launcher + '" --daemon --no-open'
    Set-ItemProperty -Path $runKey -Name 'WorkflowTracker' -Value $value
    Write-Host '  已设置为开机自动启动'
}

Write-Host ''
Write-Host '  安装完成。' -ForegroundColor Green
Write-Host ''
Write-Host "  从开始菜单或桌面双击「$appName」即可启动。"
Write-Host "  数据目录：$target\data"
Write-Host '  卸载：开始菜单 →「卸载工作台」，或 设置 → 应用 中找到本程序。'
Write-Host ''

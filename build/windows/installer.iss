; 工作流程跟踪工作台 · Inno Setup 安装包配置
;
; 由 build-windows.mjs 通过命令行宏传入路径与版本：
;   ISCC.exe /DAppVersion=1.0.0 /DSourceDir=<产物目录> /DOutputDir=<输出目录> installer.iss
;
; 也可手工编译：先构建产物目录，再用 Inno Setup Compiler 打开本文件。
;
; 设计要点：
;   1. PrivilegesRequired=lowest —— 按当前用户安装，不弹 UAC，
;      装到 %LOCALAPPDATA%\Programs，避免 Program Files 的写权限问题。
;   2. 不打包 data 目录 —— 数据库属于用户数据，升级安装时必须保留。
;   3. 卸载默认只删程序文件，data 目录原样保留。

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\outputs\win-dist\工作流程跟踪工作台-win-x64"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\outputs\win-dist\installer-out"
#endif

[Setup]
AppId={{9A2F5C71-3D48-4E1B-9C65-1B7E4C0A8D32}
AppName=工作流程跟踪工作台
AppVersion={#AppVersion}
AppVerName=工作流程跟踪工作台 {#AppVersion}
AppPublisher=本地部署
AppPublisherURL=
DefaultDirName={localappdata}\Programs\WorkflowTracker
DefaultGroupName=工作流程跟踪工作台
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=WorkflowTracker-Setup-{#AppVersion}
SetupIconFile=
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName=工作流程跟踪工作台
UninstallDisplayIcon={app}\runtime\node.exe
CloseApplications=yes
RestartApplications=no
AllowNoIcons=yes
ShowLanguageDialog=no

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："
Name: "autostart"; Description: "开机自动启动（后台运行，不弹浏览器）"; GroupDescription: "附加任务："; Flags: unchecked

[Files]
; 排除 data：数据库由程序自己创建，升级时不能覆盖
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "data\*,data"

[Dirs]
Name: "{app}\data"; Permissions: users-modify

[Icons]
Name: "{group}\启动工作台"; Filename: "{cmd}"; Parameters: "/c ""{app}\启动工作台.cmd"""; WorkingDir: "{app}"; IconFilename: "{app}\runtime\node.exe"
Name: "{group}\停止工作台"; Filename: "{cmd}"; Parameters: "/c ""{app}\停止工作台.cmd"""; WorkingDir: "{app}"; IconFilename: "{app}\runtime\node.exe"
Name: "{group}\查看运行状态"; Filename: "{cmd}"; Parameters: "/c ""{app}\查看状态.cmd"""; WorkingDir: "{app}"; IconFilename: "{app}\runtime\node.exe"
Name: "{group}\使用说明"; Filename: "{app}\使用说明.txt"
Name: "{group}\卸载工作台"; Filename: "{uninstallexe}"
Name: "{autodesktop}\工作流程跟踪工作台"; Filename: "{cmd}"; Parameters: "/c ""{app}\启动工作台.cmd"""; WorkingDir: "{app}"; IconFilename: "{app}\runtime\node.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "WorkflowTracker"; ValueData: """{app}\runtime\node.exe"" ""{app}\launch\launcher.js"" --daemon --no-open"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{cmd}"; Parameters: "/c ""{app}\启动工作台.cmd"""; WorkingDir: "{app}"; Description: "立即启动工作流程跟踪工作台"; Flags: postinstall nowait skipifsilent

[UninstallRun]
; 卸载前先停掉可能还在运行的服务
Filename: "{app}\runtime\node.exe"; Parameters: """{app}\launch\launcher.js"" --stop"; Flags: runhidden; RunOnceId: "StopServer"

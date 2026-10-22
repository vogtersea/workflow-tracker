; 工作流程跟踪工作台 · 桌面版安装包配置
;
; 由 build-desktop.mjs 调用 ISCC 编译：
;   ISCC.exe /DAppVersion=1.0.1 /DSourceDir=<打包后的程序目录> /DOutputDir=<输出目录> installer-desktop.iss

#ifndef AppVersion
  #define AppVersion "1.0.1"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\outputs\win-dist\desktop\WorkflowTracker-win32-x64"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\outputs\win-dist\installer-out"
#endif

[Setup]
AppId={{C41B7E96-8A2D-47F3-9E15-6D2A5C0B7314}
AppName=工作流程跟踪工作台
AppVersion={#AppVersion}
AppVerName=工作流程跟踪工作台 {#AppVersion}
AppPublisher=本地部署
DefaultDirName={localappdata}\Programs\WorkflowTracker
DefaultGroupName=工作流程跟踪工作台
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=WorkflowTracker-Desktop-Setup-{#AppVersion}
SetupIconFile=..\desktop\icon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName=工作流程跟踪工作台
UninstallDisplayIcon={app}\WorkflowTracker.exe
CloseApplications=yes
RestartApplications=no
AllowNoIcons=yes
ShowLanguageDialog=no

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\工作流程跟踪工作台"; Filename: "{app}\WorkflowTracker.exe"; WorkingDir: "{app}"; IconFilename: "{app}\WorkflowTracker.exe"
Name: "{group}\使用说明"; Filename: "{app}\使用说明.txt"
Name: "{group}\卸载工作台"; Filename: "{uninstallexe}"
Name: "{autodesktop}\工作流程跟踪工作台"; Filename: "{app}\WorkflowTracker.exe"; WorkingDir: "{app}"; IconFilename: "{app}\WorkflowTracker.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\WorkflowTracker.exe"; Description: "立即启动工作流程跟踪工作台"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/c taskkill /IM WorkflowTracker.exe /F"; Flags: runhidden; RunOnceId: "KillApp"

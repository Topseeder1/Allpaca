; Inno Setup installer for Allpaca — a Seedling Remix for the Spaces ecosystem.
;
; Build it through the build script so the version is derived from git:
;   powershell -ExecutionPolicy Bypass -File .\scripts\build_windows.ps1
;
; Do NOT run ISCC directly against this file for a ship build — it packages
; binaries that must already exist under ..\dist\ (the script produces them and
; stamps PKG_VERSION). Compiling from the Inno IDE is fine for iterating on the
; installer script itself; version falls back to the default below.

#define MyAppName "Allpaca"
#if GetEnv("PKG_VERSION") != ""
  #define MyAppVersion GetEnv("PKG_VERSION")
#else
  #define MyAppVersion "0.1.0"
#endif
#define MyAppPublisher "Seedling"
#define MyAppURL "https://spacesbyseedling.com/remixes"
#define MyAppExeName "allpaca app.exe"

#define MyRemixSummary "a Seedling Remix of Ollama — a bespoke, upgraded inference engine re-engineered by Seedling for the Spaces ecosystem"

[Setup]
; AppId uniquely identifies this product. It MUST NOT match Ollama's
; (44E83376-CE68-45EB-8FC1-393500EB558C). Sharing that GUID makes Windows treat
; Allpaca as the same product as Ollama — installing over Ollama becomes an
; upgrade and uninstalling Allpaca would remove Ollama.
AppId={{9F4E2B72-A813-4D6F-8B2C-E91D5A3F7C48}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
VersionInfoVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
AppComments={#MyRemixSummary}
AppCopyright={#MyAppPublisher} - {#MyAppURL}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} - A Seedling Remix of Ollama
VersionInfoProductName={#MyAppName}
ArchitecturesAllowed=x64compatible arm64
ArchitecturesInstallIn64BitMode=x64compatible arm64
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputBaseFilename="AllpacaSetup"
SetupIconFile=.\assets\app.ico
UninstallDisplayIcon={uninstallexe}
Compression=lzma2/ultra64
LZMANumBlockThreads=8
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=110
ChangesEnvironment=yes
OutputDir=..\dist\

; Optional "what is this" page shown before install, if the text file exists.
#if FileExists(".\assets\about-allpaca.txt")
InfoBeforeFile=.\assets\about-allpaca.txt
#endif

; Wizard imagery. The default Inno setup.bmp ships with Ollama's llama and
; cannot be repainted from a .iss. Only override the wizard graphics when an
; Allpaca-specific bitmap exists; otherwise Inno uses its own neutral defaults
; so the installer is never Ollama-branded. To brand the wizard, add:
;   app\assets\allpaca_setup.bmp   (small corner image)
;   app\assets\allpaca_wizard.bmp  (large left-side image)
#if FileExists(".\assets\allpaca_wizard.bmp")
WizardImageFile=.\assets\allpaca_wizard.bmp
#endif
#if FileExists(".\assets\allpaca_setup.bmp")
WizardSmallImageFile=.\assets\allpaca_setup.bmp
#endif

; Allpaca requires Windows 10 or newer for correct Unicode rendering.
MinVersion=10.0.10240

DisableDirPage=yes
DisableStartupPrompt=yes

#if GetEnv("KEY_CONTAINER")
SignTool=MySignTool
SignedUninstaller=yes
#endif

SetupMutex=AllpacaSetupMutex

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[LangOptions]
DialogFontSize=12

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
Name: "addtopath"; Description: "Add Allpaca to the PATH environment variable"; GroupDescription: "Integration:"; Flags: checkedonce

[Files]
#if FileExists("..\dist\windows-allpaca-app-amd64.exe")
Source: "..\dist\windows-allpaca-app-amd64.exe"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Check: not IsArm64(); Flags: ignoreversion 64bit; BeforeInstall: TaskKill('{#MyAppExeName}')
Source: "..\dist\windows-amd64\vc_redist.x64.exe"; DestDir: "{tmp}"; Check: not IsArm64() and vc_redist_needed(); Flags: deleteafterinstall
Source: "..\dist\windows-amd64\allpaca.exe"; DestDir: "{app}"; Check: not IsArm64(); Flags: ignoreversion 64bit; BeforeInstall: TaskKill('allpaca.exe')
Source: "..\dist\windows-amd64\lib\allpaca\*"; DestDir: "{app}\lib\allpaca\"; Check: not IsArm64(); Flags: ignoreversion 64bit recursesubdirs
#endif

#if FileExists("..\dist\windows-allpaca-app-arm64.exe")
Source: "..\dist\windows-allpaca-app-arm64.exe"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Check: IsArm64(); Flags: ignoreversion 64bit; BeforeInstall: TaskKill('{#MyAppExeName}')
#else
Source: "..\dist\windows-allpaca-app-amd64.exe"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Check: IsArm64(); Flags: ignoreversion 64bit; BeforeInstall: TaskKill('{#MyAppExeName}')
#endif

#if FileExists("..\dist\windows-arm64\allpaca.exe")
Source: "..\dist\windows-arm64\vc_redist.arm64.exe"; DestDir: "{tmp}"; Check: IsArm64() and vc_redist_needed(); Flags: deleteafterinstall
Source: "..\dist\windows-arm64\allpaca.exe"; DestDir: "{app}"; Check: IsArm64(); Flags: ignoreversion 64bit; BeforeInstall: TaskKill('allpaca.exe')
Source: "..\dist\windows-arm64\lib\allpaca\*"; DestDir: "{app}\lib\allpaca\"; Check: IsArm64(); Flags: ignoreversion 64bit recursesubdirs
#endif

Source: ".\assets\app.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{userprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[InstallDelete]
Type: files; Name: "{%LOCALAPPDATA}\Allpaca\updates"
Type: filesandordirs; Name: "{%TEMP}\allpaca*"
Type: filesandordirs; Name: "{app}\lib\allpaca"

[Run]
#if DirExists("..\dist\windows-arm64")
Filename: "{tmp}\vc_redist.arm64.exe"; Parameters: "/install /passive /norestart"; Check: IsArm64() and vc_redist_needed(); StatusMsg: "Installing VC++ Redistributables..."; Flags: waituntilterminated
#endif
#if DirExists("..\dist\windows-amd64")
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/install /passive /norestart"; Check: not IsArm64() and vc_redist_needed(); StatusMsg: "Installing VC++ Redistributables..."; Flags: waituntilterminated
#endif
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "taskkill"; Parameters: "/im ""{#MyAppExeName}"" /f /t"; Flags: runhidden
Filename: "taskkill"; Parameters: "/im ""allpaca.exe"" /f /t"; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c timeout 5"; Flags: runhidden

[UninstallDelete]
Type: filesandordirs; Name: "{%TEMP}\allpaca*"
Type: filesandordirs; Name: "{%LOCALAPPDATA}\Programs\Allpaca"
Type: filesandordirs; Name: "{userstartup}\{#MyAppName}.lnk"
; NOTE: the per-user app data directory (conversations, projects, image cache)
; is deliberately NOT deleted here. Preserved by default; the uninstaller
; offers an opt-in checkbox. Custom ALLPACA_MODELS dirs are also preserved.

[Messages]
WelcomeLabel1=Welcome to Allpaca
WelcomeLabel2=This will install Allpaca, {#MyRemixSummary}.%n%nSpaces is Seedling's ecosystem launcher; Allpaca is a Remix you can run inside it. Click Next to continue.
WizardSelectTasks=Select optional tasks
SelectTasksDesc=Choose the optional shortcuts and integrations you want.
WizardReady=Allpaca, a Seedling Remix
ReadyLabel1=%nSetup is ready to install Allpaca.%n%nReview the summary below, then click Install.
FinishedHeadingLabel=Allpaca is installed
FinishedLabelNoIcons=Allpaca has been installed. Launch it from the Start menu.
FinishedLabel=Allpaca has been installed. Launch it now, or open it from the Start menu later.

[Registry]
Root: HKCU; Subkey: "Environment"; \
    ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}"; \
    Check: NeedsAddPath('{app}'); Tasks: addtopath

Root: HKCU; Subkey: "Software\Classes\allpaca"; ValueType: string; ValueName: ""; ValueData: "URL:Allpaca Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\allpaca"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\allpaca\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Flags: uninsdeletekey

[Code]

var
  ModelsPage: TInputDirWizardPage;

procedure InitializeWizard();
var
  defaultDir: String;
begin
  ModelsPage := CreateInputDirPage(
    wpSelectTasks,
    'Model Storage Location',
    'Where should Allpaca store downloaded models?',
    'Models can be tens of gigabytes. Choose a drive with plenty of free space. You can change this later in Settings.',
    False, '');

  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'ALLPACA_MODELS', defaultDir) then
  begin
    if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'OLLAMA_MODELS', defaultDir) then
    begin
      if DirExists(GetEnv('USERPROFILE') + '\.allpaca\models') then
        defaultDir := GetEnv('USERPROFILE') + '\.allpaca\models'
      else if DirExists(GetEnv('USERPROFILE') + '\.ollama\models') then
        defaultDir := GetEnv('USERPROFILE') + '\.ollama\models'
      else
        defaultDir := GetEnv('USERPROFILE') + '\.allpaca\models';
    end;
  end;

  ModelsPage.Add('Models directory:');
  ModelsPage.Values[0] := defaultDir;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = ModelsPage.ID then
  begin
    if Trim(ModelsPage.Values[0]) = '' then
    begin
      MsgBox('Please choose a folder for model storage.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    RegWriteExpandStringValue(HKEY_CURRENT_USER, 'Environment', 'ALLPACA_MODELS', ModelsPage.Values[0]);
  end;
end;

function NeedsAddPath(Param: string): boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', OrigPath) then
  begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + ExpandConstant(Param) + ';', ';' + OrigPath + ';') = 0;
end;

const VCRTL_MIN_V1 = 14;
const VCRTL_MIN_V2 = 40;
const VCRTL_MIN_V3 = 33807;
const VCRTL_MIN_V4 = 0;

function vc_redist_needed(): Boolean;
var
  sRegKey: string;
  v1, v2, v3, v4: Cardinal;
begin
  if IsArm64() then
    sRegKey := 'SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\arm64'
  else
    sRegKey := 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64';

  if RegQueryDWordValue(HKEY_LOCAL_MACHINE, sRegKey, 'Major', v1) and
     RegQueryDWordValue(HKEY_LOCAL_MACHINE, sRegKey, 'Minor', v2) and
     RegQueryDWordValue(HKEY_LOCAL_MACHINE, sRegKey, 'Bld', v3) and
     RegQueryDWordValue(HKEY_LOCAL_MACHINE, sRegKey, 'RBld', v4) then
  begin
    Result := not (
        (v1 > VCRTL_MIN_V1) or ((v1 = VCRTL_MIN_V1) and
         ((v2 > VCRTL_MIN_V2) or ((v2 = VCRTL_MIN_V2) and
          ((v3 > VCRTL_MIN_V3) or ((v3 = VCRTL_MIN_V3) and
           (v4 >= VCRTL_MIN_V4)))))));
  end
  else
    Result := True;
end;

function GetDirSize(Path: String): Int64;
var
  FindRec: TFindRec;
  FilePath: string;
  Size: Int64;
begin
  if FindFirst(Path + '\*', FindRec) then
  begin
    Result := 0;
    try
      repeat
        if (FindRec.Name <> '.') and (FindRec.Name <> '..') then
        begin
          FilePath := Path + '\' + FindRec.Name;
          if (FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0 then
            Size := GetDirSize(FilePath)
          else
            Size := Int64(FindRec.SizeHigh) shl 32 + FindRec.SizeLow;
          Result := Result + Size;
        end;
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end
  else
    Result := -1;
end;

var
  DeleteModelsChecked: Boolean;
  ModelsDir: string;
  DeleteUserDataChecked: Boolean;
  UserDataDir: string;

procedure InitializeUninstallProgressForm();
var
  UninstallPage: TNewNotebookPage;
  UninstallButton: TNewButton;
  DeleteModelsCheckbox: TNewCheckBox;
  DeleteUserDataCheckbox: TNewCheckBox;
  OriginalPageNameLabel, OriginalPageDescriptionLabel: string;
  OriginalCancelButtonEnabled: Boolean;
  OriginalCancelButtonModalResult: Integer;
  ctrl: TWinControl;
  ModelsSize, UserDataSize: Int64;
begin
  if not UninstallSilent then
  begin
    ctrl := UninstallProgressForm.CancelButton;
    UninstallButton := TNewButton.Create(UninstallProgressForm);
    UninstallButton.Parent := UninstallProgressForm;
    UninstallButton.Left := ctrl.Left - ctrl.Width - ScaleX(10);
    UninstallButton.Top := ctrl.Top;
    UninstallButton.Width := ctrl.Width;
    UninstallButton.Height := ctrl.Height;
    UninstallButton.TabOrder := ctrl.TabOrder;
    UninstallButton.Caption := 'Uninstall';
    UninstallButton.ModalResult := mrOK;
    UninstallProgressForm.CancelButton.TabOrder := UninstallButton.TabOrder + 1;

    UninstallPage := TNewNotebookPage.Create(UninstallProgressForm);
    UninstallPage.Notebook := UninstallProgressForm.InnerNotebook;
    UninstallPage.Parent := UninstallProgressForm.InnerNotebook;
    UninstallPage.Align := alClient;
    UninstallProgressForm.InnerNotebook.ActivePage := UninstallPage;

    ctrl := UninstallProgressForm.StatusLabel;
    with TNewStaticText.Create(UninstallProgressForm) do
    begin
      Parent := UninstallPage;
      Top := ctrl.Top;
      Left := ctrl.Left;
      Width := ctrl.Width;
      Height := ctrl.Height;
      AutoSize := False;
      ShowAccelChar := False;
      Caption := '';
    end;

    if DirExists(GetEnv('USERPROFILE') + '\.allpaca\models\blobs') then
    begin
      ModelsDir := GetEnv('USERPROFILE') + '\.allpaca\models';
      ModelsSize := GetDirSize(ModelsDir);
    end;

    DeleteModelsCheckbox := TNewCheckBox.Create(UninstallProgressForm);
    DeleteModelsCheckbox.Parent := UninstallPage;
    DeleteModelsCheckbox.Top := ctrl.Top + ScaleY(30);
    DeleteModelsCheckbox.Left := ctrl.Left;
    DeleteModelsCheckbox.Width := ScaleX(400);
    if ModelsSize > 1024*1024*1024 then
      DeleteModelsCheckbox.Caption := 'Remove downloaded models (' + IntToStr(ModelsSize div (1024*1024*1024)) + ' GB)'
    else if ModelsSize > 1024*1024 then
      DeleteModelsCheckbox.Caption := 'Remove downloaded models (' + IntToStr(ModelsSize div (1024*1024)) + ' MB)'
    else
      DeleteModelsCheckbox.Caption := 'Remove downloaded models';
    DeleteModelsCheckbox.Checked := True;

    UserDataDir := GetEnv('LOCALAPPDATA') + '\Allpaca';
    DeleteUserDataCheckbox := nil;
    if DirExists(UserDataDir) then
    begin
      UserDataSize := GetDirSize(UserDataDir);
      DeleteUserDataCheckbox := TNewCheckBox.Create(UninstallProgressForm);
      DeleteUserDataCheckbox.Parent := UninstallPage;
      DeleteUserDataCheckbox.Top := DeleteModelsCheckbox.Top + ScaleY(30);
      DeleteUserDataCheckbox.Left := ctrl.Left;
      DeleteUserDataCheckbox.Width := ScaleX(400);
      if UserDataSize > 1024*1024*1024 then
        DeleteUserDataCheckbox.Caption := 'Also delete my conversations and settings (' + IntToStr(UserDataSize div (1024*1024*1024)) + ' GB)'
      else if UserDataSize > 1024*1024 then
        DeleteUserDataCheckbox.Caption := 'Also delete my conversations and settings (' + IntToStr(UserDataSize div (1024*1024)) + ' MB)'
      else if UserDataSize > 0 then
        DeleteUserDataCheckbox.Caption := 'Also delete my conversations and settings (' + IntToStr(UserDataSize div 1024) + ' KB)'
      else
        DeleteUserDataCheckbox.Caption := 'Also delete my conversations and settings';
      DeleteUserDataCheckbox.Checked := False;
    end;

    OriginalPageNameLabel := UninstallProgressForm.PageNameLabel.Caption;
    OriginalPageDescriptionLabel := UninstallProgressForm.PageDescriptionLabel.Caption;
    OriginalCancelButtonEnabled := UninstallProgressForm.CancelButton.Enabled;
    OriginalCancelButtonModalResult := UninstallProgressForm.CancelButton.ModalResult;

    UninstallProgressForm.PageNameLabel.Caption := '';
    UninstallProgressForm.PageDescriptionLabel.Caption := '';
    UninstallProgressForm.CancelButton.Enabled := True;
    UninstallProgressForm.CancelButton.ModalResult := mrCancel;

    if UninstallProgressForm.ShowModal = mrCancel then Abort;

    UninstallButton.Visible := False;
    UninstallProgressForm.PageNameLabel.Caption := OriginalPageNameLabel;
    UninstallProgressForm.PageDescriptionLabel.Caption := OriginalPageDescriptionLabel;
    UninstallProgressForm.CancelButton.Enabled := OriginalCancelButtonEnabled;
    UninstallProgressForm.CancelButton.ModalResult := OriginalCancelButtonModalResult;

    UninstallProgressForm.InnerNotebook.ActivePage := UninstallProgressForm.InstallingPage;

    DeleteModelsChecked := DeleteModelsCheckbox.Checked;
    if DeleteUserDataCheckbox <> nil then
      DeleteUserDataChecked := DeleteUserDataCheckbox.Checked
    else
      DeleteUserDataChecked := False;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usDone then
  begin
    if DeleteModelsChecked then
    begin
      Log('user requested model cleanup');
      if VarIsEmpty(ModelsDir) then
        DelTree(GetEnv('USERPROFILE') + '\.allpaca\models', True, True, True)
      else
      begin
        DelTree(ModelsDir + '\blobs', True, True, True);
        DelTree(ModelsDir + '\manifests', True, True, True);
      end;
    end
    else
      Log('user requested to preserve model dir');

    if DeleteUserDataChecked then
    begin
      Log('user requested deletion of conversations and settings');
      DelTree(GetEnv('LOCALAPPDATA') + '\Allpaca', True, True, True);
    end
    else
      Log('preserving conversations and settings at ' + GetEnv('LOCALAPPDATA') + '\Allpaca');
  end;
end;

procedure TaskKill(FileName: String);
var
  ResultCode: Integer;
begin
  Exec('taskkill.exe', '/f /im ' + '"' + FileName + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
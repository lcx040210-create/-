@echo off
setlocal
cd /d "%~dp0"
set CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
set FW=C:\Windows\Microsoft.NET\Framework64\v4.0.30319

"%CSC%" /nologo /target:winexe /out:OneClickAntivirus.exe /win32manifest:app.manifest ^
  /r:"%FW%\System.dll" ^
  /r:"%FW%\System.Core.dll" ^
  /r:"%FW%\System.Drawing.dll" ^
  /r:"%FW%\System.Windows.Forms.dll" ^
  Program.cs MainForm.cs DefenderScanner.cs DiskCleaner.cs

if %errorlevel% neq 0 ( echo BUILD FAILED & exit /b 1 )
echo BUILD OK: OneClickAntivirus.exe

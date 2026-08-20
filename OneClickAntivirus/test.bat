@echo off
setlocal
cd /d "%~dp0"
set CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
set FW=C:\Windows\Microsoft.NET\Framework64\v4.0.30319

"%CSC%" /nologo /target:exe /out:RunTests.exe ^
  /r:"%FW%\System.dll" ^
  /r:"%FW%\System.Core.dll" ^
  DefenderScanner.cs Tests.cs

if %errorlevel% neq 0 ( echo TEST BUILD FAILED & exit /b 1 )
.\RunTests.exe
if %errorlevel% neq 0 ( echo TESTS FAILED & exit /b 1 )
echo TESTS PASSED

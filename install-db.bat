@echo off
echo Avoqado POS Database Installer
echo.

:: Check for admin rights and elevate if needed
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if %errorlevel% neq 0 (
    echo Requesting administrative privileges...
    powershell -Command "Start-Process cmd -ArgumentList '/c cd /d \"%~dp0\" && %~nx0' -Verb RunAs"
    exit /b
)

echo Administrative privileges confirmed.
echo.

:: Check for Node.js
node --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo Node.js is not installed or not in PATH.
  echo Please install Node.js and try again.
  pause
  exit /b 1
)

:: Install required packages if not already installed
if not exist "node_modules\dotenv" (
  echo Installing required dependencies...
  npm install dotenv mssql
  if %ERRORLEVEL% NEQ 0 (
    echo Failed to install required dependencies.
    pause
    exit /b 1
  )
)

:: Run the database installer script
echo Running database installer...
node src/installer/install-db.cjs
if %ERRORLEVEL% NEQ 0 (
  echo Database installation failed.
  pause
  exit /b 1
)

echo.
echo Database installation completed.
pause 
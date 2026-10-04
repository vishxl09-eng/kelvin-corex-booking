@echo off
title Kelvin Corex Appointment System
cd /d "%~dp0"
echo.
echo ==========================================
echo       KELVIN COREX APPOINTMENT SYSTEM
echo ==========================================
echo.
if not exist node_modules (
  echo Installing required packages...
  call npm install
  if errorlevel 1 (
    echo.
    echo Installation failed.
    pause
    exit /b 1
  )
)
echo Starting website...
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
npm start
pause

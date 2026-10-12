@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title VoiceChat-Local-Server

echo ========================================================
echo   VoiceChat Learn Language - Local Web Server [Port 5173]
echo ========================================================
echo.

:: 1. Kiem tra va bo sung PATH cho Node.js neu can
where npm.cmd >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    if exist "%ProgramFiles%\nodejs\npm.cmd" set "PATH=%ProgramFiles%\nodejs;!PATH!"
    if exist "%ProgramFiles(x86)%\nodejs\npm.cmd" set "PATH=%ProgramFiles(x86)%\nodejs;!PATH!"
    if exist "%APPDATA%\npm\npm.cmd" set "PATH=%APPDATA%\npm;!PATH!"
    if exist "%LOCALAPPDATA%\Programs\node\npm.cmd" set "PATH=%LOCALAPPDATA%\Programs\node;!PATH!"
)

where npm.cmd >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    echo [LOI] Khong tim thay Node.js / npm tren may tinh cua ban!
    echo Vui long cai dat Node.js tu https://nodejs.org/ va thu lai.
    echo.
    pause
    exit /b 1
)

:: 2. Kiem tra xem port 5173 da co san server dang chay chua (ho tro ca IPv4 va IPv6)
netstat -ano | findstr ":5173 " | findstr "LISTENING" >nul 2>&1
if !ERRORLEVEL! EQU 0 (
    echo Server dang chay san tren cong 5173.
    echo Dang mo http://localhost:5173/ tren trinh duyet...
    start "" "http://localhost:5173/"
    ping 127.0.0.1 -n 3 >nul
    exit /b 0
)

:: 3. Khoi dong Vite dev server va tu dong mo browser
echo Dang khoi dong server va mo trinh duyet [http://localhost:5173/]...
echo (Giu cua so nay de su dung ung dung, hoac chay Stop-Local-Server.bat de tat)
echo ========================================================
echo.

call npm.cmd --workspace @voice-chat/web run dev -- --open

if !ERRORLEVEL! NEQ 0 (
    echo.
    echo ========================================================
    echo [THONG BAO] Server da dung hoac gap loi [Exit code: !ERRORLEVEL!].
    echo ========================================================
    pause
)

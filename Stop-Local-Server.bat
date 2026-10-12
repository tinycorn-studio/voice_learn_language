@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ========================================================
echo   Dang tat VoiceChat Local Web Server [Port 5173]...
echo ========================================================
echo.

set "FOUND=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    if not "%%a"=="0" (
        set "FOUND=1"
        echo Da tim thay server [PID: %%a]. Dang tat tien trinh...
        taskkill /F /T /PID %%a >nul 2>&1
    )
)

taskkill /F /FI "WINDOWTITLE eq VoiceChat-Local-Server*" >nul 2>&1

if "!FOUND!"=="1" (
    echo.
    echo ========================================================
    echo Local server tren port 5173 da duoc tat thanh cong!
    echo ========================================================
) else (
    echo.
    echo ========================================================
    echo Khong co server nao dang chay tren port 5173.
    echo ========================================================
)

ping 127.0.0.1 -n 3 >nul
exit /b 0

@echo off
title GARAM: ZERO HOUR - Tactical 5v5 FPS Launcher
color 0b

echo ========================================================
echo         GARAM: ZERO HOUR - ONE-CLICK LAUNCHER
echo ========================================================
echo.
cd /d "%~dp0"

echo [1/3] Checking dependencies...
if not exist "node_modules" (
    echo Installing node dependencies...
    call npm install
)

echo [2/3] Starting Authoritative 64-Tick Server + Client...
start "GARAM Game Server (Port 2567)" /min cmd /c "npm run dev:server"
start "GARAM Web Client (Port 3000)" /min cmd /c "npm run dev:client"

echo [3/3] Waiting for servers to initialize...
timeout /t 3 /nobreak >nul

echo Launching browser to http://localhost:3000/ ...
start http://localhost:3000/

echo.
echo ========================================================
echo    Game is running! Check your browser window.
echo    To stop the game, simply close this window.
echo ========================================================
pause
taskkill /fi "WINDOWTITLE eq GARAM Game Server*" /f /t >nul 2>&1
taskkill /fi "WINDOWTITLE eq GARAM Web Client*" /f /t >nul 2>&1

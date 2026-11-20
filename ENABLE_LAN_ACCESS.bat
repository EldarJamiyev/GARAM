@echo off
:: Self-elevate to Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process '%~dpnx0' -Verb RunAs"
    exit /b
)

echo ====================================================
echo  GARAM: ZERO HOUR -- ENABLING LAN LOCAL NETWORK ACCESS
echo ====================================================
echo.

:: 1. Allow TCP ports 3000 (Vite Web Client) and 2567 (Authoritative Game Server)
netsh advfirewall firewall delete rule name="GARAM Web Client (Port 3000)" >nul 2>&1
netsh advfirewall firewall add rule name="GARAM Web Client (Port 3000)" dir=in action=allow protocol=TCP localport=3000 profile=any

netsh advfirewall firewall delete rule name="GARAM Game Server (Port 2567)" >nul 2>&1
netsh advfirewall firewall add rule name="GARAM Game Server (Port 2567)" dir=in action=allow protocol=TCP localport=2567 profile=any

:: 2. Remove any explicit blocking rules on node.exe in AppData
powershell -Command "Get-NetFirewallRule | Where-Object { $_.Action -eq 'Block' -and ($_.DisplayName -like '*node*' -or $_.Name -like '*node*') } | Remove-NetFirewallRule" >nul 2>&1

:: 3. Allow node.exe binary explicitly across all profiles
netsh advfirewall firewall delete rule name="GARAM Node.js Runtime" >nul 2>&1
netsh advfirewall firewall add rule name="GARAM Node.js Runtime" dir=in action=allow program="%LOCALAPPDATA%\Programs\nodejs\node.exe" profile=any

:: 4. Set active Ethernet network connection to Private profile
powershell -Command "Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private" >nul 2>&1

echo [OK] Firewall configured: Ports 3000 and 2567 are now OPEN on LAN!
echo [OK] Node.js runtime unblocked!
echo.
echo LAN URL: http://10.168.195.33:3000/
echo.
timeout /t 3 >nul

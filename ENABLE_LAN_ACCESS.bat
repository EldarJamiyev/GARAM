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

:: 1. Allow TCP ports 3000 (Vite Web Client) and 2567 (Authoritative Game Server) scoped to local subnet
netsh advfirewall firewall delete rule name="GARAM Web Client (Port 3000)" >nul 2>&1
netsh advfirewall firewall add rule name="GARAM Web Client (Port 3000)" dir=in action=allow protocol=TCP localport=3000 remoteip=localsubnet profile=any

netsh advfirewall firewall delete rule name="GARAM Game Server (Port 2567)" >nul 2>&1
netsh advfirewall firewall add rule name="GARAM Game Server (Port 2567)" dir=in action=allow protocol=TCP localport=2567 remoteip=localsubnet profile=any

:: 2. Remove explicit blocking rules on node.exe in AppData
powershell -Command "Get-NetFirewallRule | Where-Object { $_.Action -eq 'Block' -and ($_.DisplayName -like '*node*' -or $_.Name -like '*node*') } | Remove-NetFirewallRule" >nul 2>&1

:: 3. Allow node.exe binary explicitly for local subnet
netsh advfirewall firewall delete rule name="GARAM Node.js Runtime" >nul 2>&1
netsh advfirewall firewall add rule name="GARAM Node.js Runtime" dir=in action=allow program="%LOCALAPPDATA%\Programs\nodejs\node.exe" remoteip=localsubnet profile=any

echo [OK] Firewall configured: Ports 3000 and 2567 are now OPEN for LocalSubnet!
echo [OK] Node.js runtime unblocked!
echo.
echo LAN URL: http://10.168.195.33:3000/
echo.
timeout /t 3 >nul

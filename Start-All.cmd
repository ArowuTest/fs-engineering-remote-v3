@echo off
set ROOT=%~dp0
start "FS Remote MCP Server" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\Start-Server.ps1"
start "FS Remote MCP Tunnel" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\Start-Tunnel.ps1"
exit /b 0
@echo off
set ROOT=%~dp0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\Copy-Actions-Key.ps1"
pause
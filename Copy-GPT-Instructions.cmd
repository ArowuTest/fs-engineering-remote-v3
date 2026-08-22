@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -LiteralPath '%~dp0agent\FS-REMOTE-DEVELOPMENT-INSTRUCTIONS.md' -Raw | Set-Clipboard"
echo FS Remote Engineering Agent instructions copied to clipboard.

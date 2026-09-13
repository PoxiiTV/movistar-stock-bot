@echo off
cd /d "%~dp0"
node --env-file=.env chat-id.js
pause

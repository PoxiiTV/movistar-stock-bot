@echo off
cd /d "%~dp0"
if exist deploy-hosting rmdir /s /q deploy-hosting
mkdir deploy-hosting
copy index.js deploy-hosting\ >nul
copy chat-id.js deploy-hosting\ >nul
copy .env deploy-hosting\ >nul
copy start.bat deploy-hosting\ >nul
copy chat-id.bat deploy-hosting\ >nul
copy README.md deploy-hosting\ >nul
echo {"hayStock":false,"avisadoSinCoincidencias":false}> deploy-hosting\state.json
echo Listo: carpeta deploy-hosting preparada.
pause

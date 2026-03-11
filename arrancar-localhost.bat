@echo off
setlocal

set "ROOT_DIR=%~dp0"
set "WEB_DIR=%ROOT_DIR%web"

if not exist "%WEB_DIR%\package.json" (
	echo No se encontro web\package.json en "%WEB_DIR%"
	echo Ejecuta este archivo desde la carpeta raiz del repo.
	pause
	exit /b 1
)

start "LEGO Localhost" cmd /k "cd /d "%WEB_DIR%" && npm run dev"

timeout /t 3 /nobreak >nul
start "" chrome --new-tab "http://localhost:3000"
if errorlevel 1 start "" "http://localhost:3000"

endlocal

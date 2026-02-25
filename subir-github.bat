@echo off
setlocal

cd /d "%~dp0"

for /f "delims=" %%i in ('git rev-parse --is-inside-work-tree 2^>nul') do set INSIDE_REPO=%%i
if /i not "%INSIDE_REPO%"=="true" (
  echo [ERROR] Esta carpeta no es un repositorio git.
  exit /b 1
)

set "COMMIT_MSG=%*"
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=update %date% %time%"

echo.
echo [1/4] Agregando cambios...
git add -A
if errorlevel 1 (
  echo [ERROR] Fallo git add.
  exit /b 1
)

git diff --cached --quiet
if %errorlevel%==0 (
  echo [INFO] No hay cambios para subir.
  exit /b 0
)

echo [2/4] Creando commit...
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
  echo [ERROR] Fallo git commit.
  exit /b 1
)

echo [3/4] Subiendo a GitHub (main)...
git push origin main
if errorlevel 1 (
  echo [ERROR] Fallo git push.
  exit /b 1
)

echo [4/4] Listo. Cambios subidos correctamente.
exit /b 0

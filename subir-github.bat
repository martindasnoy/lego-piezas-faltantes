@echo off
setlocal

cd /d "%~dp0"

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo ERROR: Esta carpeta no es un repo git.
  pause
  exit /b 1
)

set "MSG=%*"
if "%MSG%"=="" (
  set /p MSG=Mensaje de commit: 
)

if "%MSG%"=="" (
  set "MSG=update rapido"
)

echo.
echo Agregando cambios...
git add -A

git diff --cached --quiet
if not errorlevel 1 (
  echo No hay cambios para commitear.
  pause
  exit /b 0
)

echo.
echo Commit: %MSG%
git commit -m "%MSG%"
if errorlevel 1 (
  echo.
  echo ERROR: No se pudo crear el commit.
  pause
  exit /b 1
)

echo.
echo Subiendo a GitHub...
git push
if errorlevel 1 (
  echo.
  echo ERROR: No se pudo hacer push.
  pause
  exit /b 1
)

echo.
echo Listo: cambios subidos.
git status -sb
echo.
pause

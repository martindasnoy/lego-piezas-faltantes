@echo off
setlocal EnableExtensions

cd /d "%~dp0" || exit /b 1

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 exit /b 1

set "MSG=%*"
if "%MSG%"=="" (
  for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format \"yyyy-MM-dd HH:mm\""') do set "NOW=%%i"
  if not defined NOW set "NOW=%date% %time:~0,5%"
  set "MSG=auto: %NOW%"
)

git add -A

git diff --cached --quiet
if %errorlevel%==0 exit /b 0

git commit -m "%MSG%"
if errorlevel 1 exit /b 1

git push
if errorlevel 1 (
  for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
  if not defined BRANCH exit /b 1
  git push -u origin "%BRANCH%"
  if errorlevel 1 exit /b 1
)

exit /b 0

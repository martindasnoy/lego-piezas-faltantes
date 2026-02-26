@echo off
setlocal

cd /d "%~dp0"

call "%~dp0subir-github.bat" %*
exit /b %errorlevel%

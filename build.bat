@echo off
SET "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%" || exit /b
SETLOCAL ENABLEDELAYEDEXPANSION
echo Running npm install...
call npm install
if %errorlevel% neq 0 (
  echo Error installing dependencies
  pause
  exit /b %errorlevel%
)
echo npm modules install completed successfully
echo Running npm run dist...
call npm run dist
if %errorlevel% neq 0 (
  echo Error running npm run dist
  pause
  exit /b %errorlevel%
)
echo npm run dist completed successfully
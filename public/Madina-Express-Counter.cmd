@echo off
setlocal

set "chrome=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%chrome%" set "chrome=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%chrome%" set "chrome=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%chrome%" (
    echo Install Google Chrome to open the Madina Express counter.
    pause
    exit /b 1
)

start "" "%chrome%" --user-data-dir="%LOCALAPPDATA%\MadinaExpress\CounterChrome" --no-first-run --no-default-browser-check --use-system-default-printer --kiosk-printing --app="https://20.187.97.214/manage"

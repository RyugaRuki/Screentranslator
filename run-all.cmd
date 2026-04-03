@echo off
REM Simple shortcut to run the PowerShell launcher and exit
start "Screen Translator" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-all.ps1"

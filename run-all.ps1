#!/usr/bin/env pwsh
<#
Launch backend (packaged app-image) and Electron UI together.
Usage:
  .\run-all.ps1
  .\run-all.ps1 -NoElectron
  .\run-all.ps1 -NoBackend
#>

param(
    [switch]$NoBackend,
    [switch]$NoElectron,
    [string]$RootDir = $PSScriptRoot
)

$BackendDir = Join-Path $RootDir 'java-backend\dist\screen-translator-backend'
$BackendExe = Join-Path $BackendDir 'screen-translator-backend.exe'
$ElectronDir = Join-Path $RootDir 'electron-app'

Write-Host "Starting Screen Translator..."

if (-not $NoBackend) {
    if (-not (Test-Path $BackendExe)) {
        Write-Error "Backend exe not found: $BackendExe"
        exit 1
    }
    Write-Host "Starting backend..."
    $backendProc = Start-Process -FilePath $BackendExe -WorkingDirectory $BackendDir -PassThru
    Write-Host "Backend PID: $($backendProc.Id)"
}

if (-not $NoElectron) {
    if (-not (Test-Path $ElectronDir)) {
        Write-Error "Electron directory not found: $ElectronDir"
        exit 1
    }
    Write-Host "Starting Electron..."
    $electronProc = Start-Process -FilePath "npm" -ArgumentList "start" -WorkingDirectory $ElectronDir -PassThru
    Write-Host "Electron PID: $($electronProc.Id)"
}

Write-Host "Done. Use Task Manager to stop processes when needed."

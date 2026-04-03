#!/usr/bin/env pwsh
<#
PoC script để tạo runtime bằng `jlink` và đóng gói bằng `jpackage` (Windows)
Chạy từ PowerShell: `./poc_jlink.ps1`
#>

try {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
} catch {
    $scriptDir = $PSScriptRoot
}

$projectDir = (Resolve-Path (Join-Path $scriptDir '..')).Path
Write-Host "Project dir: $projectDir"

Set-Location $projectDir

# Detect mvn wrapper or mvn
$mvn = if (Test-Path (Join-Path $projectDir 'mvnw')) { Join-Path $projectDir 'mvnw' } else { 'mvn' }

Write-Host "Building project with: $mvn"
& $mvn clean package -DskipTests
if ($LASTEXITCODE -ne 0) { Write-Error "Maven build failed"; exit 1 }

# Find the produced jar
$targetDir = Join-Path $projectDir 'target'
$jar = Get-ChildItem -Path $targetDir -Filter '*.jar' | Where-Object { $_.Name -notmatch 'sources|javadoc|original' } | Select-Object -Last 1
if (-not $jar) { Write-Error "No jar found in $targetDir"; exit 1 }
$jarPath = $jar.FullName
Write-Host "Using jar: $jarPath"

# Ensure JAVA_HOME
if (-not $env:JAVA_HOME) {
    $javaPath = (& where.exe java 2>$null | Select-Object -First 1).Trim()
    if ($javaPath) {
        $env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $javaPath)
        $env:PATH = "$env:JAVA_HOME\\bin;${env:PATH}"
        Write-Host "JAVA_HOME set to $env:JAVA_HOME"
    } else {
        Write-Error "Environment variable JAVA_HOME is not set and java was not found in PATH. Please set JAVA_HOME to a JDK 17+ installation."; exit 1
    }
}

# Use jdeps to determine module dependencies
$jdeps = Join-Path $env:JAVA_HOME 'bin\jdeps.exe'
if (-not (Test-Path $jdeps)) { Write-Warning "jdeps not found at $jdeps; skipping module auto-detect"; $modules = 'java.base,java.logging' } else {
    $modules = & $jdeps --print-module-deps --ignore-missing-deps $jarPath 2>$null
}

if (-not $modules) { Write-Warning "Could not determine modules via jdeps; falling back to java.base,java.logging"; $modules = 'java.base,java.logging' }

# Ensure common modules needed by Spring Boot + Tomcat + Tess4J are present
$extraModules = @(
    'java.logging',
    'java.naming',
    'java.management',
    'java.instrument',
    'java.sql',
    'java.security.jgss',
    'java.xml',
    'jdk.unsupported'
)

$moduleList = $modules.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
$merged = @($moduleList + $extraModules) | Sort-Object -Unique
$modules = ($merged -join ',')

Write-Host "Modules to include: $modules"

# Create runtime image
$jlink = Join-Path $env:JAVA_HOME 'bin\jlink.exe'
$runtimeImage = Join-Path $projectDir 'runtime'
if (Test-Path $runtimeImage) { Remove-Item -Recurse -Force $runtimeImage }

Write-Host "Running jlink..."
& $jlink --module-path (Join-Path $env:JAVA_HOME 'jmods') --add-modules $modules --compress=2 --no-header-files --no-man-pages --strip-debug --output $runtimeImage
if ($LASTEXITCODE -ne 0) { Write-Error "jlink failed"; exit 1 }

# Run jpackage to create an app-image by default (no WiX required)
$jpackage = Join-Path $env:JAVA_HOME 'bin\jpackage.exe'
$dist = Join-Path $projectDir 'dist'
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }

Write-Host "Running jpackage..."
if (-not $env:JPACKAGE_TYPE) { $env:JPACKAGE_TYPE = 'app-image' }

$jpackageArgs = @(
    '--input', $targetDir,
    '--name', 'screen-translator-backend',
    '--main-jar', $jar.Name,
    '--main-class', 'org.springframework.boot.loader.launch.JarLauncher',
    '--runtime-image', $runtimeImage,
    '--type', $env:JPACKAGE_TYPE,
    '--dest', $dist,
    '--app-version', '1.0.0',
    '--java-options', '--enable-native-access=ALL-UNNAMED'
)

if ($env:JPACKAGE_WIN_CONSOLE -eq '1') {
    $jpackageArgs += '--win-console'
}

& $jpackage @jpackageArgs
if ($LASTEXITCODE -ne 0) { Write-Error "jpackage failed"; exit 1 }

Write-Host "Packaging complete. Output: $dist"

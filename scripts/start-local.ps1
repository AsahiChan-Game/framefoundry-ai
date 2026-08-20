$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $projectRoot ".framefoundry"
$apiScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "start-api.ps1")).Path
$apiOutLog = Join-Path $runtimeDir "api.stdout.log"
$apiErrorLog = Join-Path $runtimeDir "api.stderr.log"
$apiPort = 8766
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
Set-Location -LiteralPath $projectRoot

Write-Host "[FrameFoundry] Checking web dependencies..."
npm install
if ($LASTEXITCODE -ne 0) { throw "Failed to install web dependencies." }

Write-Host "[FrameFoundry] Starting local control API..."
& $apiScript -Port $apiPort -InstallOnly
if ($LASTEXITCODE -ne 0) { throw "Failed to prepare the control API." }

$apiProcess = Start-Process `
    -FilePath $venvPython `
    -ArgumentList @("-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", $apiPort) `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $apiOutLog `
    -RedirectStandardError $apiErrorLog `
    -PassThru

try {
    $apiProcess.Id | Set-Content -LiteralPath (Join-Path $runtimeDir "api.pid")
    Write-Host "[FrameFoundry] API PID: $($apiProcess.Id) - http://127.0.0.1:$apiPort"

    $apiReady = $false
    for ($attempt = 0; $attempt -lt 360; $attempt++) {
        if ($apiProcess.HasExited) { break }
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$apiPort/api/health" -TimeoutSec 1
            if ($health.status -eq "ok") {
                $apiReady = $true
                break
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $apiReady) {
        $errorTail = Get-Content -LiteralPath $apiErrorLog -Tail 12 -ErrorAction SilentlyContinue
        throw "Control API failed to start. $errorTail"
    }

    Write-Host "[FrameFoundry] Web console: http://127.0.0.1:3000"
    Write-Host "[FrameFoundry] Press Ctrl+C to stop the local services."
    npm run dev
}
finally {
    if (-not $apiProcess.HasExited) {
        $apiProcess.Kill()
        $apiProcess.WaitForExit()
    }
}

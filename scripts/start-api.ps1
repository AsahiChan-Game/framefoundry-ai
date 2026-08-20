param(
    [int]$Port = 8766,
    [switch]$InstallOnly
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
$dependencyStamp = Join-Path $projectRoot ".venv\.framefoundry-dependencies"
$requirementsPath = Join-Path $projectRoot "backend\requirements.txt"

Set-Location -LiteralPath $projectRoot

if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    Write-Host "[FrameFoundry] Creating Python virtual environment..."
    python -m venv (Join-Path $projectRoot ".venv")
    if ($LASTEXITCODE -ne 0) { throw "Failed to create the Python environment." }
}

$requirementsHash = (Get-FileHash -LiteralPath $requirementsPath -Algorithm SHA256).Hash
$installedHash = ""
if (Test-Path -LiteralPath $dependencyStamp -PathType Leaf) {
    $stampContent = Get-Content -LiteralPath $dependencyStamp -Raw
    if ($null -ne $stampContent) {
        $installedHash = $stampContent.Trim()
    }
}

if ($installedHash -ne $requirementsHash) {
    Write-Host "[FrameFoundry] Installing API dependencies..."
    & $venvPython -m pip install -r $requirementsPath
    if ($LASTEXITCODE -ne 0) { throw "Failed to install API dependencies." }
    $requirementsHash | Set-Content -LiteralPath $dependencyStamp
}

if ($InstallOnly) {
    Write-Host "[FrameFoundry] API environment is ready."
    return
}

Write-Host "[FrameFoundry] Control API: http://127.0.0.1:$Port"
& $venvPython -m uvicorn backend.main:app --host 127.0.0.1 --port $Port

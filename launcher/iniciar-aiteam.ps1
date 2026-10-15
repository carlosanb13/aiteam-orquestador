# Abre AITeam: arranca el servidor en segundo plano si no está en marcha y abre la app en su propia ventana.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$port = if ($env:PORT) { $env:PORT } else { 4317 }
$url = "http://localhost:$port"
$dataDir = Join-Path $root 'data'
$logFile = Join-Path $dataDir 'servidor.log'

function Test-AITeam {
    # Primero un intento de conexión rápido (el servidor escucha en 127.0.0.1); después, que responda la API.
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        if (-not $tcp.ConnectAsync('127.0.0.1', [int]$port).Wait(500)) { return $false }
    } catch {
        return $false
    } finally {
        $tcp.Dispose()
    }
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:$port/api/projects"
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Show-Error([string]$message) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($message, 'AITeam', 'OK', 'Error') | Out-Null
}

if (-not (Test-AITeam)) {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) {
        Show-Error "No se encontró Node.js. Instálalo desde https://nodejs.org (versión 22 o superior) y vuelve a intentarlo."
        exit 1
    }
    New-Item -ItemType Directory -Force $dataDir | Out-Null
    # Dependencias (motor de voz local) si aún no están instaladas, p. ej. en una copia recién descargada.
    if (-not (Test-Path (Join-Path $root 'node_modules\sherpa-onnx-node'))) {
        $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
        if ($npm) { Start-Process -FilePath $npm -ArgumentList 'install', '--omit=dev', '--no-audit', '--no-fund' -WorkingDirectory $root -WindowStyle Hidden -Wait }
    }
    # Servidor oculto; su salida queda en data\servidor.log.
    # cmd /c quita la primera y la última comilla: por eso la orden completa va envuelta en un par extra.
    $cmd = "`"`"$node`" server.js >> `"$logFile`" 2>&1`""
    Start-Process -FilePath $env:ComSpec -ArgumentList "/d /s /c $cmd" -WorkingDirectory $root -WindowStyle Hidden

    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        if (Test-AITeam) { $ready = $true; break }
    }
    if (-not $ready) {
        Show-Error "El servidor de AITeam no arrancó. Revisa el registro en:`n$logFile"
        exit 1
    }
}

# Ventana propia (modo app) con Edge, que viene con Windows; si no está, Chrome; si no, el navegador predeterminado.
$candidates = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($browser) {
    Start-Process -FilePath $browser -ArgumentList "--app=$url", '--window-size=1440,900'
    # La ventana --app usa la barra nativa de Windows; igualamos su color al encabezado oscuro de AITeam.
    try {
        Add-Type -Path (Join-Path $PSScriptRoot 'AppId.cs')
        for ($i = 0; $i -lt 20; $i++) {
            if ([AITeamAppId]::ColorWindowsTitled('AITeam', 0x001B1D1D, 0x00E7EBEC, 0x001B1D1D) -gt 0) { break }
            Start-Sleep -Milliseconds 200
        }
    } catch { # En versiones de Windows sin este atributo, la app sigue abriendo normalmente.
    }
} else {
    Start-Process $url
}

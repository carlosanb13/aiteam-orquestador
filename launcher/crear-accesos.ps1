# Crea los accesos directos de AITeam en el escritorio y en el menú Inicio.
# Uso: powershell -ExecutionPolicy Bypass -File launcher\crear-accesos.ps1
$launcher = Join-Path $PSScriptRoot 'AITeam.vbs'
$icon = Join-Path $PSScriptRoot 'aiteam.ico'
if (-not (Test-Path $icon)) { & (Join-Path $PSScriptRoot 'crear-icono.ps1') }

$shell = New-Object -ComObject WScript.Shell
$targets = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'AITeam.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'AITeam.lnk')
)
foreach ($lnkPath in $targets) {
    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
    $lnk.Arguments = "`"$launcher`""
    $lnk.WorkingDirectory = Split-Path -Parent $PSScriptRoot
    $lnk.IconLocation = "$icon,0"
    $lnk.Description = 'AITeam: tus IAs trabajando como un equipo'
    $lnk.Save()
    Write-Host "Acceso directo creado: $lnkPath"
}

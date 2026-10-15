# Crea los accesos directos de AITeam en el escritorio y en el menú Inicio, y corrige el anclado en la barra de tareas.
# Uso: powershell -ExecutionPolicy Bypass -File launcher\crear-accesos.ps1
$launcher = Join-Path $PSScriptRoot 'AITeam.vbs'
$icon = Join-Path $PSScriptRoot 'aiteam-ai.ico'
if (-not (Test-Path $icon)) { & (Join-Path $PSScriptRoot 'crear-icono.ps1') }

# Windows agrupa en la barra de tareas las ventanas y los accesos que comparten AppUserModelID.
# La ventana de AITeam la abre Edge en modo app con el ID "MSEdge.localhost_/" (Chrome usaría "Chrome.localhost_/");
# si el acceso anclado no lleva el mismo ID, aparece un icono duplicado al abrirlo.
Add-Type -Path (Join-Path $PSScriptRoot 'AppId.cs')
$appId = [AITeamAppId]::ForWindowTitled('AITeam')
if (-not $appId) {
    $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ }
    $appId = if ($edge) { 'MSEdge.localhost_/' } else { 'Chrome.localhost_/' }
}

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
    [AITeamAppId]::SetOnShortcut($lnkPath, $appId)
    Write-Host "Acceso directo creado: $lnkPath"
}

# Si ya estaba anclado a la barra de tareas, se corrige también ese acceso.
$pinned = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\AITeam.lnk'
if (Test-Path $pinned) {
    $lnk = $shell.CreateShortcut($pinned)
    $lnk.IconLocation = "$icon,0"
    $lnk.Save()
    [AITeamAppId]::SetOnShortcut($pinned, $appId)
    Write-Host "Acceso anclado actualizado: $pinned"
}
Write-Host "AppUserModelID: $appId"

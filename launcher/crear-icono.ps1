# Genera el icono de AITeam desde el símbolo AI aprobado.
# Uso: powershell -ExecutionPolicy Bypass -File launcher\crear-icono.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root 'public\logo-ai-symbol.png'

function New-AITeamBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # Recorte redondeado del símbolo original para los iconos de Windows y PWA.
    $r = $size * 0.22
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $r, $r, 180, 90)
    $path.AddArc($size - $r - 1, 0, $r, $r, 270, 90)
    $path.AddArc($size - $r - 1, $size - $r - 1, $r, $r, 0, 90)
    $path.AddArc(0, $size - $r - 1, $r, $r, 90, 90)
    $path.CloseFigure()
    $g.SetClip($path)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $source = [System.Drawing.Image]::FromFile($sourcePath)
    try {
        $g.DrawImage($source, 0, 0, $size, $size)
    } finally {
        $source.Dispose()
    }
    $g.ResetClip()
    $path.Dispose()
    $g.Dispose()
    return $bmp
}

function Get-PngBytes([int]$size) {
    $bmp = New-AITeamBitmap $size
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return , $ms.ToArray()
}

# Iconos para la app web (manifiesto).
foreach ($s in 192, 512) {
    [System.IO.File]::WriteAllBytes((Join-Path $root "public\icon-$s.png"), (Get-PngBytes $s))
}

# .ico con varias resoluciones (cada una como PNG embebido).
$sizes = 16, 24, 32, 48, 64, 128, 256
$images = foreach ($s in $sizes) { , (Get-PngBytes $s) }
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]; $len = $images[$i].Length
    $dim = if ($s -ge 256) { 0 } else { $s }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$len); $w.Write([UInt32]$offset)
    $offset += $len
}
foreach ($img in $images) { $w.Write($img) }
$w.Flush()
$iconBytes = $out.ToArray()
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'aiteam.ico'), $iconBytes)
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'aiteam-ai.ico'), $iconBytes)
Write-Host "Iconos creados en $PSScriptRoot"

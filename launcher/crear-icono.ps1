# Genera el icono de AITeam (launcher\aiteam.ico) y los iconos de la app web (public\icon-*.png).
# Uso: powershell -ExecutionPolicy Bypass -File launcher\crear-icono.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot

function New-AITeamBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # Fondo: cuadrado redondeado oscuro.
    $r = $size * 0.22
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $r, $r, 180, 90)
    $path.AddArc($size - $r - 1, 0, $r, $r, 270, 90)
    $path.AddArc($size - $r - 1, $size - $r - 1, $r, $r, 0, 90)
    $path.AddArc(0, $size - $r - 1, $r, $r, 90, 90)
    $path.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 29, 29, 27))), $path)

    # Tres IAs conectadas: Claude (naranja), ChatGPT (verde), Gemini (azul).
    $p1 = @(($size * 0.30), ($size * 0.52))
    $p2 = @(($size * 0.70), ($size * 0.32))
    $p3 = @(($size * 0.70), ($size * 0.72))
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(110, 236, 235, 231)), ([Math]::Max(1, $size * 0.035))
    $g.DrawLine($pen, [float]$p1[0], [float]$p1[1], [float]$p2[0], [float]$p2[1])
    $g.DrawLine($pen, [float]$p1[0], [float]$p1[1], [float]$p3[0], [float]$p3[1])
    $g.DrawLine($pen, [float]$p2[0], [float]$p2[1], [float]$p3[0], [float]$p3[1])
    $cr = $size * 0.15
    foreach ($c in @(@($p1, 217, 119, 87), @($p2, 16, 163, 127), @($p3, 66, 133, 244))) {
        $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, $c[1], $c[2], $c[3]))
        $g.FillEllipse($brush, [float]($c[0][0] - $cr), [float]($c[0][1] - $cr), [float](2 * $cr), [float](2 * $cr))
    }
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
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'aiteam.ico'), $out.ToArray())
Write-Host "Icono creado en $(Join-Path $PSScriptRoot 'aiteam.ico')"

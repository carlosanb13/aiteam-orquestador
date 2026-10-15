' Lanza iniciar-aiteam.ps1 sin mostrar ninguna ventana de consola.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\iniciar-aiteam.ps1"""
CreateObject("WScript.Shell").Run cmd, 0, False

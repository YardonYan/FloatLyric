Add-Type @"
using System;
using System.Runtime.InteropServices;
public class C {
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@
$p = New-Object C+POINT
[C]::GetCursorPos([ref]$p) | Out-Null
Write-Output ("CURSOR " + $p.X + "," + $p.Y)
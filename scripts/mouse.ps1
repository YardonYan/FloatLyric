param([int]$X = 0, [int]$Y = 0, [switch]$Click, [switch]$RightClick, [int]$X2 = 0, [int]$Y2 = 0, [switch]$Drag)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class M {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
"@
[M]::SetCursorPos($X, $Y) | Out-Null
Start-Sleep -Milliseconds 120
if ($Click) { [M]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [M]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) }
if ($RightClick) { [M]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [M]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero) }
if ($Drag) {
  [M]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  $steps = 12
  for ($i = 1; $i -le $steps; $i++) {
    $mx = [int]($X + ($X2 - $X) * $i / $steps)
    $my = [int]($Y + ($Y2 - $Y) * $i / $steps)
    [M]::SetCursorPos($mx, $my) | Out-Null
    Start-Sleep -Milliseconds 30
  }
  Start-Sleep -Milliseconds 80
  [M]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}
$p = New-Object M+POINT
[M]::GetCursorPos([ref]$p) | Out-Null
Write-Output ("CURSOR " + $X + "," + $Y + " click=" + $Click.IsPresent + " drag=" + $Drag.IsPresent + " actual=" + $p.X + "," + $p.Y)
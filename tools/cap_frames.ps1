Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public class Cap {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  public struct RECT { public int L; public int T; public int R; public int B; }
  public static IntPtr Strip = IntPtr.Zero;
  public static IntPtr Panel = IntPtr.Zero;
  public static void Collect(uint target) {
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      RECT r; GetWindowRect(h, out r);
      int w = r.R - r.L, ht = r.B - r.T;
      if (pid == target && IsWindowVisible(h) && w > 60) {
        if (ht >= 55 && ht <= 130 && w >= 200 && w <= 500) Strip = h;
        if (ht > 300 && w > 300) Panel = h;
      }
      return true;
    }, IntPtr.Zero);
  }
  public static void Shot(IntPtr h, string path) {
    RECT r; GetWindowRect(h, out r);
    int w = r.R - r.L, ht = r.B - r.T;
    using (var bmp = new Bitmap(w, ht))
    using (var g = Graphics.FromImage(bmp)) {
      var dc = g.GetHdc();
      PrintWindow(h, dc, 2);
      g.ReleaseHdc(dc);
      bmp.Save(path, ImageFormat.Png);
    }
  }
}
'@
$ep = (Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle.Length -gt 0 } | Select-Object -First 1).Id
if (-not $ep) { 'NO APP'; exit }
[Cap]::Collect($ep)
"strip=$([Cap]::Strip) panel=$([Cap]::Panel)"
if ([Cap]::Panel -ne [IntPtr]::Zero) { [Cap]::Shot([Cap]::Panel, "$env:TEMP\fl_panel_now.png") }
if ([Cap]::Strip -eq [IntPtr]::Zero) { 'NO STRIP'; exit }
for ($i = 0; $i -lt 90; $i++) {
  [Cap]::Shot([Cap]::Strip, ("$env:TEMP\flgif\f{0:d3}.png" -f $i))
  Start-Sleep -Milliseconds 280
}
"FRAMES: $((Get-ChildItem "$env:TEMP\flgif" -Filter *.png | Where-Object { $_.Length -gt 2000 }).Count)"

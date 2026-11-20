# FloatLyric SMTC source: a long-lived process that polls the Windows System
# Media Transport Controls and prints one JSON object per tick. This is the
# fallback playback source when the NetEase debug port is not available: any
# player that reports to Windows (QQ音乐, Spotify, browsers...) shows up here.
#
# The WinRT projection works in Windows PowerShell 5.1; the async operations
# are awaited through the generic AsTask reflection trick. One object per tick
# is written to stdout with UTF-8; Node reads it line by line.
param([string]$cmd)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, $t) {
  $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}

function Pick-Session($mgr) {
  $sessions = $mgr.GetSessions()
  if (-not $sessions -or $sessions.Count -eq 0) { return $null }
  foreach ($x in $sessions) {
    if ($x.PlaybackInfo.PlaybackStatus -eq 'Playing') { return $x }
  }
  # Nothing is playing: fall back to the first session that is not a corpse.
  foreach ($x in $sessions) {
    if ($x.PlaybackInfo.PlaybackStatus -ne 'Closed') { return $x }
  }
  return $null
}

if ($cmd) {
  # One-shot control mode: play | pause | toggle | prev | next. The parent
  # spawns this per command; playback control is rare, so a cold start is fine.
  # PowerShell 5.1 has no ternary operator, so plain ifs throughout.
  $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  $s = Pick-Session $mgr
  if (-not $s) { [Console]::Out.WriteLine('{"ok":false}'); exit }
  $playing = $s.PlaybackInfo.PlaybackStatus -eq 'Playing'
  $op = $null
  if ($cmd -eq 'play') { $op = $s.TryPlayAsync() }
  elseif ($cmd -eq 'pause') { $op = $s.TryPauseAsync() }
  elseif ($cmd -eq 'toggle') {
    if ($playing) { $op = $s.TryPauseAsync() } else { $op = $s.TryPlayAsync() }
  }
  elseif ($cmd -eq 'prev') { $op = $s.TrySkipPreviousAsync() }
  elseif ($cmd -eq 'next') { $op = $s.TrySkipNextAsync() }
  if ($null -eq $op) { [Console]::Out.WriteLine('{"ok":false}'); exit }
  $r = Await $op ([bool])
  if ($r) { [Console]::Out.WriteLine('{"ok":true}') } else { [Console]::Out.WriteLine('{"ok":false}') }
  exit
}

$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
while ($true) {
  $s = Pick-Session $mgr
  if ($s) {
    $playing = $s.PlaybackInfo.PlaybackStatus -eq 'Playing'
    $tl = $s.GetTimelineProperties()
    $pos = 0.0
    $dur = 0.0
    if ($tl) {
      $pos = $tl.Position.TotalSeconds
      $dur = $tl.EndTime.TotalSeconds
      if ($playing -and $tl.LastUpdatedTime) {
        $pos += ((Get-Date) - $tl.LastUpdatedTime).TotalSeconds
        if ($dur -gt 0 -and $pos -gt $dur) { $pos = $dur }
      }
    }
    $mp = Await ($s.GetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $title = ''
    $artist = ''
    $album = ''
    if ($mp) { $title = $mp.Title; $artist = $mp.Artist; $album = $mp.AlbumTitle }
    # Some players register a session but never fill it in (the NetEase desktop
    # client is one). Those cannot drive lyrics; report them as no-media.
    if (-not $title -and $dur -le 0) {
      [Console]::Out.WriteLine('{"ok":false,"reason":"no-media"}')
    }
    else {
      @{ ok = $true; playing = $playing; title = $title; artist = $artist; album = $album; pos = [math]::Round($pos, 3); dur = [math]::Round($dur, 3) } |
        ConvertTo-Json -Compress | Write-Output
    }
  }
  else {
    [Console]::Out.WriteLine('{"ok":false}')
  }
  Start-Sleep -Milliseconds 500
}

using System.Text.Json;
using Windows.Media.Control;

var opts = new JsonSerializerOptions { WriteIndented = false };

GlobalSystemMediaTransportControlsSessionManager mgr;
try
{
    mgr = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
}
catch (Exception ex)
{
    Console.WriteLine("SMTC_UNAVAILABLE " + ex.Message);
    return;
}

int rounds = args.Length > 0 && int.TryParse(args[0], out var r) ? r : 4;

for (int round = 0; round < rounds; round++)
{
    var sessions = mgr.GetSessions();
    Console.WriteLine($"=== round {round}  t={DateTime.Now:HH:mm:ss.fff}  sessions={sessions.Count} ===");

    foreach (var s in sessions)
    {
        string aumid = s.SourceAppUserModelId ?? "(null)";
        var tl = s.GetTimelineProperties();
        var playback = s.GetPlaybackInfo();

        string title = "(unknown)", artist = "(unknown)", album = "(unknown)";
        try
        {
            var props = await s.TryGetMediaPropertiesAsync();
            if (props != null)
            {
                title = props.Title;
                artist = props.Artist;
                album = props.AlbumTitle;
            }
        }
        catch (Exception ex) { title = "ERR:" + ex.Message; }

        var rec = new
        {
            aumid,
            title,
            artist,
            album,
            status = playback?.PlaybackStatus.ToString(),
            type = playback?.PlaybackType.ToString(),
            start = tl?.StartTime.ToString(),
            end = tl?.EndTime.ToString(),
            position = tl?.Position.ToString(),
            lastUpdated = tl?.LastUpdatedTime.ToString("HH:mm:ss.fff"),
            minSeek = tl?.MinSeekTime.ToString(),
            maxSeek = tl?.MaxSeekTime.ToString(),
            controls = playback?.Controls == null ? null : new
            {
                pause = playback.Controls.IsPauseEnabled,
                play = playback.Controls.IsPlayEnabled,
                next = playback.Controls.IsNextEnabled,
                prev = playback.Controls.IsPreviousEnabled
            }
        };
        Console.WriteLine(JsonSerializer.Serialize(rec, opts));
    }

    var cur = mgr.GetCurrentSession();
    Console.WriteLine("current=" + (cur?.SourceAppUserModelId ?? "(none)"));

    if (round < rounds - 1) await Task.Delay(2000);
}
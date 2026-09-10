using System;
using System.Net.Http;
using Newtonsoft.Json.Linq;

// Streamer.bot injects `: CPHInlineBase` itself. Don't add it here, or you'll
// get "CS1721: cannot have multiple base classes". It is useful to re-add it
// when updating the script
public class CPHInline
{
    public bool Execute()
    {
        CPH.TryGetArg("command", out string command);

        JObject status;
        try
        {
            using var http = new HttpClient {Timeout = TimeSpan.FromSeconds(2)};
            var json = http.GetAsync("http://127.0.0.1:5152/api/v1/status")
                .GetAwaiter().GetResult()
                .Content.ReadAsStringAsync()
                .GetAwaiter().GetResult();
            status = JObject.Parse(json);
        }
        catch
        {
            CPH.SendMessage("Prolink Tools doesn't seem to be running.");
            return true;
        }

        // Handle the chat command
        string message;
        switch (command?.ToLowerInvariant())
        {
            case "!trackid":
                message = FormatTrack(status["current"], "No track played yet");
                break;
            case "!lasttrack":
                message = FormatTrack(status["previous"], "No previous track");
                break;
            case "!bpm":
                message = FormatBpm(status["master"]?["status"]?["bpm"]);
                break;
            default:
                return true;
        }

        CPH.SendMessage(message);
        return true;
    }

    // Format the track message
    private string FormatTrack(JToken entry, string fallback)
    {
        var track = entry?["track"];
        if (track == null)
        {
            return fallback;
        }

        return $"{track["artist"]?.ToString()} - {track["title"]?.ToString()}";
    }

    private string FormatBpm(JToken bpm)
    {
        if (bpm == null || bpm.Type == JTokenType.Null)
        {
            return "BPM unavailable";
        }

        // Convert via the string form rather than `bpm.Value<double>()` since
        // that extension method can trip a `CS0012 IDynamicMetaObjectProvider`
        // error in Streamer.bot's compiler.
        return $"{Math.Floor(Convert.ToDouble(bpm.ToString()))} BPM";
    }
}

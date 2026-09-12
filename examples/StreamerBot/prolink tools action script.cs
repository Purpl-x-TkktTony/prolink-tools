using System;
using System.Net.Http;
using Newtonsoft.Json.Linq;

// Streamer.bot injects `: CPHInlineBase` itself. Don't add it here, or you'll
// get "CS1721: cannot have multiple base classes". It is useful to re-add it
// when updating the script
public class CPHInline
{
    private string userName;

    public bool Execute()
    {
        CPH.TryGetArg("userName", out userName);
        CPH.TryGetArg("command", out string command);
        command = command?.ToLowerInvariant();

        if (command != "!trackid" && command != "!lasttrack" && command != "!bpm")
        {
            return true;
        }

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
            CPH.SendMessage("Unable to get track data. Is Prolink Tools running? CarlSmile");
            return true;
        }

        // Handle the chat command
        string message;
        switch (command)
        {
            case "!trackid":
                message = FormatTrack(status["current"], true);
                break;
            case "!lasttrack":
                message = FormatTrack(status["previous"], false);
                break;
            case "!bpm":
                var master = status["master"] as JObject;
                var masterStatus = master?["status"] as JObject;
                message = FormatBpm(masterStatus?["bpm"]);
                break;
            default:
                return true;
        }

        CPH.SendMessage(message);
        return true;
    }

    // Format the track message
    private string FormatTrack(JToken entry, bool isCurrentTrack)
    {
        var track = (entry as JObject)?["track"] as JObject;
        if (track == null)
        {
            return isCurrentTrack
                ? "No track playing yet BigSad"
                : "No previous track DansGame";
        }

        return isCurrentTrack
            ? $"@{userName} The currently playing track is: {track["artist"]?.ToString()} - {track["title"]?.ToString()} DinoDance"
            : $"@{userName} The last played track was: {track["artist"]?.ToString()} - {track["title"]?.ToString()} DinoDance";
    }

    private string FormatBpm(JToken bpm)
    {
        if (bpm == null || bpm.Type == JTokenType.Null)
        {
            return "BPM unavailable cmonBruh";
        }

        double bpmValue = Convert.ToDouble(bpm.ToString());

        // Convert via the string form rather than `bpm.Value<double>()` since
        // that extension method can trip a `CS0012 IDynamicMetaObjectProvider`
        // error in Streamer.bot's compiler.
        return $"@{userName} We're currently jamming at: {Math.Floor(bpmValue)} BPM DinoDance";
    }
}

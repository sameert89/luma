using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;
using Luma.Server.Data;
using Luma.Server.Http;
using Microsoft.AspNetCore.WebUtilities;

namespace Luma.Server.Features.Media;

public sealed record CursorPosition(int Version, string Fingerprint, long Ticks, long Id, bool Backward);
public sealed class CursorSigner(Database database)
{
    private byte[] key = [];
    public async Task InitializeAsync(CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        key = Convert.FromHexString((await db.ExecuteScalarAsync<string>(new CommandDefinition("SELECT Value FROM ApplicationState WHERE Key='cursorKey'", cancellationToken: ct)))!);
    }
    public string Encode(string fingerprint, long ticks, long id, bool backward)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(new CursorPosition(1, Hash(fingerprint), ticks,id,backward));
        return WebEncoders.Base64UrlEncode(bytes)+"."+WebEncoders.Base64UrlEncode(HMACSHA256.HashData(key,bytes));
    }
    public CursorPosition Decode(string cursor,string fingerprint)
    {
        try
        {
            if (cursor.Length>2048) throw new FormatException();
            var parts=cursor.Split('.');
            if(parts.Length!=2) throw new FormatException();
            var bytes=WebEncoders.Base64UrlDecode(parts[0]);
            if(!CryptographicOperations.FixedTimeEquals(HMACSHA256.HashData(key,bytes),WebEncoders.Base64UrlDecode(parts[1]))) throw new FormatException();
            var value=JsonSerializer.Deserialize<CursorPosition>(bytes);
            if(value is null || value.Version!=1 || value.Id<=0 || value.Fingerprint!=Hash(fingerprint)) throw new FormatException();
            return value;
        }
        catch(Exception error) when(error is FormatException or JsonException or ArgumentException)
        { throw new ApiRequestException(400,"invalid_cursor","The page cursor does not match this query. Refresh the results."); }
    }
    private static string Hash(string value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}

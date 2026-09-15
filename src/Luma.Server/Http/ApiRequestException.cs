namespace Luma.Server.Http;

public sealed class ApiRequestException(int status, string code, string title) : Exception(title)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public static ApiRequestException Invalid(string title = "Check the request parameters.") => new(400, "invalid_request", title);
    public static ApiRequestException Missing() => new(404, "not_found", "The requested item was not found.");
}

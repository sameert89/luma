using Microsoft.AspNetCore.Mvc;

namespace Luma.Server.Http;

public sealed class ApiProblem : ProblemDetails
{
    public required string Code { get; init; }
    public required string TraceId { get; init; }
}

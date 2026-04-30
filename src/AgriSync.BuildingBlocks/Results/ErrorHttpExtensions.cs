using Microsoft.AspNetCore.Http;

namespace AgriSync.BuildingBlocks.Results;

/// <summary>
/// Bridges <see cref="Error"/> + <see cref="ErrorKind"/> to the HTTP layer
/// via <see cref="ProblemDetailsMapper"/>. Endpoints call
/// <c>result.Error.ToHttpResult()</c> instead of hand-rolling a status
/// code from string-suffix heuristics like <c>error.Code.EndsWith("NotFound")</c>.
///
/// This is the only place application-layer code reaches into ASP.NET
/// Results — keeps the BuildingBlocks → Api dependency direction clean
/// while still producing RFC 7807 ProblemDetails responses.
/// </summary>
public static class ErrorHttpExtensions
{
    public static IResult ToHttpResult(this Error error)
    {
        var problem = ProblemDetailsMapper.From(error);
        // Fully qualified — local namespace is also "Results" so the
        // unqualified `Results.Problem(...)` resolves to this namespace
        // (CS0234) without it.
        return Microsoft.AspNetCore.Http.Results.Problem(
            detail: problem.Detail,
            statusCode: problem.Status,
            title: problem.Title,
            type: problem.Type);
    }
}

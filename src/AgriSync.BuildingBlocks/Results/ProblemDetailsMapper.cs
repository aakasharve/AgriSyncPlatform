using Microsoft.AspNetCore.Mvc;

namespace AgriSync.BuildingBlocks.Results;

/// <summary>
/// Single source of truth for translating an application-layer
/// <see cref="Error"/> into an RFC 7807 <see cref="ProblemDetails"/>
/// document. Endpoint adapters call this so:
/// <list type="bullet">
/// <item>HTTP status codes match <see cref="ErrorKind"/> exactly.</item>
/// <item>The <c>type</c> URI is stable and grep-able across services.</item>
/// <item>The <c>title</c> exposes the machine-readable <see cref="Error.Code"/>.</item>
/// </list>
/// Adding a new <see cref="ErrorKind"/> requires a corresponding case
/// here; the default (<see cref="ErrorKind.Internal"/> → 500) catches
/// anything missed.
/// </summary>
public static class ProblemDetailsMapper
{
    /// <summary>
    /// Stable namespace for problem-type URIs. Kept as a constant so
    /// callers/tests can grep for it and downstream consumers can
    /// ignore the host segment.
    /// </summary>
    public const string ProblemTypeBase = "https://agrisync.app/problems";

    public static ProblemDetails From(Error error) => new()
    {
        Type = $"{ProblemTypeBase}/{error.Code}",
        Title = error.Code,
        Status = error.Kind switch
        {
            ErrorKind.Validation => 400,
            ErrorKind.Unauthenticated => 401,
            ErrorKind.Forbidden => 403,
            ErrorKind.NotFound => 404,
            ErrorKind.Conflict => 409,
            ErrorKind.Internal => 500,
            _ => 500,
        },
        Detail = error.Description,
    };
}

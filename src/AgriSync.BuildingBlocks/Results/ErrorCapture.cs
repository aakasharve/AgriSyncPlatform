using AgriSync.BuildingBlocks.Analytics;
using Microsoft.AspNetCore.Http;

namespace AgriSync.BuildingBlocks.Results;

/// <summary>
/// Records the identity of a failure on the request so
/// <c>RequestObservabilityMiddleware</c> can name it, without changing one byte
/// of what the client receives.
///
/// <para>
/// <b>Why a delegating wrapper.</b> An endpoint's error mapper has the
/// <see cref="Error"/> in hand but no <c>HttpContext</c>; the middleware has
/// the context but not the Error. <see cref="IResult.ExecuteAsync"/> is the one
/// place both exist. Wrapping an ALREADY-BUILT result and delegating to it
/// means the status code and the response body cannot change — this type does
/// not construct them.
/// </para>
///
/// <para>
/// <b>Why not collapse the 27 endpoint mappers onto one shared mapper instead.</b>
/// They do not agree, and the differences are load-bearing. Ten map by
/// <c>ErrorKind</c>; the rest map by string suffix
/// (<c>error.Code.EndsWith("NotFound")</c>). Most return
/// <c>{ error, message }</c>, two return a bare string, and nineteen answer a
/// Forbidden error with <c>Results.Forbid()</c> — no body at all.
/// <c>ShramSafal.CropCycleOverlap</c> is 400 under LogsEndpoints today and
/// would become 409 under a Kind-based mapper. APK v1.0.9 / versionCode 17 is
/// in the field and bundles its assets at build time, so it cannot be updated
/// in step with the server (<c>P11</c>). Converging those mappers is a
/// wire-contract change and belongs in its own plan with its own client story.
/// </para>
/// </summary>
public static class ErrorCapture
{
    /// <summary>
    /// Wraps <paramref name="inner"/> so that executing it also records
    /// <paramref name="error"/>'s code on <c>HttpContext.Items</c>.
    /// </summary>
    public static IResult Stamp(Error error, IResult inner)
    {
        ArgumentNullException.ThrowIfNull(error);
        ArgumentNullException.ThrowIfNull(inner);
        return new CapturedErrorResult(error, inner);
    }
}

/// <summary>
/// An <see cref="IResult"/> that stamps the error's code on the request and
/// then delegates verbatim to the result the endpoint actually built.
///
/// Public rather than private so <c>ErrorCaptureCoverageTests</c> can assert
/// that every endpoint error mapper in ShramSafal.Api returns one. That test is
/// what turns "someone added a 28th mapper and forgot to stamp it" from a
/// silent gap into a red build.
/// </summary>
public sealed class CapturedErrorResult : IResult
{
    public CapturedErrorResult(Error error, IResult inner)
    {
        Error = error;
        Inner = inner;
    }

    /// <summary>The catalogued error whose identity is being recorded.</summary>
    public Error Error { get; }

    /// <summary>The untouched result the endpoint built. Status and body come from here.</summary>
    public IResult Inner { get; }

    public Task ExecuteAsync(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        httpContext.Items[RequestObservabilityKeys.ErrorCode] = Error.Code;

        return Inner.ExecuteAsync(httpContext);
    }
}

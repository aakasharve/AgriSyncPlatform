using AgriSync.BuildingBlocks.Errors;
using Microsoft.AspNetCore.Diagnostics;

namespace AgriSync.Bootstrapper.Middleware;

public sealed class GlobalExceptionHandler(ILogger<GlobalExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        if (exception is OperationCanceledException && cancellationToken.IsCancellationRequested)
        {
            return false;
        }

        logger.LogError(exception, "Unhandled exception while processing request {Path}", httpContext.Request.Path);

        var traceId = httpContext.TraceIdentifier;
        var problemDetails = ProblemDetailsFactory.Create(exception, traceId);

        httpContext.Response.StatusCode = problemDetails.Status ?? StatusCodes.Status500InternalServerError;
        httpContext.Response.ContentType = "application/problem+json";
        await httpContext.Response.WriteAsJsonAsync(problemDetails, cancellationToken);

        return true;
    }
}

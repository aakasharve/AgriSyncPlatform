using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace AgriSync.BuildingBlocks.Errors;

public static class ProblemDetailsFactory
{
    public static ProblemDetails Create(Exception exception, string traceId)
    {
        if (exception is AppException appException)
        {
            return new ProblemDetails
            {
                Title = appException.Code,
                Detail = appException.Message,
                Status = appException.StatusCode,
                Extensions = { ["traceId"] = traceId }
            };
        }

        return new ProblemDetails
        {
            Title = "unhandled_error",
            Detail = "An unexpected error occurred.",
            Status = StatusCodes.Status500InternalServerError,
            Extensions = { ["traceId"] = traceId }
        };
    }
}

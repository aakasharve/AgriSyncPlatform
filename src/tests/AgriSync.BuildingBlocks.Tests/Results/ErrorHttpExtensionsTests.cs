using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Results;

/// <summary>
/// Sub-plan 03 bridge: <c>Error.ToHttpResult()</c> must produce an
/// <see cref="IResult"/> whose status matches the canonical
/// <see cref="ErrorKind"/> -> status mapping. Endpoints rely on this
/// instead of the legacy <c>error.Code.EndsWith("NotFound")</c>
/// string-suffix heuristic.
/// </summary>
public sealed class ErrorHttpExtensionsTests
{
    [Theory]
    [InlineData(ErrorKind.Validation, 400)]
    [InlineData(ErrorKind.Unauthenticated, 401)]
    [InlineData(ErrorKind.Forbidden, 403)]
    [InlineData(ErrorKind.NotFound, 404)]
    [InlineData(ErrorKind.Conflict, 409)]
    [InlineData(ErrorKind.Internal, 500)]
    public void ToHttpResult_yields_ProblemHttpResult_with_correct_status(ErrorKind kind, int expectedStatus)
    {
        var error = new Error("Sample.Code", "Sample description.", kind);

        var result = error.ToHttpResult();

        // 2026-08-30: the result is now wrapped so it can record the error's
        // identity on HttpContext.Items. The wrapper delegates verbatim, so
        // every assertion below is unchanged — it just reads through .Inner.
        var captured = Assert.IsType<CapturedErrorResult>(result);
        var problem = Assert.IsType<ProblemHttpResult>(captured.Inner);
        Assert.Equal(expectedStatus, problem.StatusCode);
        Assert.Equal("Sample.Code", problem.ProblemDetails.Title);
        Assert.Equal("Sample description.", problem.ProblemDetails.Detail);
        Assert.Equal($"{ProblemDetailsMapper.ProblemTypeBase}/Sample.Code", problem.ProblemDetails.Type);
    }

    [Fact]
    public void ToHttpResult_with_Validation_factory_yields_400()
    {
        var error = Error.Validation("Sample.Bad", "Field required.");
        var result = error.ToHttpResult();
        var captured = Assert.IsType<CapturedErrorResult>(result);
        var problem = Assert.IsType<ProblemHttpResult>(captured.Inner);
        Assert.Equal(400, problem.StatusCode);
    }

    [Fact]
    public async Task ToHttpResult_stashes_the_error_code_on_the_context()
    {
        var ctx = new DefaultHttpContext
        {
            Response = { Body = new MemoryStream() },
            RequestServices = new ServiceCollection()
                .AddLogging()
                .AddProblemDetails()
                .BuildServiceProvider(),
        };
        var error = Error.Conflict(
            "ShramSafal.CropCycleOverlap",
            "Crop cycle dates overlap an existing cycle on this plot.");

        await error.ToHttpResult().ExecuteAsync(ctx);

        Assert.Equal(
            "ShramSafal.CropCycleOverlap",
            ctx.Items[RequestObservabilityKeys.ErrorCode]);
        Assert.Equal(409, ctx.Response.StatusCode);
    }
}

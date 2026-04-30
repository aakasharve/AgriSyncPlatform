using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
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

        // Results.Problem returns ProblemHttpResult under the hood.
        var problem = Assert.IsType<ProblemHttpResult>(result);
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
        var problem = Assert.IsType<ProblemHttpResult>(result);
        Assert.Equal(400, problem.StatusCode);
    }
}

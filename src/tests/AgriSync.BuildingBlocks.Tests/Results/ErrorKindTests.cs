using AgriSync.BuildingBlocks.Results;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Results;

/// <summary>
/// Sub-plan 03 Task 1 — verifies the ErrorKind taxonomy exists, that the
/// existing two-arg <c>Error(Code, Description)</c> constructor still works
/// (defaulting to <see cref="ErrorKind.Internal"/>), that named factories
/// produce the right kinds, and that <c>ProblemDetailsMapper</c> maps each
/// kind to the canonical RFC 7807 status code.
///
/// This is the canary test for the rest of the sub-plan: every other
/// task assumes <c>Error</c> carries a <c>Kind</c> and that endpoints
/// can map a <c>Result.Failure</c> to a typed HTTP problem document.
/// </summary>
public sealed class ErrorKindTests
{
    [Fact]
    public void Default_kind_is_Internal()
    {
        var err = new Error("Sample.Code", "Sample description.");
        Assert.Equal(ErrorKind.Internal, err.Kind);
    }

    [Fact]
    public void Validation_factory_yields_Validation_kind()
    {
        var err = Error.Validation("Sample.BadInput", "Required field missing.");
        Assert.Equal(ErrorKind.Validation, err.Kind);
        Assert.Equal("Sample.BadInput", err.Code);
        Assert.Equal("Required field missing.", err.Description);
    }

    [Fact]
    public void NotFound_factory_yields_NotFound_kind()
    {
        var err = Error.NotFound("Farm.NotFound", "Farm not found.");
        Assert.Equal(ErrorKind.NotFound, err.Kind);
    }

    [Fact]
    public void Conflict_factory_yields_Conflict_kind()
    {
        var err = Error.Conflict("Invite.AlreadyIssued", "An active invitation is already issued.");
        Assert.Equal(ErrorKind.Conflict, err.Kind);
    }

    [Fact]
    public void Forbidden_factory_yields_Forbidden_kind()
    {
        var err = Error.Forbidden("Auth.NotOwner", "Caller is not the farm owner.");
        Assert.Equal(ErrorKind.Forbidden, err.Kind);
    }

    [Fact]
    public void Unauthenticated_factory_yields_Unauthenticated_kind()
    {
        var err = Error.Unauthenticated("Auth.Anonymous", "Sign in required.");
        Assert.Equal(ErrorKind.Unauthenticated, err.Kind);
    }

    [Fact]
    public void Internal_factory_yields_Internal_kind()
    {
        var err = Error.Internal("Storage.Unavailable", "Storage subsystem unreachable.");
        Assert.Equal(ErrorKind.Internal, err.Kind);
    }

    [Theory]
    [InlineData(ErrorKind.Validation, 400)]
    [InlineData(ErrorKind.Unauthenticated, 401)]
    [InlineData(ErrorKind.Forbidden, 403)]
    [InlineData(ErrorKind.NotFound, 404)]
    [InlineData(ErrorKind.Conflict, 409)]
    [InlineData(ErrorKind.Internal, 500)]
    public void ProblemDetailsMapper_maps_kind_to_canonical_status(ErrorKind kind, int expectedStatus)
    {
        var err = new Error("Sample.Code", "Sample description.", kind);
        var problem = ProblemDetailsMapper.From(err);
        Assert.Equal(expectedStatus, problem.Status);
        Assert.Equal("Sample.Code", problem.Title);
        Assert.Equal("Sample description.", problem.Detail);
        Assert.Equal("https://agrisync.app/problems/Sample.Code", problem.Type);
    }

    [Fact]
    public void None_sentinel_remains_available_for_back_compat()
    {
        // Existing callers use Error.None to short-circuit Result paths.
        // Sub-plan 03 must not break that.
        Assert.Equal(string.Empty, Error.None.Code);
        Assert.Equal(string.Empty, Error.None.Description);
        Assert.Equal(ErrorKind.Internal, Error.None.Kind);
    }
}

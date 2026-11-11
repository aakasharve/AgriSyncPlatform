using System.Reflection;
using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// The founder constraint behind this test (2026-08-30, spec
/// error-capture-engine, Locked decisions): a capture mechanism that has to be
/// applied by hand in many places will be applied incompletely, and the gap
/// will reappear silently.
///
/// <para>
/// ShramSafal.Api carries 27 duplicated private error mappers. They cannot be
/// collapsed into one — see the reasoning on <see cref="ErrorCapture"/> — so
/// each was wrapped instead. This test is what makes "someone added a 28th and
/// forgot" a red build rather than a silent hole in production observability.
/// </para>
///
/// <para>
/// It does NOT match on the method name: a future mapper called
/// <c>ToProblem</c> or <c>Fail</c> is caught too, because the test enumerates
/// by SIGNATURE — every static method in the assembly taking a single
/// <see cref="Error"/> and returning an
/// <see cref="Microsoft.AspNetCore.Http.IResult"/>. The inner
/// <c>MapErrorResult</c> halves are excluded by name because they are
/// deliberately unstamped: they are what the stamped entry point delegates to.
/// </para>
/// </summary>
public sealed class ErrorCaptureCoverageTests
{
    private const int KnownMapperCount = 27;

    private static IReadOnlyList<MethodInfo> ErrorMapperEntryPoints()
    {
        var assembly = Assembly.Load("ShramSafal.Api");

        return assembly
            .GetTypes()
            .SelectMany(t => t.GetMethods(
                BindingFlags.Public | BindingFlags.NonPublic |
                BindingFlags.Static | BindingFlags.DeclaredOnly))
            .Where(m => m.ReturnType == typeof(Microsoft.AspNetCore.Http.IResult))
            .Where(m =>
            {
                var ps = m.GetParameters();
                return ps.Length == 1 && ps[0].ParameterType == typeof(Error);
            })
            .Where(m => m.Name != "MapErrorResult")
            .ToList();
    }

    [Fact]
    public void The_endpoint_error_mappers_are_all_still_there()
    {
        // A drop in this number means a mapper was deleted or renamed past the
        // signature filter. Change it deliberately, never to turn a red test green.
        ErrorMapperEntryPoints().Should().HaveCount(KnownMapperCount,
            "ShramSafal.Api declared exactly 27 private Error->IResult entry points on "
            + "2026-08-30; adding or removing one is a deliberate act that must be "
            + "reviewed, not absorbed");
    }

    [Theory]
    [InlineData("Probe.NotFound", ErrorKind.NotFound)]
    [InlineData("Probe.Forbidden", ErrorKind.Forbidden)]
    [InlineData("Probe.RoleNotAllowed", ErrorKind.Forbidden)]
    [InlineData("Probe.Conflict", ErrorKind.Conflict)]
    [InlineData("Probe.Invalid", ErrorKind.Validation)]
    [InlineData("Probe.Boom", ErrorKind.Internal)]
    [InlineData("join.phone_not_verified", ErrorKind.Forbidden)]
    [InlineData("ShramSafal.WeatherProviderUnavailable", ErrorKind.Internal)]
    public void Every_endpoint_error_mapper_records_the_error_it_is_answering(
        string code, ErrorKind kind)
    {
        var probe = new Error(code, "Probe description.", kind);

        var unstamped = new List<string>();

        foreach (var mapper in ErrorMapperEntryPoints())
        {
            var produced = mapper.Invoke(null, new object?[] { probe });

            if (produced is not CapturedErrorResult)
            {
                unstamped.Add($"{mapper.DeclaringType!.FullName}.{mapper.Name}");
            }
        }

        unstamped.Should().BeEmpty(
            "an error mapper that does not stamp its Error leaves every failure it answers "
            + "recorded as 'Uncatalogued', which is the reverse-engineering problem this "
            + "plan exists to end. Wrap the body: `private static IResult "
            + "ToErrorResult(Error e) => ErrorCapture.Stamp(e, MapErrorResult(e));`");
    }
}

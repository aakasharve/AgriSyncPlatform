using User.Application.Contracts.Dtos;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// Architectural guards for Task 2.5 — secure cookie-based refresh token transport.
///
/// Rules enforced:
/// 1. User.Application assembly must NOT reference ASP.NET Core HTTP types
///    (HttpContext, CookieOptions, IResponseCookies). The cookie is a
///    transport concern that belongs exclusively in User.Api.
/// 2. The public API response body (<see cref="User.Api.Endpoints.AuthResponseBody"/>)
///    must never expose a RefreshToken property — the token travels via
///    HttpOnly cookie only.
/// 3. The cookie name literal "agrisync_refresh" must appear ONLY in
///    AuthCookieOptions.cs within the User.Api source tree to prevent
///    accidental duplication that would break browser cookie clearing.
/// </summary>
public sealed class AuthRememberedSessionRules
{
    [Fact]
    public void User_Application_assembly_must_not_reference_AspNetCore_Http_types()
    {
        // The AuthResponse DTO (User.Application.Contracts.Dtos) is the anchor for
        // the Application assembly. If any type in Application references ASP.NET
        // Core HTTP types, the layering rule is violated.
        var applicationAssembly = typeof(AuthResponse).Assembly;

        var aspNetCoreHttpReferences = applicationAssembly
            .GetReferencedAssemblies()
            .Where(a => a.Name is not null &&
                        (a.Name.StartsWith("Microsoft.AspNetCore", StringComparison.Ordinal)))
            .Select(a => a.Name!)
            .ToList();

        Assert.True(
            aspNetCoreHttpReferences.Count == 0,
            "User.Application must not reference Microsoft.AspNetCore assemblies. " +
            "HTTP transport concerns (cookies, HttpContext) belong in User.Api only. Found: "
                + string.Join(", ", aspNetCoreHttpReferences));
    }

    [Fact]
    public void AuthResponseBody_must_not_expose_RefreshToken_property()
    {
        // The serialized API response body must NEVER carry a refresh token in JSON.
        // The refresh token travels exclusively via the HttpOnly cookie set by the endpoint.
        var bodyType = typeof(User.Api.Endpoints.AuthResponseBody);

        var refreshTokenProperty = bodyType.GetProperty("RefreshToken");

        Assert.True(
            refreshTokenProperty is null,
            $"{bodyType.FullName} must not expose a RefreshToken property. " +
            "Refresh tokens are issued via the HttpOnly 'agrisync_refresh' cookie only.");
    }

    [Fact]
    public void Cookie_name_literal_appears_only_in_AuthCookieOptions_within_User_Api()
    {
        // "agrisync_refresh" is defined once in AuthCookieOptions.cs as a constant.
        // Any other file containing this literal would risk using a stale/different
        // string and break cookie clearing (browser requires exact name match).
        const string cookieLiteral = "agrisync_refresh";
        const string expectedFileName = "AuthCookieOptions.cs";

        var solutionRoot = TestPathHelper.GetSolutionRoot();
        var userApiRoot = Path.Combine(solutionRoot, "apps", "User", "User.Api");

        if (!Directory.Exists(userApiRoot))
        {
            throw new DirectoryNotFoundException($"User.Api root not found at: {userApiRoot}");
        }

        var violations = new List<string>();

        foreach (var file in Directory.EnumerateFiles(userApiRoot, "*.cs", SearchOption.AllDirectories))
        {
            if (file.Contains(Path.DirectorySeparatorChar + "obj" + Path.DirectorySeparatorChar)
                || file.Contains(Path.DirectorySeparatorChar + "bin" + Path.DirectorySeparatorChar))
            {
                continue;
            }

            if (!File.ReadAllText(file).Contains(cookieLiteral, StringComparison.Ordinal))
            {
                continue;
            }

            var fileName = Path.GetFileName(file);
            if (!string.Equals(fileName, expectedFileName, StringComparison.OrdinalIgnoreCase))
            {
                violations.Add(file);
            }
        }

        Assert.True(
            violations.Count == 0,
            $"The literal \"{cookieLiteral}\" must appear ONLY in {expectedFileName}. " +
            "Duplication risks mismatched cookie names that browsers cannot clear. Offenders:" +
                Environment.NewLine + string.Join(Environment.NewLine, violations));
    }
}

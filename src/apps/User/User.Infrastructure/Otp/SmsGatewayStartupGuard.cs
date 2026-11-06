namespace User.Infrastructure.Otp;

/// <summary>
/// Startup check that stops a Production deploy from silently running on the
/// dev SMS stub. The stub logs the OTP and reports success, so a farmer never
/// receives a code and nothing in /health looks wrong.
///
/// Messages name the missing setting only, never a value.
/// </summary>
public static class SmsGatewayStartupGuard
{
    private const string PlaceholderValue = "OVERRIDE_VIA_ENVIRONMENT_VARIABLE";

    public static void EnsureSafeForEnvironment(bool isProduction, Msg91Options options)
    {
        if (!isProduction)
        {
            return;
        }

        var problems = new List<string>();

        if (options.UseDevStub)
        {
            problems.Add("Msg91:UseDevStub is true (the dev stub sends no SMS)");
        }

        if (IsUnset(options.AuthKey))
        {
            problems.Add("Msg91:AuthKey is not set");
        }

        if (IsUnset(options.TemplateId))
        {
            problems.Add("Msg91:TemplateId is not set");
        }

        if (problems.Count == 0)
        {
            return;
        }

        throw new InvalidOperationException(
            "Production SMS gateway is not configured: " + string.Join("; ", problems) + ". " +
            "Set Msg91__UseDevStub=false, Msg91__AuthKey and Msg91__TemplateId " +
            "(see PRODUCTION_ENVIRONMENT_VARIABLES.md) before starting the API.");
    }

    private static bool IsUnset(string? value) =>
        string.IsNullOrWhiteSpace(value) ||
        string.Equals(value.Trim(), PlaceholderValue, StringComparison.Ordinal);
}

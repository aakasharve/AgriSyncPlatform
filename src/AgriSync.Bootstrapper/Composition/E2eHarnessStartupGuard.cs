namespace AgriSync.Bootstrapper.Composition;

/// <summary>
/// spec: D-184 / security audit F09 — startup check that stops a Production API from running with the E2E test harness on.
///
/// <para><c>ALLOW_E2E_SEED=true</c> opens the anonymous <c>/__e2e/*</c> control plane (reset, seed, fail-pushes: no login)
/// and lifts every rate limit to 100,000 (<see cref="RateLimitingConfig"/>). It exists for the Playwright suite and nothing
/// else. Until now the only thing keeping it out of Production was that nobody set the variable; this makes the API refuse
/// to start instead, the same way <c>SmsGatewayStartupGuard</c> refuses a Production boot on the dev SMS stub. It runs before
/// the rate limiter is registered and before any service is built.</para>
///
/// <para>The test is the SAME one the doors use (<see cref="Endpoints.E2eTestEndpoints.IsFlagOn"/>), so the guard can never
/// disagree with what would actually open. Only Production refuses; every other environment is unchanged. The message names
/// the variable only, never a value.</para>
/// </summary>
public static class E2eHarnessStartupGuard
{
    public static void EnsureSafeForEnvironment(bool isProduction, string? allowE2eSeedValue)
    {
        if (!isProduction || !Endpoints.E2eTestEndpoints.IsFlagOn(allowE2eSeedValue))
        {
            return;
        }

        throw new InvalidOperationException(
            $"{Endpoints.E2eTestEndpoints.EnvFlag} is set while the API runs in Production. That flag opens the anonymous " +
            "/__e2e reset, seed and fail-pushes endpoints and lifts every rate limit, so Production refuses to start with it. " +
            $"Remove {Endpoints.E2eTestEndpoints.EnvFlag} from the environment of the Production process " +
            "(see PRODUCTION_ENVIRONMENT_VARIABLES.md) and start the API again.");
    }
}

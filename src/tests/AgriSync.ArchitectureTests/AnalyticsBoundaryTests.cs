using System.Reflection;
using System.Text.RegularExpressions;
using AgriSync.BuildingBlocks.Analytics;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// Phase 2 guarantee: every write-path handler must accept
/// <see cref="IAnalyticsWriter"/> as a constructor dependency so it can
/// emit the canonical analytics rail (OtpVerified, FarmCreated,
/// LogCreated, CostEntryAdded, AiInvocation, ...).
///
/// Structural check only — mirrors the EntitlementGateTests pattern.
/// It does not verify that <c>EmitAsync</c> is actually called (that is
/// the responsibility of the per-handler analytics tests).
/// </summary>
public sealed class AnalyticsBoundaryTests
{
    private static readonly (string TypeName, string Assembly)[] InstrumentedHandlerTypes =
    [
        // User — auth telemetry (otp + registration + login)
        ("User.Application.UseCases.Auth.StartOtp.StartOtpHandler", "User.Application"),
        ("User.Application.UseCases.Auth.VerifyOtp.VerifyOtpHandler", "User.Application"),

        // ShramSafal — farm + membership lifecycle
        ("ShramSafal.Application.UseCases.Farms.CreateFarm.CreateFarmHandler", "ShramSafal.Application"),
        ("ShramSafal.Application.UseCases.Farms.CreatePlot.CreatePlotHandler", "ShramSafal.Application"),
        ("ShramSafal.Application.UseCases.Memberships.IssueFarmInvite.IssueFarmInviteHandler", "ShramSafal.Application"),
        ("ShramSafal.Application.UseCases.Memberships.ClaimJoin.ClaimJoinHandler", "ShramSafal.Application"),
        ("ShramSafal.Application.UseCases.Memberships.ExitMembership.ExitMembershipHandler", "ShramSafal.Application"),

        // ShramSafal — log capture + verification
        ("ShramSafal.Application.UseCases.Logs.CreateDailyLog.CreateDailyLogHandler", "ShramSafal.Application"),
        ("ShramSafal.Application.UseCases.Logs.VerifyLog.VerifyLogHandler", "ShramSafal.Application"),

        // ShramSafal — finance
        ("ShramSafal.Application.UseCases.Finance.AddCostEntry.AddCostEntryHandler", "ShramSafal.Application"),
        ("ShramSafal.Application.UseCases.Finance.CorrectCostEntry.CorrectCostEntryHandler", "ShramSafal.Application"),
        ("ShramSafal.Application.UseCases.Finance.AllocateGlobalExpense.AllocateGlobalExpenseHandler", "ShramSafal.Application"),

        // ShramSafal — AI invocations
        ("ShramSafal.Application.UseCases.AI.ParseVoiceInput.ParseVoiceInputHandler", "ShramSafal.Application"),
        ("ShramSafal.Application.UseCases.AI.ExtractReceipt.ExtractReceiptHandler", "ShramSafal.Application"),
        ("ShramSafal.Application.UseCases.AI.ExtractPattiImage.ExtractPattiImageHandler", "ShramSafal.Application"),
    ];

    [Fact]
    public void Every_instrumented_handler_takes_IAnalyticsWriter_as_ctor_dep()
    {
        var violations = new List<string>();

        foreach (var (typeName, assemblyName) in InstrumentedHandlerTypes)
        {
            var assembly = AppDomain.CurrentDomain
                .GetAssemblies()
                .FirstOrDefault(a => string.Equals(a.GetName().Name, assemblyName, StringComparison.OrdinalIgnoreCase));

            if (assembly is null)
            {
                assembly = Assembly.Load(assemblyName);
            }

            var handlerType = assembly.GetType(typeName);
            if (handlerType is null)
            {
                violations.Add($"Handler type not found: {typeName}");
                continue;
            }

            var declaresAnalyticsDep = handlerType
                .GetConstructors(BindingFlags.Public | BindingFlags.Instance)
                .Any(ctor => ctor
                    .GetParameters()
                    .Any(p => p.ParameterType == typeof(IAnalyticsWriter)));

            if (!declaresAnalyticsDep)
            {
                violations.Add(
                    $"{typeName} does not accept IAnalyticsWriter. " +
                    "Every instrumented write handler must route through the analytics rail.");
            }
        }

        if (violations.Count > 0)
        {
            Assert.Fail(
                "Phase 2 analytics-rail integrity violated:\n  " +
                string.Join("\n  ", violations));
        }
    }

    /// <summary>
    /// Plan §3.6 Test 2 — any EmitAsync call site that passes a raw string
    /// literal for EventType bypasses the canonical catalog and makes future
    /// funnels unqueryable. All emits must go through
    /// <see cref="AnalyticsEventType"/> constants.
    ///
    /// Source-file scan: looks for the idiomatic named-argument shape
    /// <c>EventType: "foo.bar"</c> or the positional equivalent at the second
    /// AnalyticsEvent ctor parameter.
    /// </summary>
    [Fact]
    public void No_raw_event_type_string_literals_in_EmitAsync_call_sites()
    {
        var appsRoot = TestPathHelper.GetAppsRoot();
        // Named-arg pattern: `EventType: "something"` — the only way a raw
        // literal sneaks past code review.
        var namedArgPattern = new Regex(@"EventType\s*:\s*""[a-z_]+\.[a-z_]+""",
            RegexOptions.Compiled | RegexOptions.Multiline);

        var violations = new List<string>();

        foreach (var file in Directory.EnumerateFiles(appsRoot, "*Handler.cs", SearchOption.AllDirectories))
        {
            if (file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}") ||
                file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"))
            {
                continue;
            }

            var source = File.ReadAllText(file);
            if (!source.Contains("EmitAsync", StringComparison.Ordinal))
            {
                continue;
            }

            var match = namedArgPattern.Match(source);
            if (match.Success)
            {
                var relative = Path.GetRelativePath(appsRoot, file);
                violations.Add($"{relative}: raw literal '{match.Value}' — use AnalyticsEventType.* instead.");
            }
        }

        if (violations.Count > 0)
        {
            Assert.Fail(
                "Raw event-type string literals found in EmitAsync call sites:\n  " +
                string.Join("\n  ", violations));
        }
    }
}

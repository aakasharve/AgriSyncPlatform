using System.Reflection;
using ShramSafal.Application.Ports;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// Phase 5 guarantee: every handler that writes to a farm-scoped
/// aggregate must accept <see cref="IEntitlementPolicy"/> as a
/// constructor dependency. The handler's body is then forced to use
/// the policy — otherwise the dep is flagged as unused by the
/// IDE/compiler warning and the field is dead code.
///
/// This is a structural test, not behavioural. A future handler that
/// takes the dep and then never calls <c>EvaluateAsync</c> would still
/// pass this test — that's what the companion integration tests cover.
/// The goal here is the lightweight compile-time gate.
/// </summary>
public sealed class EntitlementGateTests
{
    /// <summary>
    /// Farm-scoped handlers whose Application command carries a
    /// <c>FarmId</c> (or a command that resolves to a specific farm).
    /// Handlers listed here MUST have <see cref="IEntitlementPolicy"/>
    /// in their constructor. New entries are added when a new paid
    /// write handler ships; non-farm-scoped handlers (auth, price
    /// config, reference data) are deliberately absent.
    /// </summary>
    private static readonly string[] GatedHandlerTypeNames =
    {
        "ShramSafal.Application.UseCases.Logs.CreateDailyLog.CreateDailyLogHandler",
        "ShramSafal.Application.UseCases.Logs.AddLogTask.AddLogTaskHandler",
        "ShramSafal.Application.UseCases.Logs.VerifyLog.VerifyLogHandler",
        "ShramSafal.Application.UseCases.Farms.CreatePlot.CreatePlotHandler",
        "ShramSafal.Application.UseCases.CropCycles.CreateCropCycle.CreateCropCycleHandler",
        "ShramSafal.Application.UseCases.Finance.AddCostEntry.AddCostEntryHandler",
        "ShramSafal.Application.UseCases.Finance.CorrectCostEntry.CorrectCostEntryHandler",
        "ShramSafal.Application.UseCases.Finance.AllocateGlobalExpense.AllocateGlobalExpenseHandler",
    };

    [Fact]
    public void Every_gated_handler_takes_IEntitlementPolicy_as_ctor_dep()
    {
        var applicationAssembly = typeof(IEntitlementPolicy).Assembly;
        var violations = new List<string>();

        foreach (var typeName in GatedHandlerTypeNames)
        {
            var handlerType = applicationAssembly.GetType(typeName);
            if (handlerType is null)
            {
                violations.Add($"Handler type not found: {typeName}");
                continue;
            }

            // Primary constructors produce a single public constructor; we
            // check all public constructors to tolerate classic ctor styles.
            var declaresEntitlementDep = handlerType
                .GetConstructors(BindingFlags.Public | BindingFlags.Instance)
                .Any(ctor => ctor
                    .GetParameters()
                    .Any(p => p.ParameterType == typeof(IEntitlementPolicy)));

            if (!declaresEntitlementDep)
            {
                violations.Add(
                    $"{typeName} does not accept IEntitlementPolicy. " +
                    "Every farm-scoped write handler must route through the entitlement gate.");
            }
        }

        if (violations.Count > 0)
        {
            Assert.Fail(
                "Phase 5 entitlement-gate integrity violated:\n  " +
                string.Join("\n  ", violations));
        }
    }
}

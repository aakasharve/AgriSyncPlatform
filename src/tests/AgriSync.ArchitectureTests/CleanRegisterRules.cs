using System.Reflection;
using System.Text.RegularExpressions;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Labour;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// Phase 5 Task 5.3 (founder master review 2026-09-02, D4): "नावाखाली
/// कोणताही summary, कामाचा मजकूर किंवा पैशांची कळ नाही. नाव + दिवसाचे खूण
/// एवढेच." The register grid is name + seven day cells — no money in any
/// cell, no totals column of ANY kind (not days, not people, not money).
/// Supersedes D-H7's in-grid money and the WeekTotal/Total contract.
/// Money lives on the Labour home (two cards) and in tap-detail; the
/// dimensional week read lives in detail. Never-CALCULATE still binds
/// everywhere.
/// </summary>
public sealed class CleanRegisterRules
{
    private const string CleanRegister =
        "the register is name + seven day cells, nothing trailing — no money in the grid, " +
        "no totals column of any kind (founder master review 2026-09-02, D4). Money is only " +
        "ever DISPLAYED where stated (Labour home, tap-detail), never summed into the grid, " +
        "and a week is never collapsed into one number";

    /// <summary>
    /// Walks the ledger DTO's whole public property graph (within the
    /// Application assembly) so a money or total member can never hide one
    /// record deeper — e.g. on the cell record Task 4.1 introduces.
    /// Substring match on purpose: DTO members are PascalCase, so
    /// "WeekTotal" has no word boundary before "Total".
    /// </summary>
    [Fact]
    public void The_ledger_grid_contract_carries_no_money_and_no_totals()
    {
        var forbidden = new Regex("total|cost|wage|amount|money|rupee|paid",
            RegexOptions.IgnoreCase);
        var assembly = typeof(LabourLedgerDto).Assembly;
        var visited = new HashSet<Type>();
        var queue = new Queue<Type>();
        queue.Enqueue(typeof(LabourLedgerDto));
        var offenders = new List<string>();

        while (queue.Count > 0)
        {
            var type = queue.Dequeue();
            if (!visited.Add(type)) continue;

            foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (forbidden.IsMatch(property.Name))
                {
                    offenders.Add($"{type.Name}.{property.Name}");
                }

                foreach (var constituent in Constituents(property.PropertyType))
                {
                    if (constituent.Assembly == assembly) queue.Enqueue(constituent);
                }
            }
        }

        offenders.Should().BeEmpty(
            CleanRegister + $". Offenders: [{string.Join(", ", offenders)}]");
    }

    /// <summary>
    /// The week is never collapsed into one number, and
    /// <c>AttendanceMark.Value</c> is the one member that could manufacture
    /// the equivalence (Full+Night=2; Unmarked collapses to 0 against its own
    /// doc comment — Phase 0 C12). Phase 2 obsoletes it; this pins the
    /// obsoletion so no NEW reader compiles against it warning-free.
    /// </summary>
    [Fact]
    public void AttendanceMark_Value_is_obsolete_so_no_new_reader_can_collapse_a_week()
    {
        var value = typeof(AttendanceMark).GetProperty("Value");

        value.Should().NotBeNull(
            "deleting Value outright is itself a night-arithmetic decision the founder has " +
            "not made — REVISION-1 resolved obsolete-and-defer, not delete");
        value!.GetCustomAttribute<ObsoleteAttribute>().Should().NotBeNull(
            "night arithmetic is NOT decided; Value must stay out of every R1 read path, " +
            "and [Obsolete] is what makes a new consumption visible at compile time");
    }

    private static IEnumerable<Type> Constituents(Type type)
    {
        if (type.IsArray)
        {
            yield return type.GetElementType()!;
            yield break;
        }

        if (type.IsGenericType)
        {
            foreach (var argument in type.GetGenericArguments())
            {
                foreach (var constituent in Constituents(argument))
                {
                    yield return constituent;
                }
            }

            yield break;
        }

        yield return type;
    }
}

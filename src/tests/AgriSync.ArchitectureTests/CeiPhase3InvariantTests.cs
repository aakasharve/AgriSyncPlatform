using System.Reflection;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Compliance;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// Architecture tests for CEI Phase 3 invariants.
/// Enforces CEI-I6 (no insight without a suggested action) at domain and DTO boundaries.
/// </summary>
public sealed class CeiPhase3InvariantTests
{
    // CEI-I6: SuggestedAction is non-nullable on the domain entity
    [Fact]
    public void ComplianceSignal_SuggestedAction_IsNonNullable_OnDomain()
    {
        var prop = typeof(ComplianceSignal).GetProperty(nameof(ComplianceSignal.SuggestedAction))!;
        var isNullable = Nullable.GetUnderlyingType(prop.PropertyType) is not null;
        isNullable.Should().BeFalse(
            "CEI-I6: ComplianceSignal.SuggestedAction must be non-nullable — every signal carries an actionable suggestion");
    }

    // CEI-I6: SuggestedAction on the DTO is a non-nullable string
    [Fact]
    public void ComplianceSignalDto_SuggestedAction_IsNonNullable()
    {
        var prop = typeof(ComplianceSignalDto).GetProperty(nameof(ComplianceSignalDto.SuggestedAction))!;
        prop.PropertyType.Should().Be(typeof(string),
            "CEI-I6: ComplianceSignalDto.SuggestedAction must be a non-nullable string");

        // In NRT-enabled code, string? is represented by the NullableAttribute on the parameter.
        // Confirm there is NO NullableAttribute marking it as nullable.
        var nullableAttr = prop.GetCustomAttributes()
            .FirstOrDefault(a => a.GetType().Name == "NullableAttribute");
        // NullableAttribute has a byte[] Flags property; byte value 2 means nullable.
        if (nullableAttr is not null)
        {
            var flags = nullableAttr.GetType().GetField("NullableFlags")?.GetValue(nullableAttr) as byte[];
            if (flags is { Length: > 0 })
            {
                flags[0].Should().NotBe(2,
                    "CEI-I6: SuggestedAction must not be nullable string");
            }
        }
    }

    // CEI-I6: Every ComplianceRuleCode constant must have a rule in the book
    [Fact]
    public void ComplianceRuleBook_HasAtLeastOneRulePerRuleCodeConstant()
    {
        var constants = typeof(ComplianceRuleCode)
            .GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy)
            .Where(f => f.IsLiteral && !f.IsInitOnly && f.FieldType == typeof(string))
            .Select(f => (string)f.GetValue(null)!)
            .ToList();

        constants.Should().NotBeEmpty("ComplianceRuleCode must define at least one constant");

        var ruleCodes = ComplianceRuleBook.Rules.Select(r => r.RuleCode).ToHashSet();

        foreach (var code in constants)
        {
            ruleCodes.Should().Contain(code,
                $"CEI-I6: Every ComplianceRuleCode constant ('{code}') must have a matching rule in ComplianceRuleBook.Rules");
        }
    }

    // CEI-I6: ComplianceEvaluator is pure — Domain assembly must not reference Infrastructure
    [Fact]
    public void ComplianceEvaluator_IsPure_DomainAssemblyHasNoInfrastructureReference()
    {
        var assembly = typeof(ComplianceEvaluator).Assembly;

        var referencedAssemblyNames = assembly.GetReferencedAssemblies()
            .Select(a => a.Name ?? string.Empty)
            .ToList();

        referencedAssemblyNames.Should().NotContain(
            name => name.Contains("Infrastructure", StringComparison.OrdinalIgnoreCase),
            "CEI §10.1: ShramSafal.Domain must not reference Infrastructure");

        referencedAssemblyNames.Should().NotContain(
            name => name.Contains("EntityFramework", StringComparison.OrdinalIgnoreCase),
            "ComplianceEvaluator must not reference EF Core — it is a pure function in the Domain");
    }
}

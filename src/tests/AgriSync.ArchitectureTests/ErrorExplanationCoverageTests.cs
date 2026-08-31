using System.Reflection;
using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using ShramSafal.Domain.Common;
using User.Domain.Common;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// A named error without a plain-language explanation forces the next person to
/// reverse-engineer it — the exact defect spec 2026-08-30-error-capture-scope
/// exists to end. This test is the enforcement: adding an error without
/// explaining it fails the build.
///
/// It enumerates BOTH catalogues on purpose. A version reflecting over
/// ShramSafalErrors alone would have gone green at 52 of 58, leaving every
/// User-context error unexplained and unnoticed.
/// </summary>
public sealed class ErrorExplanationCoverageTests
{
    private static IReadOnlyList<Error> AllCataloguedErrors() =>
        new[] { typeof(ShramSafalErrors), typeof(UserErrors) }
            .SelectMany(t => t.GetFields(BindingFlags.Public | BindingFlags.Static))
            .Where(f => f.FieldType == typeof(Error))
            .Select(f => (Error)f.GetValue(null)!)
            .ToList();

    [Fact]
    public void The_catalogue_is_the_size_we_think_it_is()
    {
        // 52 in ShramSafalErrors + 6 in UserErrors, measured 2026-08-30. If this
        // fails, an error was added or removed — go write its explanation, do
        // not just bump the number.
        AllCataloguedErrors().Should().HaveCount(58);
    }

    [Fact]
    public void Every_named_error_in_the_catalogue_has_an_explanation()
    {
        var missing = AllCataloguedErrors()
            .Select(e => e.Code)
            .Distinct(StringComparer.Ordinal)
            .Where(code => ErrorExplanations.For(code) is null)
            .OrderBy(c => c, StringComparer.Ordinal)
            .ToList();

        missing.Should().BeEmpty(
            "every catalogued error needs one plain sentence of meaning and one of usual "
            + "cause. Missing: " + string.Join(", ", missing));
    }

    [Fact]
    public void An_explanation_says_what_it_means_and_what_usually_causes_it()
    {
        // Keyed on the FULL code — codes are namespace-prefixed.
        var e = ErrorExplanations.For("ShramSafal.CropCycleOverlap");

        e.Should().NotBeNull();
        e!.Meaning.Should().NotBeNullOrWhiteSpace();
        e.UsualCause.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public void An_uncatalogued_code_has_no_explanation_rather_than_a_guessed_one()
    {
        ErrorExplanations.For("Uncatalogued").Should().BeNull();
        ErrorExplanations.For("Nonsense.NotAThing").Should().BeNull();
        ErrorExplanations.For("").Should().BeNull();
        ErrorExplanations.For(null).Should().BeNull();
    }

    [Fact]
    public void The_irregular_codes_are_keyed_exactly_as_declared()
    {
        // Guards against a well-meaning "tidy". RejectionPolicy.ts in every
        // shipped client depends on the third segment of the first one, and the
        // join.* family carries no ShramSafal. prefix at all.
        ErrorExplanations.For("ShramSafal.LabourAssignment.Conflict").Should().NotBeNull();
        ErrorExplanations.For("join.phone_not_verified").Should().NotBeNull();
        ErrorExplanations.For("User.NotFound").Should().NotBeNull();
    }
}

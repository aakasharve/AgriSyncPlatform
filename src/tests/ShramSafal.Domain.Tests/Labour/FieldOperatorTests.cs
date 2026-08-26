using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Wtl;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 9) —
/// <see cref="FieldOperator"/> is a durable human work subject, never a user
/// account (Global Constraint 1/2). No test here may assert or imply a
/// uniqueness constraint on any name column — see
/// <see cref="Two_operators_with_identical_display_and_full_name_are_both_creatable_with_different_ids"/>
/// (Scenario 6).
/// </summary>
public sealed class FieldOperatorTests
{
    private static readonly FarmId Farm = new(Guid.Parse("99999999-9999-9999-9999-999999999999"));
    private static readonly UserId CreatedBy = new(Guid.Parse("88888888-8888-8888-8888-888888888888"));
    private static readonly DateTime CreatedAt = new(2026, 8, 11, 9, 0, 0, DateTimeKind.Utc);

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_throws_on_blank_display_name(string blank)
    {
        Assert.Throws<ArgumentException>(() => FieldOperator.Create(
            Guid.NewGuid(), blank, fullName: null, Farm, CreatedBy, CreatedAt));
    }

    [Fact]
    public void Create_normalizes_display_name_using_WorkerName_rules()
    {
        // बाळू contains none of the stripped honorifics (मा./श्री./भाऊ), so
        // WorkerName's normalization is just trim + lowercase (a no-op for
        // Devanagari) — Normalized equals Raw here.
        var expectedNormalized = WorkerName.From("बाळू").Normalized;

        var op = FieldOperator.Create(
            Guid.NewGuid(), "बाळू", fullName: null, Farm, CreatedBy, CreatedAt);

        Assert.Equal("बाळू", op.DisplayName);
        Assert.Equal(expectedNormalized, op.DisplayNameNormalized);
    }

    [Fact]
    public void Create_strips_honorific_only_from_the_normalized_form()
    {
        var op = FieldOperator.Create(
            Guid.NewGuid(), "श्री. सुरेश", fullName: null, Farm, CreatedBy, CreatedAt);

        // Raw display name keeps the honorific; only the normalized/search
        // form strips it (WorkerName.From contract).
        Assert.Equal("श्री. सुरेश", op.DisplayName);
        Assert.Equal("सुरेश", op.DisplayNameNormalized);
    }

    [Fact]
    public void Create_stores_full_name_verbatim()
    {
        var op = FieldOperator.Create(
            Guid.NewGuid(), "मा. बाळू", fullName: "  Baalu Shinde  ", Farm, CreatedBy, CreatedAt);

        // FullName is never normalized, trimmed, or otherwise touched.
        Assert.Equal("  Baalu Shinde  ", op.FullName);
    }

    [Fact]
    public void Create_accepts_null_full_name()
    {
        var op = FieldOperator.Create(
            Guid.NewGuid(), "रमेश", fullName: null, Farm, CreatedBy, CreatedAt);

        Assert.Null(op.FullName);
    }

    [Fact]
    public void Create_starts_active()
    {
        var op = FieldOperator.Create(
            Guid.NewGuid(), "रमेश", fullName: null, Farm, CreatedBy, CreatedAt);

        Assert.True(op.IsActive);
    }

    [Fact]
    public void Two_operators_with_identical_display_and_full_name_are_both_creatable_with_different_ids()
    {
        // Scenario 6 — no unique constraint on any name column, ever. Two
        // real, different people on the same farm may share both names;
        // collapsing them into one record would silently attribute one
        // person's work to another.
        var first = FieldOperator.Create(
            Guid.NewGuid(), "रमेश", fullName: "Ramesh Patil", Farm, CreatedBy, CreatedAt);
        var second = FieldOperator.Create(
            Guid.NewGuid(), "रमेश", fullName: "Ramesh Patil", Farm, CreatedBy, CreatedAt);

        Assert.NotEqual(first.Id, second.Id);
        Assert.Equal(first.DisplayName, second.DisplayName);
        Assert.Equal(first.DisplayNameNormalized, second.DisplayNameNormalized);
        Assert.Equal(first.FullName, second.FullName);
    }

    [Fact]
    public void Rename_changes_display_name_and_recomputes_normalized_form()
    {
        var op = FieldOperator.Create(
            Guid.NewGuid(), "रमेश", fullName: null, Farm, CreatedBy, CreatedAt);

        op.Rename("श्री. सुरेश", CreatedAt.AddDays(1));

        Assert.Equal("श्री. सुरेश", op.DisplayName);
        Assert.Equal(WorkerName.From("श्री. सुरेश").Normalized, op.DisplayNameNormalized);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Rename_throws_on_blank_display_name(string blank)
    {
        var op = FieldOperator.Create(
            Guid.NewGuid(), "रमेश", fullName: null, Farm, CreatedBy, CreatedAt);

        Assert.Throws<ArgumentException>(() => op.Rename(blank, CreatedAt));
    }

    [Fact]
    public void Deactivate_sets_IsActive_false()
    {
        var op = FieldOperator.Create(
            Guid.NewGuid(), "रमेश", fullName: null, Farm, CreatedBy, CreatedAt);

        op.Deactivate(CreatedAt.AddDays(2));

        Assert.False(op.IsActive);
    }
}

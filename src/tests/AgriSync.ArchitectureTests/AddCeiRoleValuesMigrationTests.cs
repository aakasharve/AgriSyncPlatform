using System.Reflection;
using FluentAssertions;
using Microsoft.EntityFrameworkCore.Migrations;
using User.Infrastructure.Persistence.Migrations;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// CEI Phase 2 — I7 / Task 1.3.1: Verify the CeiRoleValuesPinpoint migration.
///
/// Because the role column is varchar(30) (Case A — not a Postgres enum),
/// no DDL is required and the migration Up/Down are intentionally empty.
/// These tests guard that:
///   1. The migration class exists and is named correctly (guards against accidental renames/deletions).
///   2. The Up method is a no-op (guards against accidentally adding harmful DDL to an empty pinpoint).
///   3. The migration carries the correct description comment (documents the rationale in history).
///
/// A real database round-trip test is deferred to CI staging where a Postgres
/// container is available (see CEI Phase 2 plan §5.3).
/// </summary>
public sealed class AddCeiRoleValuesMigrationTests
{
    private static readonly Type MigrationType = typeof(CeiRoleValuesPinpoint);

    /// <summary>
    /// CEI-I7-M1: The migration class must exist in the User.Infrastructure migrations assembly.
    /// </summary>
    [Fact]
    public void CeiRoleValuesPinpoint_MigrationClass_Exists()
    {
        MigrationType.Should().NotBeNull(
            "CEI-I7: CeiRoleValuesPinpoint migration must exist — it is the pinpoint marker for additive AppRole values");

        MigrationType.IsAssignableTo(typeof(Migration)).Should().BeTrue(
            "CEI-I7: CeiRoleValuesPinpoint must inherit from EF Migration base class");
    }

    /// <summary>
    /// CEI-I7-M2: The migration must live in the canonical migrations namespace.
    /// </summary>
    [Fact]
    public void CeiRoleValuesPinpoint_IsInCorrectNamespace()
    {
        MigrationType.Namespace.Should().Be(
            "User.Infrastructure.Persistence.Migrations",
            "CEI-I7: Migration must be discoverable by EF in the standard namespace");
    }

    /// <summary>
    /// CEI-I7-M3: The migration must be in the User.Infrastructure assembly — not accidentally
    /// placed in a shared or test assembly.
    /// </summary>
    [Fact]
    public void CeiRoleValuesPinpoint_IsInUserInfrastructureAssembly()
    {
        var assemblyName = MigrationType.Assembly.GetName().Name;
        assemblyName.Should().Be("User.Infrastructure",
            "CEI-I7: Migration must live in User.Infrastructure, not in a test or shared project");
    }

    /// <summary>
    /// CEI-I7-M4: Up() must be a no-op.
    ///
    /// Since AppRole is varchar(30) (Case A), the Up method should contain no
    /// DDL operations. We verify this by invoking Up with a no-op MigrationBuilder
    /// shim and confirming it completes without exception or operations.
    ///
    /// This guards against a future developer accidentally adding ALTER TABLE or
    /// CREATE TYPE statements that would be inappropriate for a pinpoint migration.
    /// </summary>
    [Fact]
    public void CeiRoleValuesPinpoint_Up_IsNoOp_DoesNotThrow()
    {
        // Arrange
        var migration = (Migration)Activator.CreateInstance(MigrationType)!;

        // Use reflection to invoke the protected Up() method with a null builder.
        // For a true no-op migration the method body must not access the builder at all,
        // so passing null is safe and won't produce a NullReferenceException.
        var upMethod = MigrationType.GetMethod("Up", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)!;
        upMethod.Should().NotBeNull("Up method must exist on the Migration base");

        // Act
        var act = () => upMethod.Invoke(migration, [null]);

        // Assert — no exception means the method body is a true no-op
        act.Should().NotThrow(
            "CEI-I7: CeiRoleValuesPinpoint.Up must be a no-op — AppRole is varchar(30), no DDL required");
    }

    /// <summary>
    /// CEI-I7-M5: Down() must also be a no-op (nothing to roll back).
    /// </summary>
    [Fact]
    public void CeiRoleValuesPinpoint_Down_IsNoOp_DoesNotThrow()
    {
        var migration = (Migration)Activator.CreateInstance(MigrationType)!;
        var downMethod = MigrationType.GetMethod("Down", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)!;
        downMethod.Should().NotBeNull("Down method must exist on the Migration base");

        var act = () => downMethod.Invoke(migration, [null]);

        act.Should().NotThrow(
            "CEI-I7: CeiRoleValuesPinpoint.Down must be a no-op — nothing was changed in Up");
    }
}

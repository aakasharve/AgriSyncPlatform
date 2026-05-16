// spec: data-principle-spine-2026-05-05/04.5
// DATA_PRINCIPLE_SPINE_2026-05-05 Sub-phase 04.5 — architectural lock on
// AuditEvent construction. After Sub-commit D §Part 5 deletes the legacy
// public static AuditEvent.Create(...) overloads, AuditEventFactory is the
// only supported construction path. These tests fail if anyone:
//   (a) adds a public constructor on AuditEvent,
//   (b) re-introduces a public static Create method on AuditEvent
//       (which would re-open the sentinel-provenance loophole the
//       Sub-commit D migration just closed).

using System.Linq;
using System.Reflection;
using FluentAssertions;
using ShramSafal.Domain.Audit;
using Xunit;

namespace AgriSync.ArchitectureTests;

public sealed class AuditConstructionRules
{
    [Fact]
    public void AuditEvent_can_only_be_constructed_via_factory()
    {
        var auditEventType = typeof(AuditEvent);
        var publicCtors = auditEventType.GetConstructors(BindingFlags.Public | BindingFlags.Instance);

        publicCtors.Should().BeEmpty(
            "AuditEvent must not have a public constructor — every emission " +
            "path must route through AuditEventFactory.Create so the four " +
            "forensic-provenance fields (app_version, device_id, ip_hash, " +
            "source_ai_job_id) are validated up front.");
    }

    [Fact]
    public void AuditEvent_has_no_public_static_Create_methods()
    {
        var auditEventType = typeof(AuditEvent);

        // Search ONLY methods declared directly on AuditEvent (not inherited
        // from Entity<Guid>/object) — DeclaredOnly avoids false positives
        // from object.MemberwiseClone or other framework members.
        var publicStaticCreateMethods = auditEventType
            .GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly)
            .Where(m => m.Name == "Create")
            .ToList();

        publicStaticCreateMethods.Should().BeEmpty(
            "the legacy AuditEvent.Create(...) static overloads were removed " +
            "in DATA_PRINCIPLE_SPINE sub-phase 04.3b Sub-commit D. " +
            "Re-introducing them would re-open the sentinel-provenance loophole " +
            "(callers could emit AuditEvent rows with appVersion='unknown' / " +
            "deviceId='unknown' / ipHash='sha256:unknown' silently). " +
            "Use AuditEventFactory.Create instead — it rejects empty/whitespace " +
            "values for all three forensic fields.");
    }
}

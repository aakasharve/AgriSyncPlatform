using System.Reflection;
using System.Text.RegularExpressions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Farms;   // LabourTimeBasis — Amend's basis parameter
using ShramSafal.Domain.Labour;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: 2026-09-01-labour-v2-r1 Task 5.1 (Correction 10) — attachability,
/// not a field. A future worker acknowledgement (E1/E2, D-H10 "NOT yet
/// decided") must be able to attach to an attendance mark the way
/// <see cref="AttendanceMarkCorrection"/> already does: a separate row
/// pointing at the mark by id, with the mark itself never changing shape.
///
/// R1 BUILDS no acknowledgement. These pins make sure it also FORECLOSES
/// none. One caveat is recorded here rather than built: because
/// <c>Amend</c> mutates in place, a future acknowledgement event must
/// carry the day/night values it acknowledged, or it will silently follow
/// a later correction.
/// </summary>
public sealed class AttendanceAttachabilityRules
{
    /// <summary>Failure text verbatim from the plan — do not reword.</summary>
    private const string AttachabilityDoor =
        "a worker's future acknowledgement must be able to point AT the mark; " +
        "if the mark ever has to change shape to accept one, R1 has closed the door " +
        "Correction 10 asked us to leave open.";

    private static readonly FarmId Farm = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly UserId Actor = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));
    private static readonly UserId OtherActor = new(Guid.Parse("44444444-4444-4444-4444-444444444444"));
    private static readonly Guid Operator = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly DateOnly WorkDate = new(2026, 9, 2);
    private static readonly DateTime At = new(2026, 9, 2, 6, 0, 0, DateTimeKind.Utc);

    // ── (a) the mark's public surface is closed, and none of it is a
    //        second-signature slot ────────────────────────────────────────

    [Fact]
    public void AttendanceMark_carries_no_acknowledgement_member()
    {
        // The complete permitted surface. Id + DomainEvents come from
        // Entity<Guid>; HoursWorked/ExtraHours/HoursBasis landed with Phase 2
        // Task 2.5 (HoursBasis is the landed task's provenance member — the
        // plan's allowlist predates it); Value is shipped, obsoleted by
        // Phase 2, and pinned out of read paths by CleanRegisterRules — its
        // existence is not an attachment slot.
        var allowed = new[]
        {
            "Id", "DomainEvents",
            "FarmId", "FieldOperatorId", "WorkDate",
            "Day", "Night", "HoursWorked", "ExtraHours", "HoursBasis",
            "RecordedByUserId", "RecordedAtUtc", "ModifiedAtUtc",
            "Value",
        };

        var actual = typeof(AttendanceMark)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => p.Name)
            .ToArray();

        actual.Should().BeSubsetOf(allowed, AttachabilityDoor);

        // Belt and braces: even a future edit to the allowlist must never
        // admit a name that smells like a second signature.
        var secondSignature = new Regex(
            "acknowledg|confirm|verif|signature|dispute|witness",
            RegexOptions.IgnoreCase);
        actual.Where(name => secondSignature.IsMatch(name))
            .Should().BeEmpty(AttachabilityDoor);
    }

    // ── (b) the Id is a stable external key: Amend re-rules in place and
    //        never replaces the row ─────────────────────────────────────────

    [Fact]
    public void AttendanceMark_id_survives_Amend_and_the_row_is_never_replaced()
    {
        var mark = AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, WorkDate,
            DayMark.Half, NightMark.Unmarked, Actor, At);
        var idBefore = mark.Id;

        var previous = mark.Amend(
            DayMark.Full, NightMark.Worked, null, null, LabourTimeBasis.Unspecified,
            OtherActor, At.AddHours(3));

        mark.Id.Should().Be(idBefore, AttachabilityDoor);
        previous.Day.Should().Be(DayMark.Half,
            "Amend hands back what it changed FROM so the caller writes the correction row");
        previous.Night.Should().Be(NightMark.Unmarked,
            "Amend hands back what it changed FROM so the caller writes the correction row");
    }

    // ── (c) the attach pattern exists in production: at least one Labour
    //        domain type points at a mark by id, and the mark points back at
    //        nothing ──────────────────────────────────────────────────────

    [Fact]
    public void A_second_party_event_attaches_by_AttendanceMarkId_with_no_back_reference()
    {
        var labourTypes = typeof(AttendanceMark).Assembly.GetTypes()
            .Where(t => t.IsPublic
                        && t.Namespace == "ShramSafal.Domain.Labour"
                        && t != typeof(AttendanceMark))
            .ToArray();

        var attachers = labourTypes
            .Where(t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Any(p => p.Name == "AttendanceMarkId" && p.PropertyType == typeof(Guid)))
            .ToArray();

        attachers.Should().NotBeEmpty(
            "AttendanceMarkCorrection is the shipped proof that a second-party event can " +
            "point AT a mark by AttendanceMarkId (AttendanceMarkCorrection.cs:73) — " +
            AttachabilityDoor);

        foreach (var property in typeof(AttendanceMark)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            var type = property.PropertyType;
            var constituents = type.IsArray
                ? new[] { type.GetElementType()! }
                : type.IsGenericType
                    ? type.GetGenericArguments()
                    : Array.Empty<Type>();

            attachers.Should().NotContain(type,
                "a back-reference (navigation) on the mark would make the mark's shape " +
                "depend on its attachers — " + AttachabilityDoor);
            foreach (var constituent in constituents)
            {
                attachers.Should().NotContain(constituent,
                    "a collection navigation on the mark is a back-reference too — " +
                    AttachabilityDoor);
            }
        }
    }

    // ── E2: the append-only mechanism survives, at the GRANT, in the
    //        creating migration ───────────────────────────────────────────

    [Fact]
    public void The_correction_history_stays_append_only_at_the_GRANT()
    {
        // Migrations/ is excluded from ProductionSourceFiles() by design, so
        // this test names the file directly. GetSolutionRoot() returns
        // <repo>/src (see LabourAnchorRules' path note).
        var migration = Path.Combine(
            TestPathHelper.GetSolutionRoot(),
            "apps", "ShramSafal", "ShramSafal.Infrastructure",
            "Persistence", "Migrations",
            "20260831185516_AddAttendanceMarkCorrections.cs");

        File.Exists(migration).Should().BeTrue(
            "the creating migration is the ONLY carrier of the append-only grant; " +
            "if it moved or was renamed this pin must follow it deliberately, not vanish");

        // Comment-strip BEFORE matching (the house idiom this phase copies —
        // "prose must never fail a build"). The migration's own doc comment
        // ("ENFORCED BY THE GRANT … never UPDATE or DELETE") spans to the real
        // GRANT with no intervening semicolon and would trip the negative
        // regex below if left in.
        var source = StripComments(File.ReadAllText(migration));

        source.Should().Contain(
            "GRANT SELECT, INSERT ON ssf.attendance_mark_corrections",
            "append-only is enforced at the GRANT (SELECT + INSERT only), not by convention — " +
            "a history that can itself be edited answers nothing at all (E2)");

        Regex.IsMatch(
                source,
                @"GRANT[^;]*\b(UPDATE|DELETE|TRUNCATE|ALL)\b[^;]*ON\s+ssf\.attendance_mark_corrections")
            .Should().BeFalse(
                "no grant may ever widen the corrections table beyond SELECT + INSERT (E2)");

        source.Should().Contain("ENABLE ROW LEVEL SECURITY",
            "RLS enabled AND forced is a hard rule for every ssf table");
        source.Should().Contain("FORCE ROW LEVEL SECURITY",
            "enable alone leaves the table owner outside the policy");
    }

    // ── copied from LabourAnchorRules (private there; copy, do not import) ──

    private static string StripComments(string source)
    {
        var withoutBlockComments = Regex.Replace(source, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);
        return Regex.Replace(withoutBlockComments, @"^[^\S\r\n]*//.*$", string.Empty, RegexOptions.Multiline);
    }
}

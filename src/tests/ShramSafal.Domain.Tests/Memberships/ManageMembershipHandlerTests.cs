// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, AC2) — the PRIMARY owner's decisions (founder D-22,
// 26 Oct), in the handler, without a database: every guard (self, primary owner only, registrant,
// last owner, wrong status, shape — co-owner / family is not given in step 2) and what each decision
// WRITES (seat state + one audit row, or none for a re-send).
// The same routes over real Postgres as the app role: Sync.IntegrationTests/Memberships/
// MembershipLifecycleRoutesRealPostgresTests.
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Memberships.ManageMembership;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Memberships;

public sealed class ManageMembershipHandlerTests
{
    private static readonly FarmId FarmKey = new(Guid.Parse("b2000000-0000-0000-0000-0000000000f1"));
    private static readonly UserId Registrant = new(Guid.Parse("b2000000-0000-0000-0000-0000000000a1"));
    private static readonly UserId CoOwner = new(Guid.Parse("b2000000-0000-0000-0000-0000000000a2"));
    private static readonly UserId Joiner = new(Guid.Parse("b2000000-0000-0000-0000-0000000000b1"));
    private static readonly DateTime Now = new(2026, 10, 26, 10, 0, 0, DateTimeKind.Utc);

    [Theory]
    [InlineData("Worker", false, AppRole.Worker, false)]
    [InlineData("Mukadam", true, AppRole.Mukadam, true)]
    public async Task The_primary_owner_approves_a_waiting_request_as_each_preset(
        string role, bool grantLabour, AppRole expectedRole, bool expectedGrant)
    {
        var repo = new Repo();
        var seat = repo.AddRequest(Joiner);

        var result = await Handle(repo, Decision(MembershipDecision.Approve) with { Role = role, GrantLabour = grantLabour });

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Code : null);
        Assert.Equal(MembershipStatus.Active, seat.Status);
        Assert.Equal(expectedRole, seat.Role);
        Assert.Null(seat.Permissions);
        Assert.Equal(FarmPermission.None, seat.EffectivePermissions);
        Assert.Equal(expectedGrant, seat.CanManageLabourRecords);
        Assert.Equal("Active", result.Value!.Status);
        Assert.Equal(expectedRole.ToString(), result.Value.Role);
        Assert.Empty(result.Value.Permissions!);
        Assert.True(result.Value.ApprovedByOwner);

        var audit = Assert.Single(repo.Audits);
        Assert.Equal("MemberApproved", audit.Action);
        Assert.Equal("primaryowner", audit.ActorRole);
        Assert.Contains("\"fromStatus\":\"PendingApproval\"", audit.Payload);
        Assert.Contains($"\"toRole\":\"{expectedRole}\"", audit.Payload);
        Assert.Equal(1, repo.Saves);
    }

    /// <summary>M-2 (founder D-22, 26 Oct): कुटुंब / co-owner is not offered in step 2 — asking for it
    /// is a bad request, on approve and on an access change alike. Nothing is written.</summary>
    [Fact]
    public async Task A_co_owner_or_family_seat_is_not_given_in_step_2()
    {
        var repo = new Repo();
        var request = repo.AddRequest(Joiner);
        var worker = new UserId(Guid.NewGuid());
        var workerSeat = repo.AddActive(worker, AppRole.Worker);

        AssertRefused(await Handle(repo, Decision(MembershipDecision.Approve) with { Role = "SecondaryOwner" }),
            ShramSafalErrors.InvalidCommand, repo);
        AssertRefused(await Handle(repo, Decision(MembershipDecision.SetAccess, worker) with { Role = "SecondaryOwner" }),
            ShramSafalErrors.InvalidCommand, repo);
        Assert.Equal(MembershipStatus.PendingApproval, request.Status);
        Assert.Equal(AppRole.Worker, workerSeat.Role);

        // CONTROL: the same request is let in as काम सांगणे.
        Assert.True((await Handle(repo, Decision(MembershipDecision.Approve) with { Role = "Worker" })).IsSuccess);
    }

    [Fact]
    public async Task The_primary_owners_explicit_permission_choice_is_stored_exactly()
    {
        var repo = new Repo();
        var seat = repo.AddRequest(Joiner);

        var result = await Handle(repo, Decision(MembershipDecision.Approve) with { Role = "Mukadam", Permissions = ["AddCost"] });

        Assert.True(result.IsSuccess);
        Assert.Equal(FarmPermission.AddCost, seat.Permissions);
        Assert.Equal(new[] { "AddCost" }, result.Value!.Permissions!);
    }

    [Fact]
    public async Task Decline_pause_restore_remove_each_write_one_audit_row_with_the_reason()
    {
        var repo = new Repo();
        var request = repo.AddRequest(Joiner);
        Assert.True((await Handle(repo, Decision(MembershipDecision.Decline) with { Reason = "ओळख नाही" })).IsSuccess);
        Assert.Equal(MembershipStatus.Revoked, request.Status);
        Assert.Equal("ओळख नाही", request.StatusReason);

        var other = new UserId(Guid.NewGuid());
        var seat = repo.AddActive(other, AppRole.Worker);
        Assert.True((await Handle(repo, Decision(MembershipDecision.Suspend, other) with { Reason = "थांबा" })).IsSuccess);
        Assert.Equal(MembershipStatus.Suspended, seat.Status);
        Assert.True((await Handle(repo, Decision(MembershipDecision.Restore, other))).IsSuccess);
        Assert.Equal(MembershipStatus.Active, seat.Status);
        Assert.True((await Handle(repo, Decision(MembershipDecision.Remove, other) with { Reason = "गेला" })).IsSuccess);
        Assert.Equal(MembershipStatus.Revoked, seat.Status);

        Assert.Equal(
            new[] { "MemberDeclined", "MemberSuspended", "MemberRestored", "MemberRemoved" },
            repo.Audits.Select(a => a.Action).ToArray());
        Assert.All(repo.Audits, a => Assert.Equal("primaryowner", a.ActorRole));
        using var paused = System.Text.Json.JsonDocument.Parse(repo.Audits[1].Payload);
        Assert.Equal("थांबा", paused.RootElement.GetProperty("reason").GetString());
        Assert.Equal("Active", paused.RootElement.GetProperty("fromStatus").GetString());
        Assert.Equal("Suspended", paused.RootElement.GetProperty("toStatus").GetString());
    }

    [Fact]
    public async Task Nobody_decides_about_themselves()
    {
        var repo = new Repo();
        var p2 = new UserId(Guid.NewGuid());
        repo.AddActive(p2, AppRole.PrimaryOwner);
        var result = await Handle(repo, Decision(MembershipDecision.Suspend, p2) with { CallerUserId = p2 });
        AssertRefused(result, ShramSafalErrors.Forbidden, repo);
    }

    /// <summary>The registrant is never paused, removed or changed: a second PrimaryOwner SEAT asking
    /// is refused, and nothing is written.</summary>
    [Theory]
    [InlineData(MembershipDecision.Suspend)]
    [InlineData(MembershipDecision.Remove)]
    [InlineData(MembershipDecision.SetAccess)]
    public async Task The_registrant_is_never_paused_removed_or_changed(MembershipDecision decision)
    {
        var repo = new Repo();
        repo.AddActive(Registrant, AppRole.PrimaryOwner);
        var p2 = new UserId(Guid.NewGuid());
        repo.AddActive(p2, AppRole.PrimaryOwner);
        var result = await Handle(repo, Decision(decision, Registrant) with { CallerUserId = p2, Role = decision == MembershipDecision.SetAccess ? "Worker" : null });
        AssertRefused(result, ShramSafalErrors.Forbidden, repo);
    }

    /// <summary>Verifier SEC-MU2-6 / founder override 26 Oct ("primary owner" = the registrant, for
    /// now): a PrimaryOwner seat that is NOT the registrant decides nothing about anybody — the role
    /// read answers PrimaryOwner for him, and that alone is not enough. The registrant, the control,
    /// takes the same decisions.</summary>
    [Fact]
    public async Task A_primary_owner_seat_that_is_not_the_registrant_decides_nothing()
    {
        var repo = new Repo();
        var p2 = new UserId(Guid.NewGuid());
        repo.AddActive(p2, AppRole.PrimaryOwner);
        var request = repo.AddRequest(Joiner);
        var worker = new UserId(Guid.NewGuid());
        var workerSeat = repo.AddActive(worker, AppRole.Worker);

        foreach (var command in new[]
                 {
                     Decision(MembershipDecision.Approve) with { CallerUserId = p2, Role = "Worker" },
                     Decision(MembershipDecision.Decline) with { CallerUserId = p2 },
                     Decision(MembershipDecision.Suspend, worker) with { CallerUserId = p2, Reason = "x" },
                     Decision(MembershipDecision.Remove, worker) with { CallerUserId = p2 },
                     Decision(MembershipDecision.SetAccess, worker) with { CallerUserId = p2, Role = "Mukadam" },
                 })
        {
            AssertRefused(await Handle(repo, command), ShramSafalErrors.Forbidden, repo);
        }

        Assert.Equal(MembershipStatus.PendingApproval, request.Status);
        Assert.Equal(MembershipStatus.Active, workerSeat.Status);
        Assert.Equal(AppRole.Worker, workerSeat.Role);

        // CONTROL: the registrant.
        Assert.True((await Handle(repo, Decision(MembershipDecision.Suspend, worker) with { Reason = "x" })).IsSuccess);
        Assert.Equal(MembershipStatus.Suspended, workerSeat.Status);
    }

    /// <summary>Verifier SEC-MU2-1: an approval sets the हजेरी व पक्कं grant to EXACTLY the chosen
    /// preset. A grant left on the waiting request (stored before waiting seats were refused) is
    /// turned OFF when the primary owner lets the person in as काम सांगणे — and kept on for काम +
    /// हजेरी. The audit row records both sides.</summary>
    [Theory]
    [InlineData("Worker", false)]
    [InlineData("Mukadam", true)]
    public async Task An_approval_sets_the_labour_grant_to_exactly_the_chosen_preset(string role, bool grantLabour)
    {
        var repo = new Repo();
        var seat = repo.AddRequest(Joiner);
        seat.SetLabourRecordManagement(true, expiresAtUtc: null, Now.AddHours(-2)); // left on the waiting seat
        Assert.True(seat.CanManageLabourRecords, "arrange: the waiting request carries a grant");

        var result = await Handle(repo, Decision(MembershipDecision.Approve) with { Role = role, GrantLabour = grantLabour });

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Code : null);
        Assert.Equal(grantLabour, seat.CanManageLabourRecords);
        Assert.Equal(grantLabour, result.Value!.CanManageLabourRecords);
        var audit = Assert.Single(repo.Audits);
        Assert.Contains("\"labourGrantBefore\":true", audit.Payload);
        Assert.Contains($"\"labourGrant\":{(grantLabour ? "true" : "false")}", audit.Payload);

        // A re-send of the same choice is the truth, not a second row.
        Assert.True((await Handle(repo, Decision(MembershipDecision.Approve) with { Role = role, GrantLabour = grantLabour })).IsSuccess);
        Assert.Single(repo.Audits);
    }

    /// <summary>Verifier MU2-V6: the owner taps शेतातून काढा / नको for a person who has meanwhile left
    /// or withdrawn on his own. "Not on the farm" is already true: 200 with the ended row as it is
    /// (Exited — not a fresh decision), nothing written. A person never on this farm stays a 403.</summary>
    [Fact]
    public async Task Removing_or_declining_a_person_who_already_left_answers_the_truth_and_writes_nothing()
    {
        var repo = new Repo();
        var leaver = new UserId(Guid.NewGuid());
        repo.AddActive(leaver, AppRole.Worker).Exit(Now.AddMinutes(-5), isLastActivePrimaryOwner: false);
        repo.AddRequest(Joiner).Exit(Now.AddMinutes(-5), isLastActivePrimaryOwner: false); // withdrawn

        var removed = await Handle(repo, Decision(MembershipDecision.Remove, leaver) with { Reason = "x" });
        Assert.True(removed.IsSuccess, removed.IsFailure ? removed.Error.Code : null);
        Assert.Equal("Exited", removed.Value!.Status);

        var declined = await Handle(repo, Decision(MembershipDecision.Decline));
        Assert.True(declined.IsSuccess, declined.IsFailure ? declined.Error.Code : null);
        Assert.Equal("Exited", declined.Value!.Status);

        Assert.Empty(repo.Audits);
        Assert.Equal(0, repo.Saves);

        // Never on this farm: the uniform refusal (no oracle), and a pause of a gone person is no answer either.
        AssertRefused(await Handle(repo, Decision(MembershipDecision.Remove, new UserId(Guid.NewGuid()))), ShramSafalErrors.Forbidden, repo);
        AssertRefused(await Handle(repo, Decision(MembershipDecision.Suspend, leaver) with { Reason = "x" }), ShramSafalErrors.Forbidden, repo);
    }

    [Theory]
    [InlineData(AppRole.SecondaryOwner)]
    [InlineData(AppRole.Mukadam)]
    [InlineData(AppRole.Worker)]
    public async Task Only_the_primary_owner_decides(AppRole callerRole)
    {
        var repo = new Repo();
        var caller = new UserId(Guid.NewGuid());
        repo.AddActive(caller, callerRole);
        repo.AddRequest(Joiner);

        var result = await Handle(repo, Decision(MembershipDecision.Approve) with { CallerUserId = caller, Role = "Worker" });

        AssertRefused(result, ShramSafalErrors.Forbidden, repo);
    }

    /// <summary>M-1 (founder D-22, 26 Oct): a co-owner gets 403 for EVERY decision, on a waiting
    /// request and on a plain worker alike — and nothing moves, nothing is written. The control: the
    /// primary owner takes the same decisions, and may also pause an existing co-owner.</summary>
    [Fact]
    public async Task A_co_owner_gets_403_for_every_decision_and_the_primary_owner_does_not()
    {
        var repo = new Repo();
        var request = repo.AddRequest(Joiner);
        var worker = new UserId(Guid.NewGuid());
        var workerSeat = repo.AddActive(worker, AppRole.Worker);
        var paused = new UserId(Guid.NewGuid());
        var pausedSeat = repo.AddActive(paused, AppRole.Worker);
        pausedSeat.Suspend(Registrant, "थांबा", Now.AddHours(-1));

        var asCoOwner = new[]
        {
            Decision(MembershipDecision.Approve) with { CallerUserId = CoOwner, Role = "Worker" },
            Decision(MembershipDecision.Decline) with { CallerUserId = CoOwner, Reason = "x" },
            Decision(MembershipDecision.Suspend, worker) with { CallerUserId = CoOwner, Reason = "x" },
            Decision(MembershipDecision.Restore, paused) with { CallerUserId = CoOwner },
            Decision(MembershipDecision.Remove, worker) with { CallerUserId = CoOwner, Reason = "x" },
            Decision(MembershipDecision.SetAccess, worker) with { CallerUserId = CoOwner, Role = "Mukadam", LabourGrant = true },
            Decision(MembershipDecision.SetAccess, worker) with { CallerUserId = CoOwner, Permissions = ["AddCost"] },
        };
        foreach (var command in asCoOwner)
        {
            AssertRefused(await Handle(repo, command), ShramSafalErrors.Forbidden, repo);
        }

        Assert.Equal(MembershipStatus.PendingApproval, request.Status);
        Assert.Equal(MembershipStatus.Active, workerSeat.Status);
        Assert.Equal(AppRole.Worker, workerSeat.Role);
        Assert.Null(workerSeat.Permissions);
        Assert.Equal(MembershipStatus.Suspended, pausedSeat.Status);

        // CONTROLS: the primary owner (the registrant) takes the same decisions…
        Assert.True((await Handle(repo, Decision(MembershipDecision.Approve) with { Role = "Worker" })).IsSuccess);
        Assert.True((await Handle(repo, Decision(MembershipDecision.Restore, paused))).IsSuccess);
        Assert.True((await Handle(repo, Decision(MembershipDecision.SetAccess, worker) with { Role = "Mukadam", LabourGrant = true })).IsSuccess);
        // …and decides about the co-owner himself (a co-owner is a person, not a second authority).
        Assert.True((await Handle(repo, Decision(MembershipDecision.Suspend, CoOwner) with { Reason = "थांबा" })).IsSuccess);
        Assert.Equal(MembershipStatus.Suspended, repo.CoOwnerSeat.Status);
        Assert.Equal(4, repo.Audits.Count);
    }

    [Fact]
    public async Task The_last_active_primary_owner_stays()
    {
        var repo = new Repo { ActivePrimaryOwners = 1 };
        var other = new UserId(Guid.NewGuid());
        var seat = repo.AddActive(other, AppRole.PrimaryOwner);

        var result = await Handle(repo, Decision(MembershipDecision.Remove, other) with { CallerUserId = Registrant });

        AssertRefused(result, ShramSafalErrors.MembershipLastOwner, repo);
        Assert.Equal(MembershipStatus.Active, seat.Status);
    }

    [Fact]
    public async Task A_decision_the_status_does_not_allow_is_a_409_and_writes_nothing()
    {
        var repo = new Repo();
        var other = new UserId(Guid.NewGuid());
        repo.AddActive(other, AppRole.Worker);
        repo.AddRequest(Joiner);

        AssertRefused(await Handle(repo, Decision(MembershipDecision.Restore)), ShramSafalErrors.MembershipWrongStatus, repo);
        AssertRefused(await Handle(repo, Decision(MembershipDecision.Suspend)), ShramSafalErrors.MembershipWrongStatus, repo);
        AssertRefused(await Handle(repo, Decision(MembershipDecision.Approve, other) with { Role = "Mukadam" }), ShramSafalErrors.MembershipWrongStatus, repo);
    }

    [Fact]
    public async Task A_decision_re_sent_after_it_landed_answers_the_truth_and_writes_no_second_row()
    {
        var repo = new Repo();
        var seat = repo.AddRequest(Joiner);

        foreach (var attempt in new[] { 1, 2 })
        {
            var approved = await Handle(repo, Decision(MembershipDecision.Approve) with { Role = "Mukadam", GrantLabour = true });
            Assert.True(approved.IsSuccess, $"approve attempt {attempt}: {(approved.IsFailure ? approved.Error.Code : null)}");
            Assert.Equal("Mukadam", approved.Value!.Role);
        }

        foreach (var attempt in new[] { 1, 2 })
        {
            Assert.True((await Handle(repo, Decision(MembershipDecision.Suspend) with { Reason = "थांबा" })).IsSuccess, $"pause {attempt}");
        }

        foreach (var attempt in new[] { 1, 2 })
        {
            Assert.True((await Handle(repo, Decision(MembershipDecision.Restore))).IsSuccess, $"restore {attempt}");
        }

        Assert.Equal(MembershipStatus.Active, seat.Status);
        Assert.Equal(new[] { "MemberApproved", "MemberSuspended", "MemberRestored" }, repo.Audits.Select(a => a.Action).ToArray());

        // A DIFFERENT choice for someone already let in is not a re-send: that is an access change.
        AssertRefusedWith(await Handle(repo, Decision(MembershipDecision.Approve) with { Role = "Worker" }), ShramSafalErrors.MembershipWrongStatus);
    }

    /// <summary>BT-2 / B2: a demotion never keeps the old role's powers. The phone's preset change
    /// sends only the role; the new role starts from ITS defaults, the labour grant included.</summary>
    [Fact]
    public async Task A_role_change_starts_from_the_new_roles_defaults_stored_powers_and_labour_grant_included()
    {
        var repo = new Repo();
        var trusted = new UserId(Guid.NewGuid());
        var seat = repo.AddRequest(trusted);
        Assert.True((await Handle(repo, Decision(MembershipDecision.Approve, trusted) with
        {
            Role = "Mukadam",
            Permissions = ["AddCost", "PlanWork"],
        })).IsSuccess);
        Assert.Equal(FarmPermission.AddCost | FarmPermission.PlanWork, seat.Permissions);

        var demoted = await Handle(repo, Decision(MembershipDecision.SetAccess, trusted) with { Role = "Worker" });

        Assert.True(demoted.IsSuccess, demoted.IsFailure ? demoted.Error.Code : null);
        Assert.Equal(AppRole.Worker, seat.Role);
        Assert.Null(seat.Permissions);
        Assert.Equal(FarmPermission.None, seat.EffectivePermissions);
        Assert.Empty(demoted.Value!.Permissions!);

        // A मुकादम with हजेरी व पक्कं moved to काम सांगणे loses the grant with the role.
        var crew = new UserId(Guid.NewGuid());
        var crewSeat = repo.AddRequest(crew);
        Assert.True((await Handle(repo, Decision(MembershipDecision.Approve, crew) with { Role = "Mukadam", GrantLabour = true })).IsSuccess);
        Assert.True(crewSeat.CanManageLabourRecords);
        Assert.True((await Handle(repo, Decision(MembershipDecision.SetAccess, crew) with { Role = "Worker" })).IsSuccess);
        Assert.False(crewSeat.CanManageLabourRecords);

        // CONTROL: the same body that NAMES permissions keeps exactly those.
        Assert.True((await Handle(repo, Decision(MembershipDecision.SetAccess, crew) with { Role = "Mukadam", Permissions = ["PlanWork"] })).IsSuccess);
        Assert.Equal(FarmPermission.PlanWork, crewSeat.EffectivePermissions);
        // CONTROL: on an unchanged role an absent permissions field keeps the stored choice.
        Assert.True((await Handle(repo, Decision(MembershipDecision.SetAccess, crew) with { LabourGrant = true })).IsSuccess);
        Assert.Equal(FarmPermission.PlanWork, crewSeat.EffectivePermissions);
        Assert.True(crewSeat.CanManageLabourRecords);
    }

    [Fact]
    public async Task Moving_a_worker_to_crew_changes_role_and_grant_in_ONE_decision_with_one_audit_row()
    {
        var repo = new Repo();
        var other = new UserId(Guid.NewGuid());
        var seat = repo.AddActive(other, AppRole.Worker);

        var result = await Handle(repo, Decision(MembershipDecision.SetAccess, other) with { Role = "Mukadam", LabourGrant = true });

        Assert.True(result.IsSuccess);
        Assert.Equal(AppRole.Mukadam, seat.Role);
        Assert.True(seat.CanManageLabourRecords);
        Assert.True(result.Value!.CanManageLabourRecords);
        var audit = Assert.Single(repo.Audits);
        Assert.Equal("MemberAccessChanged", audit.Action);
        Assert.Contains("\"labourGrant\":true", audit.Payload);
        Assert.Equal(1, repo.Saves);
    }

    [Fact]
    public async Task LabourGrant_is_only_read_on_an_access_change()
    {
        var repo = new Repo();
        repo.AddRequest(Joiner);
        AssertRefused(await Handle(repo, Decision(MembershipDecision.Approve) with { Role = "Worker", LabourGrant = true }),
            ShramSafalErrors.InvalidCommand, repo);
    }

    /// <summary>M-7: the owner's answer carries the last four digits of the person's phone (never
    /// the whole number), and nothing when the directory has no phone for him.</summary>
    [Fact]
    public async Task The_answer_carries_the_last_four_phone_digits_only()
    {
        var repo = new Repo();
        repo.AddRequest(Joiner);
        repo.PhoneTails[Joiner.Value] = "4321";

        var approved = await Handle(repo, Decision(MembershipDecision.Approve) with { Role = "Worker" });

        Assert.Equal("4321", approved.Value!.PhoneLast4);

        var other = new UserId(Guid.NewGuid());
        repo.AddActive(other, AppRole.Worker);
        var paused = await Handle(repo, Decision(MembershipDecision.Suspend, other));
        Assert.Null(paused.Value!.PhoneLast4);
        Assert.False(paused.Value.ApprovedByOwner, "added directly, never approved");
    }

    [Theory]
    [InlineData("PrimaryOwner", null, null)]
    [InlineData("SecondaryOwner", null, null)]
    [InlineData("Agronomist", null, null)]
    [InlineData("3", null, null)]
    [InlineData("Worker", "Verify", null)]
    [InlineData("Worker", null, 501)]
    public async Task A_bad_shape_is_InvalidCommand(string role, string? permission, int? reasonLength)
    {
        var repo = new Repo();
        repo.AddRequest(Joiner);

        var result = await Handle(repo, Decision(MembershipDecision.Approve) with
        {
            Role = role,
            Permissions = permission is null ? null : [permission],
            Reason = reasonLength is { } n ? new string('x', n) : null,
        });

        AssertRefused(result, ShramSafalErrors.InvalidCommand, repo);
    }

    [Fact]
    public async Task A_re_sent_access_change_writes_no_history_and_a_re_sent_decline_answers_the_truth()
    {
        var repo = new Repo();
        var other = new UserId(Guid.NewGuid());
        repo.AddActive(other, AppRole.Mukadam);

        Assert.True((await Handle(repo, Decision(MembershipDecision.SetAccess, other) with { Role = "Mukadam" })).IsSuccess);
        Assert.Empty(repo.Audits);

        repo.AddRequest(Joiner);
        Assert.True((await Handle(repo, Decision(MembershipDecision.Decline))).IsSuccess);
        var again = await Handle(repo, Decision(MembershipDecision.Decline));
        Assert.True(again.IsSuccess);
        Assert.Equal("Revoked", again.Value!.Status);
        Assert.Single(repo.Audits);
    }

    // ── harness ──────────────────────────────────────────────────────────────

    private static ManageMembershipCommand Decision(MembershipDecision decision, UserId? target = null) =>
        new(FarmKey, target ?? Joiner, Registrant, decision);

    private static Task<AgriSync.BuildingBlocks.Results.Result<LabourPermissionDto>> Handle(Repo repo, ManageMembershipCommand command) =>
        new ManageMembershipHandler(repo, new FixedClock()).HandleAsync(command);

    private static void AssertRefusedWith(
        AgriSync.BuildingBlocks.Results.Result<LabourPermissionDto> result,
        AgriSync.BuildingBlocks.Results.Error expected)
    {
        Assert.True(result.IsFailure);
        Assert.Equal(expected.Code, result.Error.Code);
    }

    /// <summary>Refused with exactly this error, and nothing written (no audit row, no save).</summary>
    private static void AssertRefused(
        AgriSync.BuildingBlocks.Results.Result<LabourPermissionDto> result,
        AgriSync.BuildingBlocks.Results.Error expected,
        Repo repo)
    {
        Assert.True(result.IsFailure);
        Assert.Equal(expected.Code, result.Error.Code);
        Assert.Empty(repo.Audits);
        Assert.Equal(0, repo.Saves);
    }

    private sealed class FixedClock : IClock
    {
        public DateTime UtcNow => Now;
    }

    private sealed class Repo : StubShramSafalRepository, IShramSafalRepository
    {
        private readonly List<FarmMembership> _seats = [];
        private readonly Farm _farm = Farm.Create(FarmKey, "Probe Farm", Registrant, Now.AddYears(-1));

        public List<AuditEvent> Audits { get; } = [];
        public int Saves { get; private set; }
        public int ActivePrimaryOwners { get; init; } = 2;

        public Repo() => CoOwnerSeat = AddActive(CoOwner, AppRole.SecondaryOwner);

        public FarmMembership CoOwnerSeat { get; }

        public FarmMembership AddRequest(UserId who)
        {
            var seat = FarmMembership.CreateJoinRequest(Guid.NewGuid(), FarmKey, who, Now.AddDays(-1));
            _seats.Add(seat);
            return seat;
        }

        public FarmMembership AddActive(UserId who, AppRole role)
        {
            var seat = FarmMembership.Create(Guid.NewGuid(), FarmKey, who, role, Now.AddDays(-2), JoinedVia.OwnerManualAdd);
            _seats.Add(seat);
            return seat;
        }

        public override Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) =>
            Task.FromResult<Farm?>(farmId == FarmKey.Value ? _farm : null);

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
        {
            if (userId == Registrant.Value)
            {
                return Task.FromResult<AppRole?>(AppRole.PrimaryOwner);
            }

            var seat = _seats.FirstOrDefault(s => s.UserId.Value == userId && s.Status == MembershipStatus.Active);
            return Task.FromResult(seat is null ? null : (AppRole?)seat.Role);
        }

        public override Task<FarmMembership?> GetTrackedFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult(_seats.FirstOrDefault(s => s.FarmId.Value == farmId && s.UserId.Value == userId && !s.IsTerminal));

        public Task<FarmMembership?> GetLatestEndedFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult(_seats.LastOrDefault(s => s.FarmId.Value == farmId && s.UserId.Value == userId && s.IsTerminal));

        public override Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) =>
            Task.FromResult(ActivePrimaryOwners);

        public override Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<SyncOperatorDto>>([]);

        public Dictionary<Guid, string> PhoneTails { get; } = [];

        public Task<IReadOnlyDictionary<Guid, string>> GetPhoneLast4ByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyDictionary<Guid, string>>(
                userIds.Where(PhoneTails.ContainsKey).ToDictionary(id => id, id => PhoneTails[id]));

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            Audits.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default)
        {
            Saves++;
            return Task.CompletedTask;
        }
    }
}

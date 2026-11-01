// spec: plr-d10 lane PRV fix pass 2 — the second review's findings, against a real Postgres as agrisync_app:
//   M2   money the holder set on its own never follows a coincidental match; money that followed follows back;
//   N1   a record kept from the sender never refuses his हजेरी mark, and nothing of it is in his answer; the owner is told;
//   D-69 a record whose own money is kept from him is served without its amounts and its money words;
//   N2   a bill photo is never kept from the person who took it;
//   N3   every gated online door that had no test of its own refuses a record kept from the caller.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Application;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Attachments.UploadAttachment;
using ShramSafal.Application.UseCases.Compliance.AcknowledgeSignal;
using ShramSafal.Application.UseCases.Compliance.ResolveSignal;
using ShramSafal.Application.UseCases.Dfes.RecordQuestionEvent;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Application.UseCases.Finance.AllocateGlobalExpense;
using ShramSafal.Application.UseCases.Finance.CorrectCostEntry;
using ShramSafal.Application.UseCases.Labour.AttachFieldOperator;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;
using ShramSafal.Domain.Compliance;
using ShramSafal.Domain.Finance;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

public sealed partial class RecordAudienceRealPostgresTests
{
    private const string Closed = "ShramSafal.RecordAudience.Forbidden";
    private static readonly Guid M2bLog = Guid.Parse("3d0a0000-0000-4000-8000-000000000301");
    private static readonly Guid M2cLog = Guid.Parse("3d0a0000-0000-4000-8000-000000000302");
    private static readonly Guid N1HiddenLog = Guid.Parse("3d0a0000-0000-4000-8000-000000000303");
    private static readonly Guid N1HiddenCrew = Guid.Parse("3d0a0000-0000-4000-8000-000000000304");
    private static readonly Guid N1TeamLog = Guid.Parse("3d0a0000-0000-4000-8000-000000000305");
    private static readonly Guid N1TeamCrew = Guid.Parse("3d0a0000-0000-4000-8000-000000000306");
    private static readonly Guid D69Log = Guid.Parse("3d0a0000-0000-4000-8000-000000000307");
    private static readonly Guid D69Crew = Guid.Parse("3d0a0000-0000-4000-8000-000000000308");
    private static readonly Guid MukadamBill = Guid.Parse("3d0a0000-0000-4000-8000-000000000309");
    private static readonly Guid OwnerBill = Guid.Parse("3d0a0000-0000-4000-8000-00000000030a");
    private static readonly Guid Signal = Guid.Parse("3d0a0000-0000-4000-8000-00000000030b");
    private const string N1SecretTask = "गुप्त-हजेरी-काम";
    private const decimal D69Input = 2468.77m;
    private const decimal D69CrewTotal = 1593.57m;
    private const string D69Words = "औषध ₹२४६८ ला आणले";

    // ── M2 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task M2_money_set_on_its_own_keeps_his_choice_through_a_coincidental_match_of_audiences()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        var money = await RecordWithLineMoneyAsync(M2bLog, "fix2-m2b", 1235.79m);

        await SetAudienceAsync(Owner, "CostEntry", money, "OnlyMe"); // his own choice on the money
        await SetAudienceAsync(Owner, "DailyLog", M2bLog, "OnlyMe"); // money left alone (OnlyMe != Team)
        await SetAudienceAsync(Owner, "DailyLog", M2bLog, "Team");   // the money's OnlyMe now equals the log's previous

        var (_, owner) = await PullAsync(Owner);
        AudienceOf(owner, "costEntries", money).Should().Be("OnlyMe", "his own choice on the money is never widened by its record");
        var (mukadamBody, _) = await PullAsync(Mukadam);
        mukadamBody.Should().NotContain(money.ToString());
    }

    [Fact]
    public async Task M2_money_that_followed_its_record_follows_it_back()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        var money = await RecordWithLineMoneyAsync(M2cLog, "fix2-m2c", 1357.24m);

        await SetAudienceAsync(Owner, "DailyLog", M2cLog, "OnlyMe");
        var (_, narrowed) = await PullAsync(Owner);
        AudienceOf(narrowed, "costEntries", money).Should().Be("OnlyMe", "the money followed its record");

        await SetAudienceAsync(Owner, "DailyLog", M2cLog, "Team");
        var (_, owner) = await PullAsync(Owner);
        AudienceOf(owner, "costEntries", money).Should().BeNull("following, it comes back to the team with its record");
        var (mukadamBody, _) = await PullAsync(Mukadam);
        mukadamBody.Should().Contain(money.ToString());
    }

    // ── N1 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task N1_a_record_kept_from_the_sender_never_refuses_his_hajeri_mark_and_the_owner_is_told()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        await EngageAsync(N1HiddenLog, N1HiddenCrew, "full", N1SecretTask, "fix2-n1-hidden");
        await EngageAsync(N1TeamLog, N1TeamCrew, "half", "खुरपणी", "fix2-n1-team");
        await SetAudienceAsync(Owner, "DailyLog", N1HiddenLog, "OnlyMe");

        var mark = await PushAsync(Mukadam, "attendance.mark", $"attendance.mark:{FarmA}:{FieldOperator}:{WorkDay}:Half:-:-:-",
            new Dictionary<string, object?>
            {
                ["attendanceMarkId"] = Guid.NewGuid(),
                ["farmId"] = FarmA,
                ["fieldOperatorId"] = FieldOperator,
                ["workDate"] = WorkDay,
                ["dayMark"] = "Half",
            });
        var answer = JsonSerializer.Serialize(mark);
        mark.Status.Should().Be("applied", "the only work he may see says Half: nothing he cannot see refuses him ({0})", answer);
        answer.Should().NotContain(N1HiddenLog.ToString()).And.NotContain(N1HiddenCrew.ToString()).And.NotContain(N1SecretTask);

        // The owner is told: one flag naming the record, readable by him, never by someone the record is kept from.
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'AttendanceMarkDisagreesWithRestrictedRecord' AND payload::text LIKE '%' || @id::text || '%'", N1HiddenLog))
            .Should().Be(1);
        var (_, ownerTrail) = await GetAsync($"/shramsafal/audit?farmId={FarmA}", Owner);
        ownerTrail.Should().Contain("AttendanceMarkDisagreesWithRestrictedRecord");
        var (_, coOwnerTrail) = await GetAsync($"/shramsafal/audit?farmId={FarmA}", CoOwner);
        coOwnerTrail.Should().NotContain("AttendanceMarkDisagreesWithRestrictedRecord").And.NotContain(N1HiddenLog.ToString());

        // And when HE marks that day, he sees every record: the full check asks him to rule.
        var ownerMark = await PushAsync(Owner, "attendance.mark", $"attendance.mark:{FarmA}:{FieldOperator}:{WorkDay}:Full:-:-:-:fix2",
            new Dictionary<string, object?>
            {
                ["attendanceMarkId"] = Guid.NewGuid(),
                ["farmId"] = FarmA,
                ["fieldOperatorId"] = FieldOperator,
                ["workDate"] = WorkDay,
                ["dayMark"] = "Full",
            });
        ownerMark.ErrorCode.Should().Be("ShramSafal.AttendanceContradiction");
    }

    // ── D-69 ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task D69_a_record_whose_own_money_is_kept_from_him_comes_without_its_amounts_and_money_words()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        var log = LogPayload(D69Log, Owner, D69Crew, 4, null, D69CrewTotal, [], D69Input);
        log["content"] = new
        {
            schema = 1,
            fullTranscript = D69Words,
            inputs = new object[]
            {
                new
                {
                    id = "in-1", productName = "औषध", quantity = 1, unit = "l", cost = D69Input,
                    numbers = new { cost = new { certainty = "reported", spokenText = D69Words } },
                },
            },
        };
        await PushAppliedAsync(Owner, "create_daily_log", "fix2-d69-log", log);
        var money = MoneyEntryIdentity.ForRecordLine(D69Log, MoneyEntryIdentity.Input, "in-1");
        await PushAppliedAsync(Owner, "add_cost_entry", "fix2-d69-money", CostPayload(money, FarmA, PlotA, CycleA, D69Input));
        await SetAudienceAsync(Owner, "CostEntry", money, "OnlyMe"); // the record stays the team's

        foreach (var reader in new[] { Mukadam, CoOwner })
        {
            var (body, root) = await PullAsync(reader);
            var record = ArrayOf(root, "dailyLogs").Single(l => l.GetProperty("id").GetGuid() == D69Log);
            body.Should().NotContain("2468.77", $"{reader}: the record's own price follows its money").And.NotContain("1593.57");
            body.Should().NotContain(D69Words, $"{reader}: the words that name the money go with it");
            record.GetProperty("wordsWithheldForMoney").GetBoolean().Should().BeTrue("the D-66 wording says why");
            record.GetProperty("content").GetProperty("amountsWithheld").GetBoolean().Should().BeTrue();
        }

        // A team record whose money is the team's too is unchanged for him.
        var (mukadamBody, _) = await PullAsync(Mukadam);
        mukadamBody.Should().Contain("3457.36").And.Contain("777.73");

        // The labour page: the crew's stated money is not in his review card.
        var (status, labour) = await GetAsync($"/shramsafal/farms/{FarmA}/labour?window=alltime", CoOwner);
        status.Should().Be(HttpStatusCode.OK, labour);
        labour.Should().NotContain("1593.57");
    }

    // ── N2 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task N2_a_bill_photo_is_never_kept_from_the_person_who_took_it_at_upload_or_read()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        await PushAppliedAsync(Mukadam, "create_attachment", "fix2-n2-mukadam-bill", Photo(MukadamBill, FarmA, "Bill"));
        await PushAppliedAsync(Owner, "create_attachment", "fix2-n2-owner-bill", Photo(OwnerBill, FarmA, "Bill"));
        // A money record kept from him whose bill list cannot be read: the farm's bills fail closed (L7)...
        await ExecOnSuperuserAsync("""UPDATE ssf.cost_entries SET client_attachment_ids_json = '{"not":"a list"}'::jsonb WHERE "Id" = @id""",
            ("id", PrivateCost));

        (await UploadGateAsync(MukadamBill, Mukadam)).Should().BeNull("...except his own photo, at upload");
        (await UploadGateAsync(OwnerBill, Mukadam)).Should().Be(Closed, "someone else's bill still fails closed");
        var (body, _) = await PullAsync(Mukadam);
        body.Should().Contain(MukadamBill.ToString(), "and at every read").And.NotContain(OwnerBill.ToString());
    }

    // ── N3: each gated online door that had no test of its own ───────────────────────────

    /// <summary>
    /// One case per door, each refused by its OWN gate (red without it, run B in the fix-2 evidence). The caller passes every
    /// check that comes before the gate (the मुकादम holds हजेरी; the सहमालक sees money and wages and confirms records), so
    /// nothing but the record's audience can refuse him; the doors run with his farm claim, as their routes run them.
    /// </summary>
    [Theory]
    [InlineData("attach-field-operator")]
    [InlineData("attachment-upload")]
    [InlineData("create-log-replay")]
    [InlineData("compliance-acknowledge")]
    [InlineData("compliance-resolve")]
    [InlineData("question-events")]
    [InlineData("verify-for-payout")]
    [InlineData("rest-cost-correct")]
    [InlineData("rest-cost-allocate")]
    public async Task N3_each_gated_online_door_refuses_a_record_kept_from_the_caller(string door)
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        if (door.StartsWith("compliance", StringComparison.Ordinal))
        {
            await using var db = NewSuperuserContext();
            db.ComplianceSignals.Add(ComplianceSignal.Open(
                Signal, new FarmId(FarmA), PlotA, CycleA, ComplianceRuleCode.UnresolvedDisputeAgeHigh, ComplianceSeverity.NeedsAttention,
                ComplianceSuggestedAction.ResolveDispute, "t", "t", "d", "d",
                JsonSerializer.Serialize(new { dailyLogId = PrivateLog }), DateTime.UtcNow));
            await db.SaveChangesAsync();
        }

        var code = door switch
        {
            "attach-field-operator" => await AsFarmMemberAsync(FarmA, Mukadam, async sp => CodeOf(await sp
                .GetRequiredService<IHandler<AttachFieldOperatorCommand, AttachFieldOperatorResult>>()
                .HandleAsync(new AttachFieldOperatorCommand(new FarmId(FarmA), FieldOperator, PrivateCrew, new UserId(Mukadam))))),
            "attachment-upload" => await UploadGateAsync(PrivatePhoto, CoOwner),
            "create-log-replay" => await AsFarmMemberAsync(FarmA, Mukadam, async sp => CodeOf(await sp
                .GetRequiredService<IHandler<CreateDailyLogCommand, DailyLogDto>>()
                .HandleAsync(new CreateDailyLogCommand(
                    FarmA, PlotA, CycleA, Mukadam, Mukadam, new DateOnly(2026, 10, 30), null, $"device-mu3-{Owner:N}", "prv-private-log")))),
            "compliance-acknowledge" => await AsFarmMemberAsync(FarmA, CoOwner, async sp => CodeOf(await sp
                .GetRequiredService<IHandler<AcknowledgeSignalCommand>>()
                .HandleAsync(new AcknowledgeSignalCommand(Signal, new UserId(CoOwner), AppRole.SecondaryOwner)))),
            "compliance-resolve" => await AsFarmMemberAsync(FarmA, CoOwner, async sp => CodeOf(await sp
                .GetRequiredService<IHandler<ResolveSignalCommand>>()
                .HandleAsync(new ResolveSignalCommand(Signal, new UserId(CoOwner), AppRole.SecondaryOwner, "झालं")))),
            "question-events" => await AsFarmMemberAsync(FarmA, CoOwner, async sp => CodeOf(await sp
                .GetRequiredService<RecordQuestionEventHandler>()
                .HandleAsync(new RecordQuestionEventCommand(
                    CoOwner, FarmA, PlotA, PrivateLog, "q.fix2", "Grapes", null, null, "LogDate", "Log", "Choice", "Work", 1, 1, 0,
                    "tap", "Safe", true, true, "b1", "e1", null, DateTime.UtcNow, null, null, "हो", null, null, null)))),
            "verify-for-payout" => await AsFarmMemberAsync(FarmA, CoOwner, async sp => CodeOf(await sp
                .GetRequiredService<VerifyJobCardForPayoutHandler>()
                .HandleAsync(new VerifyJobCardForPayoutCommand(JobCard, new UserId(CoOwner), null)))),
            "rest-cost-correct" => await AsFarmMemberAsync(FarmA, CoOwner, async sp => CodeOf(await sp
                .GetRequiredService<CorrectCostEntryHandler>()
                .HandleAsync(new CorrectCostEntryCommand(PrivateCost, 1.11m, "INR", "चूक", CoOwner)))),
            "rest-cost-allocate" => await AsFarmMemberAsync(FarmA, CoOwner, async sp => CodeOf(await sp
                .GetRequiredService<AllocateGlobalExpenseHandler>()
                .HandleAsync(new AllocateGlobalExpenseCommand(
                    PrivateCost, "equal", [new AllocateGlobalExpenseAllocationCommand(PlotA, PrivateCostAmount)], CoOwner)))),
            _ => throw new ArgumentOutOfRangeException(nameof(door), door, null),
        };

        code.Should().Be(Closed, $"{door}: a record kept from him is refused by its audience, before anything else is done");
    }

    [Fact]
    public async Task N3_the_add_cost_duplicate_flag_never_compares_money_kept_from_the_caller()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();

        async Task<bool> DuplicateFor(Guid user) => await AsFarmMemberAsync(FarmA, user, async sp =>
        {
            var result = await sp.GetRequiredService<IHandler<AddCostEntryCommand, AddCostEntryResultDto>>()
                .HandleAsync(new AddCostEntryCommand(FarmA, PlotA, CycleA, "fertilizer", "खत", PrivateCostAmount, "INR",
                    new DateOnly(2026, 10, 30), user));
            result.IsSuccess.Should().BeTrue("{0}", result.IsSuccess ? "-" : result.Error.Code);
            return result.Value!.IsPotentialDuplicate;
        });
        (await DuplicateFor(CoOwner)).Should().BeFalse("money kept from him is never named, not even as a possible duplicate");
        (await DuplicateFor(Owner)).Should().BeTrue("the detector itself works: the holder sees that money");
    }

    private static string? CodeOf(AgriSync.BuildingBlocks.Results.Result result) => result.IsSuccess ? null : result.Error.Code;

    // ── Helpers ──────────────────────────────────────────────────────────────────────────

    /// <summary>A team record by the owner with one priced input line, and the money that line made (its derived id).</summary>
    private async Task<Guid> RecordWithLineMoneyAsync(Guid logId, string key, decimal amount)
    {
        await PushAppliedAsync(Owner, "create_daily_log", $"{key}-log", LogPayload(logId, Owner, Guid.NewGuid(), 2, null, null, [], amount));
        var money = MoneyEntryIdentity.ForRecordLine(logId, MoneyEntryIdentity.Input, "in-1");
        await PushAppliedAsync(Owner, "add_cost_entry", $"{key}-money", CostPayload(money, FarmA, PlotA, CycleA, amount));
        return money;
    }

    /// <summary>A record by the owner whose crew engaged the farm's हजेरी person on the work day, with this shift.</summary>
    private async Task EngageAsync(Guid logId, Guid crewId, string shift, string task, string key)
    {
        var log = LogPayload(logId, Owner, crewId, 1, null, null, [], null);
        ((object[])log["labour"]!)[0] = new Dictionary<string, object?>
        {
            ["labourAssignmentId"] = crewId,
            ["engagementType"] = "hired_daily",
            ["workerCount"] = 1,
            ["shift"] = shift,
            ["task"] = task,
        };
        await PushAppliedAsync(Owner, "create_daily_log", key, log);
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.field_operator_work_rows ("Id", field_operator_id, labour_assignment_id, farm_id, work_date,
                                                      display_name_at_attach, recorded_by_user_id, created_at_utc)
            VALUES (gen_random_uuid(), @op, @crew, @farm, DATE '2026-10-30', 'हजेरी-शंकर', @owner, NOW())
            """, ("op", FieldOperator), ("crew", crewId), ("farm", FarmA), ("owner", Owner));
    }

    /// <summary>The upload door's own gate (UploadAttachmentAuthorizer) for this person: null = admitted, else the code.</summary>
    private Task<string?> UploadGateAsync(Guid attachmentId, Guid user) => AsFarmMemberAsync(FarmA, user, async sp =>
    {
        var result = await new UploadAttachmentAuthorizer(sp.GetRequiredService<IShramSafalRepository>())
            .AuthorizeAsync(new UploadAttachmentCommand(attachmentId, Stream.Null, user), default);
        return result.IsSuccess ? null : result.Error.Code;
    });
}

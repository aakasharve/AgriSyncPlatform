// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-GATE-a ("the planning state and the stage plan, on the server").
//
// What the three SCH-GATE real-Postgres suites share, on top of the seeded farm and the checked-schedule arrangement of SCH-A
// (ScheduleCheckLane): the farm owner's ACCOUNT and its subscription (the trial), written as superuser (arrangement only - the
// code under test reads them through ssf.subscription_projections as agrisync_app), a crop season that starts on a day of our
// choosing, a push as any app version, and the stage-plan route.
//
// RoleScopedFarm seeds farm A with owner_account_id = AccountA but NO accounts.owner_accounts row (found: none), so the account is
// seeded here before its subscription. Fake phone numbers only (the base farm's 93000000xx, the review seats' 600000xxxx).
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Domain.Planning;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

public abstract class ScheduleGateLane(ITestOutputHelper output) : ScheduleCheckLane(output)
{
    // Accounts.Domain.Subscriptions.SubscriptionStatus numeric values.
    protected const int Trialing = 1;
    protected const int Active = 2;
    protected const int Expired = 4;

    private static readonly JsonSerializerOptions WebOptions = new(JsonSerializerDefaults.Web);
    private bool _seatsSeeded;

    /// <summary>A Public Institution schedule row that stores its days and ShramSafal has CHECKED (Approved), crop "grape".</summary>
    protected async Task<ScheduleTemplate> CheckedInstitutionAsync(string name = "Grapes - University Schedule")
    {
        if (!_seatsSeeded)
        {
            _seatsSeeded = true;
            await SeedReviewSeatsAsync();
        }

        var row = await SeedStoredRowAsync(name);
        (await CheckAsync(PlatformOwner, row.Id, "Approved", ActivityIdsOf(row))).Status.Should().Be(HttpStatusCode.OK);
        return row;
    }

    /// <summary>
    /// The owner account and its ONE subscription row (replacing any earlier one), as superuser. <paramref name="updatedAtUtc"/> is what
    /// the row says it was last changed: the "no row changed" proof reads it back.
    /// </summary>
    protected async Task SetStandingAsync(
        Guid account, Guid primaryOwner, int status, DateTime trialEndsUtc, DateTime validUntilUtc, DateTime? updatedAtUtc = null)
    {
        await ExecOnSuperuserAsync("""
            INSERT INTO accounts.owner_accounts
                (owner_account_id, account_name, primary_owner_user_id, account_type, status, created_at_utc, modified_at_utc, bootstrapped_farm_id)
            SELECT @a, 'SCH-GATE probe account', @o, 1, 1, NOW(), NOW(), NULL
            WHERE NOT EXISTS (SELECT 1 FROM accounts.owner_accounts WHERE owner_account_id = @a);
            DELETE FROM accounts.subscriptions WHERE owner_account_id = @a;
            INSERT INTO accounts.subscriptions
                (subscription_id, owner_account_id, plan_code, status, valid_from_utc, valid_until_utc, trial_ends_at_utc, created_at_utc, updated_at_utc)
            VALUES (gen_random_uuid(), @a, 'shramsafal_pro', @s, @from, @until, @trial, @from, @updated);
            """,
            ("a", account), ("o", primaryOwner), ("s", status), ("from", validUntilUtc.AddDays(-30)), ("until", validUntilUtc),
            ("trial", trialEndsUtc), ("updated", updatedAtUtc ?? DateTime.UtcNow));
    }

    /// <summary>A pilot access extension on the account (R9: counts as AFTER the trial).</summary>
    protected Task SetExtensionAsync(Guid account, DateTime startsUtc, DateTime endsUtc) =>
        ExecOnSuperuserAsync("""
            INSERT INTO accounts.access_extensions
                (access_extension_id, owner_account_id, reason, starts_at_utc, ends_at_utc, granted_by_user_id, created_at_utc)
            VALUES (gen_random_uuid(), @a, 'sch-gate-probe', @s, @e, 'ffffffff-ffff-ffff-ffff-ffffffffffff', NOW());
            """, ("a", account), ("s", startsUtc), ("e", endsUtc));

    /// <summary>A crop season of <paramref name="crop"/> on a NEW plot of farm A whose day 0 is <paramref name="start"/>.</summary>
    protected async Task<(Guid Plot, Guid Cycle)> SeedSeasonStartingAsync(string crop, DateOnly start, Guid? farmId = null)
    {
        var farm = farmId ?? FarmA;
        var plot = Guid.NewGuid();
        var cycle = Guid.NewGuid();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@plot, @farm, 'SCH-GATE प्लॉट', 1.0, NOW(), NOW());
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@cycle, @farm, @plot, @crop, 'Vegetative', @start, NOW(), NOW());
            """, ("plot", plot), ("farm", farm), ("cycle", cycle), ("crop", crop), ("start", start));
        return (plot, cycle);
    }

    protected static DateOnly TodayIst() => DateOnly.FromDateTime(DateTime.UtcNow + TimeSpan.FromMinutes(330));

    /// <summary>The planning-state row of one plot in a pull body, or null.</summary>
    protected static JsonElement? StateOf(JsonElement root, Guid plot) =>
        ArrayOf(root, "plotPlanningState")
            .Where(s => s.GetProperty("plotId").GetGuid() == plot)
            .Select(s => (JsonElement?)s)
            .FirstOrDefault();

    protected static async Task NextWholeSecondAsync()
    {
        var now = DateTime.UtcNow;
        await Task.Delay(TimeSpan.FromMilliseconds(1000 - now.Millisecond + 30));
    }

    /// <summary>When <c>SGATE_P11_BODIES</c> names a folder, the body this server sent is kept there (the P11 run's input).</summary>
    protected static void KeepGateBody(string who, string body)
    {
        var folder = Environment.GetEnvironmentVariable("SGATE_P11_BODIES");
        if (!string.IsNullOrWhiteSpace(folder))
        {
            System.IO.Directory.CreateDirectory(folder);
            System.IO.File.WriteAllText(System.IO.Path.Combine(folder, $"{who}.json"), body);
        }
    }

    /// <summary>The owner (or any seat) follows <paramref name="template"/> on a plot through the real push door; returns the subscription id.</summary>
    protected async Task<Guid> PushAdoptAsync(Guid actor, Guid plot, Guid cycle, Guid template, string? referenceDate = null)
    {
        var subscription = Guid.NewGuid();
        var payload = new Dictionary<string, object?>
        {
            ["farmId"] = FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["scheduleTemplateId"] = template,
            ["subscriptionId"] = subscription,
            ["actorUserId"] = actor,
        };
        if (referenceDate is not null)
        {
            payload["referenceDate"] = referenceDate;
        }

        await PushOkAsync(actor, "adopt_schedule", $"sgate-adopt-{subscription:N}", payload);
        return subscription;
    }

    protected async Task<SyncMutationResultDto> PushOkAsync(Guid actor, string type, string id, Dictionary<string, object?> payload)
    {
        var result = await PushAsAsync(actor, type, id, payload, "1.0.18");
        result.Status.Should().Be("applied", $"{type}: {result.ErrorCode}: {result.ErrorMessage}");
        return result;
    }

    /// <summary>A push as a phone of <paramref name="appVersion"/> (RoleScopedFarm.PushAsync pins 1.0.18).</summary>
    protected async Task<SyncMutationResultDto> PushAsAsync(
        Guid actor, string mutationType, string clientRequestId, Dictionary<string, object?> payload, string appVersion)
    {
        await using var scope = HostServices.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        var command = new PushSyncBatchCommand(
            DeviceId: $"device-sgate-{actor:N}",
            AuthenticatedUserId: actor,
            ActorRole: "Worker",
            Mutations: [new PushSyncMutationCommand(clientRequestId, mutationType, JsonSerializer.SerializeToElement(payload, WebOptions))],
            AppVersion: appVersion);
        var push = await sp.GetRequiredService<PushSyncBatchHandler>().HandleAsync(command);
        push.IsSuccess.Should().BeTrue("the batch itself is answered: {0}", push.Error?.ToString() ?? "-");
        var result = push.Value!.Results.Single();
        Output.WriteLine($"[SGATE-PUSH] {mutationType} {clientRequestId} by {actor} ({appVersion}) -> {result.Status} {result.ErrorCode}");
        return result;
    }

    protected Task<(HttpStatusCode Status, string Body)> StagePlanAsync(Guid user, Guid farm, Guid plot, string? forDate = null) =>
        SendJsonAsync(HttpMethod.Get,
            $"/shramsafal/farms/{farm}/plots/{plot}/stage-plan" + (forDate is null ? string.Empty : $"?forDate={forDate}"), user, null);

    /// <summary>
    /// A schedule row that STORES its days with stages and works of the test's own choosing (SeedStoredRowAsync fixes the stages),
    /// made through the production import rule. <paramref name="owner"/> Institution is a checked-able Outside row; the maker is the
    /// platform owner unless told otherwise.
    /// </summary>
    protected async Task<ScheduleTemplate> SeedStoredRowWithStagesAsync(
        string name, IReadOnlyList<StageDefinition> stages, IReadOnlyList<ImportedActivity> activities,
        TenantScope scope = TenantScope.Public, Guid? maker = null)
    {
        var template = ScheduleTemplate.Import(
            Guid.NewGuid(), name, ScheduleOwnerType.Institution, "SCH-GATE test recommendation", "grape",
            new AgriSync.SharedKernel.Contracts.Ids.UserId(maker ?? PlatformOwner), scope, DateTime.UtcNow, stages, activities, out var problem);
        problem.Should().BeNull();
        await using var db = NewSuperuserContext();
        db.ScheduleTemplates.Add(template!);
        await db.SaveChangesAsync();
        return template!;
    }

    /// <summary>A THIN Public row (a sample: it stores no days - only each work's start day) of grapes with these works (name, start day).</summary>
    protected async Task<Guid> SeedThinRowAsync(string name, params (string Work, int StartDay)[] works)
    {
        var id = Guid.NewGuid();
        await using var db = NewSuperuserContext();
        var template = ScheduleTemplate.Create(id, name, "Pruning", DateTime.UtcNow);
        foreach (var (work, startDay) in works)
        {
            template.AddActivity(Guid.NewGuid(), work, startDay, FrequencyMode.EveryNDays, 7);
        }

        db.ScheduleTemplates.Add(template);
        await db.SaveChangesAsync();
        return id;
    }

    /// <summary>
    /// A subscription row written as superuser (arrangement only): his OWN schedule cannot be adopted before SCH-OWN opens that branch
    /// (ChooseAsync answers OwnScheduleNotOpenYet), so the Own row of these tests is DB-seeded, as L8b-3's was.
    /// </summary>
    protected Task SeedFollowedRowAsync(
        Guid plot, Guid cycle, Guid template, string origin, short? slot, string? referenceDate = null, string cropKey = "grapes") =>
        ExecOnSuperuserAsync("""
            INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id,
                                                    schedule_version_tag, adopted_at_utc, state, origin, check_state_at_adopt, slot, reference_date)
            VALUES (gen_random_uuid(), @farm, @plot, @cycle, @crop, @template, 'v1', NOW(), 0, @origin, @atAdopt, @slot, @ref::date);
            """,
            ("farm", FarmA), ("plot", plot), ("cycle", cycle), ("crop", cropKey), ("template", template), ("origin", origin),
            ("atAdopt", origin == "Own" ? (object)DBNull.Value : "NotChecked"),
            ("slot", slot is { } s ? (object)s : DBNull.Value), ("ref", referenceDate is null ? (object)DBNull.Value : referenceDate));
}

// spec: 2026-08-12-labour-phase2-server-truth-farm-context
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// LABOUR PHASE 2, Phase 3 — <b>labour read-back, over the real HTTP wire.</b>
///
/// <para>Before this, labour was written and never read back: no endpoint
/// returned labour attached to a log. A farmer recorded 8 workers on Phone A and
/// Phone B, freshly installed, saw the log with no labour on it at all. Founder
/// decision B4 makes read-back a launch requirement, proven by a clean-device
/// journey rather than a unit test — this file is the server half of that
/// journey: everything a second device could possibly reconstruct from, asserted
/// on the actual response body.</para>
///
/// <para><b>Why here and not the Postgres suite.</b> These are statements about
/// the WIRE — what bytes a device receives from <c>/sync/push</c> +
/// <c>/sync/pull</c>. This harness runs the real endpoints, the real handlers and
/// the real repository over EF InMemory, so the round trip is genuine while the
/// assertions stay on the contract. The database-shaped facts (the new
/// <c>notes</c> column, the migration's Up/Down, RLS as <c>agrisync_app</c>) are
/// proven in <c>LabourNotesAndCorrectionDeltaRealPostgresTests</c>, which is
/// tagged <c>RequiresPostgres</c>.</para>
///
/// <para>NOTE: no <c>[Trait("Category","RequiresPostgres")]</c> here, deliberately
/// — this class needs no Postgres, and tagging it would move it into a filtered
/// run where it does not belong.</para>
/// </summary>
public sealed class LabourReadBackPullTests
{
    private const string DeviceId = "device-labour-readback";
    private static readonly Guid TestUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    // ─────────────────────────────────────────────────────────────────────────
    // 1. The headline: a log with labour pulls WITH its labour.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_log_with_labour_pulls_with_its_labour_attached()
    {
        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync();
        var ids = await PushLogWithLabourAsync(harness, workerCount: 8, notes: "पाऊस आला, अर्धाच दिवस");

        var log = await PullLogAsync(harness, ids.LogId, DateTime.UnixEpoch);
        var engagement = log.GetProperty("labour").EnumerateArray().Single();

        Assert.Equal(ids.AssignmentId, engagement.GetProperty("labourAssignmentId").GetGuid());
        Assert.Equal(ids.LogId, engagement.GetProperty("dailyLogId").GetGuid());
        Assert.Equal("Hired", engagement.GetProperty("engagementType").GetString());
        Assert.Equal(8, engagement.GetProperty("workerCount").GetInt32());
        Assert.Equal("छाटणी", engagement.GetProperty("task").GetString());
        Assert.Equal(350m, engagement.GetProperty("wagePerPerson").GetDecimal());
        // NO-MULTIPLY: no total was stated, so none is invented from rate x count.
        Assert.Equal(JsonValueKind.Null, engagement.GetProperty("totalCost").ValueKind);
    }

    /// <summary>
    /// The id the phone minted is the id the phone gets back. This is what lets
    /// the attribution picker and the correction path key on the same id after a
    /// round trip, with no mapping layer — the reason Phase 3 could stay small.
    /// </summary>
    [Fact]
    public async Task The_labour_assignment_id_the_client_minted_is_the_id_it_reads_back()
    {
        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync();
        var ids = await PushLogWithLabourAsync(harness, workerCount: 8);

        var log = await PullLogAsync(harness, ids.LogId, DateTime.UnixEpoch);

        Assert.Equal(
            ids.AssignmentId,
            log.GetProperty("labour").EnumerateArray().Single().GetProperty("labourAssignmentId").GetGuid());
    }

    /// <summary>
    /// Acceptance journey 7, asserted AT THE WIRE DTO rather than only in the
    /// database — which is the whole point of stating it that way: a correct row
    /// and a projection that recounts heads from the attribution list would pass
    /// every database assertion and still shrink the farmer's number.
    /// </summary>
    [Fact]
    public async Task Eight_workers_with_three_named_still_reads_back_as_eight()
    {
        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync();
        var ids = await PushLogWithLabourAsync(harness, workerCount: 8);

        foreach (var name in new[] { "बाळू", "गणेश", "सुनीता" })
        {
            await AttachOperatorAsync(harness, ids.FarmId, ids.AssignmentId, name);
        }

        var log = await PullLogAsync(harness, ids.LogId, DateTime.UnixEpoch);
        var engagement = log.GetProperty("labour").EnumerateArray().Single();

        Assert.Equal(8, engagement.GetProperty("workerCount").GetInt32());
        Assert.Equal(3, engagement.GetProperty("attributedOperators").GetArrayLength());
        Assert.Equal(
            new[] { "बाळू", "गणेश", "सुनीता" },
            engagement.GetProperty("attributedOperators").EnumerateArray()
                .Select(o => o.GetProperty("displayNameAtAttach").GetString())
                .ToArray());
    }

    [Fact]
    public async Task Duration_never_arrives_without_its_basis()
    {
        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync();

        // Stated hours -> Explicit.
        var stated = await PushLogWithLabourAsync(harness, workerCount: 8, durationHours: 6m);
        var statedEngagement = (await PullLogAsync(harness, stated.LogId, DateTime.UnixEpoch))
            .GetProperty("labour").EnumerateArray().Single();
        Assert.Equal(6m, statedEngagement.GetProperty("durationHours").GetDecimal());
        Assert.Equal("Explicit", statedEngagement.GetProperty("timeBasis").GetString());

        // Nothing stated -> the server's own default, honestly labelled Assumed.
        var silent = await PushLogWithLabourAsync(harness, workerCount: 8, durationHours: null, seed: 2);
        var silentEngagement = (await PullLogAsync(harness, silent.LogId, DateTime.UnixEpoch))
            .GetProperty("labour").EnumerateArray().Single();
        Assert.Equal(8m, silentEngagement.GetProperty("durationHours").GetDecimal());
        Assert.Equal("Assumed", silentEngagement.GetProperty("timeBasis").GetString());
    }

    /// <summary>
    /// O-3, end to end: "if the product lets a farmer enter a note, it must
    /// survive capture -> write -> read-back -> clean-device reconstruction."
    /// The note has ridden this exact payload since Labour V1 and the server
    /// threw it away for want of a column.
    /// </summary>
    [Fact]
    public async Task The_farmers_note_survives_capture_write_and_read_back()
    {
        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync();
        var ids = await PushLogWithLabourAsync(harness, workerCount: 8, notes: "बाळू लवकर गेला");

        var log = await PullLogAsync(harness, ids.LogId, DateTime.UnixEpoch);

        Assert.Equal(
            "बाळू लवकर गेला",
            log.GetProperty("labour").EnumerateArray().Single().GetProperty("notes").GetString());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. A log WITHOUT labour, and the three states of the member.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_log_without_labour_pulls_with_every_other_field_unchanged()
    {
        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync();
        var ids = await PushLogWithLabourAsync(harness, workerCount: null, withLabour: false);

        var log = await PullLogAsync(harness, ids.LogId, DateTime.UnixEpoch);

        // The pull LOOKED, so "there is none" is a statement it is entitled to
        // make — and it is how a genuine removal reaches a second device.
        Assert.Equal(JsonValueKind.Array, log.GetProperty("labour").ValueKind);
        Assert.Equal(0, log.GetProperty("labour").GetArrayLength());

        // Everything that shipped before Phase 3 is still exactly where it was.
        Assert.Equal(ids.LogId, log.GetProperty("id").GetGuid());
        Assert.Equal(ids.FarmId, log.GetProperty("farmId").GetGuid());
        Assert.Equal(ids.PlotId, log.GetProperty("plotId").GetGuid());
        Assert.Equal(ids.CropCycleId, log.GetProperty("cropCycleId").GetGuid());
        Assert.Equal("Plot", log.GetProperty("scope").GetString());
        Assert.Equal(new[] { ids.PlotId }, log.GetProperty("plotIds").EnumerateArray().Select(x => x.GetGuid()).ToArray());
        Assert.Equal("2026-02-22", log.GetProperty("logDate").GetString());
        Assert.Equal(JsonValueKind.Array, log.GetProperty("tasks").ValueKind);
        Assert.Equal(JsonValueKind.Array, log.GetProperty("verificationEvents").ValueKind);
    }

    /// <summary>
    /// The distinction the client's reconciler guard turns on. <c>POST /logs</c>
    /// never loads the engagements, so it says NOTHING about labour (<c>null</c>);
    /// the pull did load them, so it states the empty case (<c>[]</c>). Reading an
    /// absent field as an empty one is what deleted a farmer's labour from his own
    /// device in Labour V1.
    /// </summary>
    [Fact]
    public async Task A_response_that_never_loaded_labour_says_null_not_empty()
    {
        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync();
        var ids = await PushLogWithLabourAsync(harness, workerCount: 8);

        var created = await harness.Client.PostAsJsonAsync("/shramsafal/logs", new
        {
            farmId = ids.FarmId,
            plotId = ids.PlotId,
            cropCycleId = ids.CropCycleId,
            logDate = "2026-02-23",
            dailyLogId = Guid.NewGuid(),
            clientRequestId = $"req-post-log-{Guid.NewGuid():N}",
            deviceId = DeviceId,
        });

        created.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        Assert.Equal(JsonValueKind.Null, doc.RootElement.GetProperty("labour").ValueKind);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. THE DELTA TRAP — a correction that persists perfectly and never travels.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// <b>The trap this test exists for passes every other test in this file.</b>
    /// <c>ssf.labour_assignments</c> has no <c>modified_at_utc</c> and corrections
    /// mutate the row in place, while <c>/sync/pull</c> is a delta on
    /// <c>daily_logs.modified_at_utc</c>. So the propagation, not the bump, is what
    /// is asserted here: pull to a cursor, correct 8 -> 6, and pull again FROM that
    /// cursor — which is exactly what a second device does.
    /// </summary>
    [Fact]
    public async Task A_correction_reaches_a_delta_pull_and_carries_the_corrected_number()
    {
        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync();
        var ids = await PushLogWithLabourAsync(harness, workerCount: 8);

        var (firstLog, cursor) = await PullLogAndCursorAsync(harness, ids.LogId, DateTime.UnixEpoch);
        Assert.Equal(8, firstLog.GetProperty("labour").EnumerateArray().Single()
            .GetProperty("workerCount").GetInt32());

        // A second device that has pulled is now caught up: nothing new.
        Assert.Null(await TryPullLogAsync(harness, ids.LogId, cursor));

        await CorrectHeadcountAsync(harness, ids.FarmId, ids.AssignmentId, workerCount: 6);

        var afterCorrection = await TryPullLogAsync(harness, ids.LogId, cursor);
        Assert.NotNull(afterCorrection);
        Assert.Equal(6, afterCorrection!.Value.GetProperty("labour").EnumerateArray().Single()
            .GetProperty("workerCount").GetInt32());
    }

    /// <summary>
    /// The same trap for attribution: who is attributed is part of what a second
    /// device must reconstruct, and an attribution correction moves no column on
    /// <c>labour_assignments</c> at all.
    /// </summary>
    [Fact]
    public async Task An_attribution_correction_also_reaches_a_delta_pull()
    {
        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync();
        var ids = await PushLogWithLabourAsync(harness, workerCount: 8);
        var operatorId = await CreateOperatorAsync(harness, ids.FarmId, "गणेश");

        var (_, cursor) = await PullLogAndCursorAsync(harness, ids.LogId, DateTime.UnixEpoch);
        Assert.Null(await TryPullLogAsync(harness, ids.LogId, cursor));

        await CorrectAsync(harness, ids.FarmId, ids.AssignmentId, new
        {
            clientRequestId = $"req-attr-{Guid.NewGuid():N}",
            reason = "गणेश होता",
            attributionAdds = new[] { operatorId },
        });

        var afterCorrection = await TryPullLogAsync(harness, ids.LogId, cursor);
        Assert.NotNull(afterCorrection);
        var engagement = afterCorrection!.Value.GetProperty("labour").EnumerateArray().Single();
        Assert.Equal("गणेश", engagement.GetProperty("attributedOperators").EnumerateArray().Single()
            .GetProperty("displayNameAtAttach").GetString());
        Assert.Equal(8, engagement.GetProperty("workerCount").GetInt32());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. E4 — the database is not the whole defence.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// An attribution row whose <c>farm_id</c> is NOT its engagement's parent
    /// farm never reaches the wire. Postgres FK checks bypass RLS, and
    /// <c>p_user_select_field_operator_work_rows</c> is PERMISSIVE and OR-ed with
    /// the tenant policy, so a multi-farm login genuinely CAN load such a row —
    /// and it carries <c>displayNameAtAttach</c>, i.e. another farm's worker's
    /// name. Doctrine E4: assert tenancy on BOTH sides in application code.
    ///
    /// <para>And dropping it changes no reported quantity: <c>workerCount</c>
    /// lives on the engagement and is copied, never counted from these rows.</para>
    /// </summary>
    [Fact]
    public async Task An_attribution_row_from_another_farm_never_reaches_the_wire()
    {
        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync();
        var ids = await PushLogWithLabourAsync(harness, workerCount: 8);
        await AttachOperatorAsync(harness, ids.FarmId, ids.AssignmentId, "बाळू");

        // A second farm the SAME login owns, so its rows are genuinely visible.
        var otherFarmId = Guid.NewGuid();
        await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = DeviceId,
            mutations = new object[]
            {
                new
                {
                    clientRequestId = $"req-other-farm-{Guid.NewGuid():N}",
                    mutationType = "create_farm",
                    payload = new { farmId = otherFarmId, name = "Other Farm" },
                },
            },
        });

        await harness.SeedFieldOperatorWorkRowAsync(
            fieldOperatorId: Guid.NewGuid(),
            labourAssignmentId: ids.AssignmentId,
            farmId: otherFarmId,
            workDate: new DateOnly(2026, 2, 22),
            displayNameAtAttach: "दुसऱ्या शेतातील कामगार",
            recordedByUserId: TestUserId);

        var engagement = (await PullLogAsync(harness, ids.LogId, DateTime.UnixEpoch))
            .GetProperty("labour").EnumerateArray().Single();

        var attributed = engagement.GetProperty("attributedOperators").EnumerateArray()
            .Select(o => o.GetProperty("displayNameAtAttach").GetString())
            .ToArray();

        Assert.Equal(new[] { "बाळू" }, attributed);
        Assert.Equal(8, engagement.GetProperty("workerCount").GetInt32());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. The current-truth / history boundary.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// History (<c>ssf.labour_corrections</c>) is fetched on demand and NEVER
    /// rides the pull. The domain states the split verbatim: readers see corrected
    /// truth "without knowing corrections exist". The everyday labour view must
    /// not consume an audit ledger.
    /// </summary>
    [Fact]
    public async Task Correction_history_never_rides_the_pull()
    {
        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync();
        var ids = await PushLogWithLabourAsync(harness, workerCount: 8);
        await CorrectHeadcountAsync(harness, ids.FarmId, ids.AssignmentId, workerCount: 6);

        var response = await harness.Client.GetAsync(
            $"/sync/pull?since={Uri.EscapeDataString(DateTime.UnixEpoch.ToString("O", CultureInfo.InvariantCulture))}");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();

        using var doc = JsonDocument.Parse(body);
        Assert.DoesNotContain(
            doc.RootElement.EnumerateObject(),
            p => p.Name.Contains("correction", StringComparison.OrdinalIgnoreCase)
                 && p.Name.Contains("labour", StringComparison.OrdinalIgnoreCase));

        // The pre-correction value must not travel either — the row was mutated in
        // place, so 8 exists ONLY in the history ledger now.
        var engagement = doc.RootElement.GetProperty("dailyLogs").EnumerateArray()
            .Single(l => l.GetProperty("id").GetGuid() == ids.LogId)
            .GetProperty("labour").EnumerateArray().Single();
        Assert.Equal(6, engagement.GetProperty("workerCount").GetInt32());
        Assert.DoesNotContain(
            engagement.EnumerateObject(),
            p => p.Name.Contains("original", StringComparison.OrdinalIgnoreCase)
                 || p.Name.Contains("correction", StringComparison.OrdinalIgnoreCase)
                 || p.Name.Contains("history", StringComparison.OrdinalIgnoreCase));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Harness helpers.
    // ─────────────────────────────────────────────────────────────────────────

    private sealed record PushedIds(Guid FarmId, Guid PlotId, Guid CropCycleId, Guid LogId, Guid AssignmentId);

    private static async Task<PushedIds> PushLogWithLabourAsync(
        SyncEndpointsTests.TestHarness harness,
        int? workerCount,
        decimal? durationHours = 6m,
        string? notes = null,
        bool withLabour = true,
        int seed = 1)
    {
        var ids = new PushedIds(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var tag = $"{seed}-{Guid.NewGuid():N}";

        var farmResponse = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = DeviceId,
            mutations = new object[]
            {
                new
                {
                    clientRequestId = $"req-farm-{tag}",
                    mutationType = "create_farm",
                    payload = new { farmId = ids.FarmId, name = "Read-back Farm" },
                },
            },
        });
        farmResponse.EnsureSuccessStatusCode();

        object labourItem = new
        {
            labourAssignmentId = ids.AssignmentId,
            engagementType = "hired_daily",
            workerCount,
            wagePerPerson = 350m,
            task = "छाटणी",
            notes,
            durationHours,
        };

        var response = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = DeviceId,
            mutations = new object[]
            {
                new
                {
                    clientRequestId = $"req-plot-{tag}",
                    mutationType = "create_plot",
                    payload = new { plotId = ids.PlotId, farmId = ids.FarmId, name = "Read-back Plot", areaInAcres = 1m },
                },
                new
                {
                    clientRequestId = $"req-cycle-{tag}",
                    mutationType = "create_crop_cycle",
                    payload = new
                    {
                        cropCycleId = ids.CropCycleId,
                        farmId = ids.FarmId,
                        plotId = ids.PlotId,
                        cropName = "Grapes",
                        stage = "Growth",
                        startDate = "2026-02-21",
                    },
                },
                new
                {
                    clientRequestId = $"req-log-{tag}",
                    mutationType = "create_daily_log",
                    payload = withLabour
                        ? new
                        {
                            dailyLogId = ids.LogId,
                            farmId = ids.FarmId,
                            plotId = ids.PlotId,
                            cropCycleId = ids.CropCycleId,
                            logDate = "2026-02-22",
                            labour = new[] { labourItem },
                        }
                        : (object)new
                        {
                            dailyLogId = ids.LogId,
                            farmId = ids.FarmId,
                            plotId = ids.PlotId,
                            cropCycleId = ids.CropCycleId,
                            logDate = "2026-02-22",
                        },
                },
            },
        });

        response.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.DoesNotContain(
            doc.RootElement.GetProperty("results").EnumerateArray(),
            x => x.GetProperty("status").GetString() == "failed");

        return ids;
    }

    private static async Task<JsonElement> PullLogAsync(
        SyncEndpointsTests.TestHarness harness, Guid logId, DateTime since)
    {
        var log = await TryPullLogAsync(harness, logId, since);
        Assert.NotNull(log);
        return log!.Value;
    }

    private static async Task<(JsonElement Log, DateTime Cursor)> PullLogAndCursorAsync(
        SyncEndpointsTests.TestHarness harness, Guid logId, DateTime since)
    {
        var (log, cursor) = await PullAsync(harness, logId, since);
        Assert.NotNull(log);
        return (log!.Value, cursor);
    }

    private static async Task<JsonElement?> TryPullLogAsync(
        SyncEndpointsTests.TestHarness harness, Guid logId, DateTime since)
        => (await PullAsync(harness, logId, since)).Log;

    /// <summary>
    /// One pull, returning the requested log (or null) and the server's next
    /// cursor. <c>JsonDocument</c> is cloned out because the document is disposed
    /// here — an un-cloned element would be reading freed memory.
    /// </summary>
    private static async Task<(JsonElement? Log, DateTime Cursor)> PullAsync(
        SyncEndpointsTests.TestHarness harness, Guid logId, DateTime since)
    {
        var response = await harness.Client.GetAsync(
            $"/sync/pull?since={Uri.EscapeDataString(since.ToString("O", CultureInfo.InvariantCulture))}");
        response.EnsureSuccessStatusCode();

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var cursor = doc.RootElement.GetProperty("nextCursorUtc").GetDateTime();
        foreach (var log in doc.RootElement.GetProperty("dailyLogs").EnumerateArray())
        {
            if (log.GetProperty("id").GetGuid() == logId)
            {
                return (log.Clone(), cursor);
            }
        }

        return (null, cursor);
    }

    private static async Task<Guid> CreateOperatorAsync(
        SyncEndpointsTests.TestHarness harness, Guid farmId, string displayName)
    {
        var response = await harness.Client.PostAsJsonAsync(
            $"/shramsafal/farms/{farmId}/labour/field-operators",
            new { displayName, fullName = (string?)null });
        response.EnsureSuccessStatusCode();

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("id").GetGuid();
    }

    private static async Task AttachOperatorAsync(
        SyncEndpointsTests.TestHarness harness, Guid farmId, Guid assignmentId, string displayName)
    {
        var operatorId = await CreateOperatorAsync(harness, farmId, displayName);
        var response = await harness.Client.PostAsJsonAsync(
            $"/shramsafal/farms/{farmId}/labour/field-operators/{operatorId}/attach",
            new { labourAssignmentId = assignmentId });
        response.EnsureSuccessStatusCode();
    }

    private static Task CorrectHeadcountAsync(
        SyncEndpointsTests.TestHarness harness, Guid farmId, Guid assignmentId, int workerCount)
        => CorrectAsync(harness, farmId, assignmentId, new
        {
            clientRequestId = $"req-correct-{Guid.NewGuid():N}",
            reason = "मोजून पाहिलं",
            quantity = new { workerCount, maleCount = (int?)null, femaleCount = (int?)null },
        });

    private static async Task CorrectAsync(
        SyncEndpointsTests.TestHarness harness, Guid farmId, Guid assignmentId, object body)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/shramsafal/farms/{farmId}/labour/assignments/{assignmentId}/corrections")
        {
            Content = JsonContent.Create(body),
        };
        request.Headers.Add("X-Device-Id", DeviceId);

        var response = await harness.Client.SendAsync(request);
        response.EnsureSuccessStatusCode();
    }
}

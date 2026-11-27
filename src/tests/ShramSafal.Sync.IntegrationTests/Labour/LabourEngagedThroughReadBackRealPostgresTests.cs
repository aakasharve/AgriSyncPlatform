// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9 paper, part 8b (a): "कोणामार्फत?" read back)
//
// A crew recorded THROUGH a मुकादम (engagedThroughFieldOperatorId on a labour line of create_daily_log) was stored and never came back: after the next
// pull, on a second phone or after a reinstall, the phone could not show whom he picked. The pull now carries it on the labour line, written ONLY when
// it is set, so the bytes of every line that has none are what they were. Real Postgres as the restricted application role (E3 first).
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Labour;

[Trait("Category", "RequiresPostgres")]
public sealed class LabourEngagedThroughReadBackRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly Guid ThroughLog = Guid.Parse("d98b0000-0000-4000-8000-000000000001");
    private static readonly Guid ThroughCrew = Guid.Parse("d98b0000-0000-4000-8000-000000000002");

    private static JsonElement CrewOf(JsonElement root, Guid logId, Guid crewId) =>
        root.GetProperty("dailyLogs").EnumerateArray().Single(l => l.GetProperty("id").GetGuid() == logId)
            .GetProperty("labour").EnumerateArray().Single(c => c.GetProperty("labourAssignmentId").GetGuid() == crewId);

    [Fact]
    public async Task A_crew_pushed_through_a_mukadam_comes_back_with_him_on_the_pull()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var payload = LogPayload(ThroughLog, Owner, ThroughCrew, 6, null, null, [], null);
        payload["logDate"] = "2026-10-29";
        ((Dictionary<string, object?>)((object[])payload["labour"]!)[0])["engagedThroughFieldOperatorId"] = FieldOperator;
        await PushAppliedAsync(Owner, "create_daily_log", "d9-8b-through", payload);

        // Any phone of the farm that reads the record (here a second person, from the beginning: a second phone or a reinstall).
        foreach (var reader in new[] { Owner, CoOwner })
        {
            var (_, root) = await PullAsync(reader);
            var crew = CrewOf(root, ThroughLog, ThroughCrew);
            crew.GetProperty("engagedThroughFieldOperatorId").GetGuid().Should().Be(FieldOperator, $"{reader} is told whom the crew came through");
            crew.GetProperty("workerCount").GetInt32().Should().Be(6, "the read-back never changes the reported headcount (P7)");

            // A crew recorded with no मुकादम has no such key at all: its bytes are what they were before this change.
            var plain = CrewOf(root, OwnerLog, OwnerCrew);
            plain.TryGetProperty("engagedThroughFieldOperatorId", out _).Should().BeFalse("written only when set");
            plain.GetRawText().Should().NotContain("engagedThrough");
        }
    }
}

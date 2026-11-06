// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-1 Task 1 (Review Focus 3: "one shared crop <-> schedule
// rule, not two"). C# <-> TS CROP RULE PARITY, the C# half. One shared fixture pins both sides:
// sync-contract/tests/fixtures/crop-schedule-match.json. The TS half, TemplateCatalog.cropRule.parity.test.ts, proves the
// phone's library reads every name as the fixture says; this proves the server's ScheduleLibrary does — including the
// built-in library's own crops (ReferenceDataCatalog), so a crop type the server serves is read the same way.
using System.Text.Json;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;
using Xunit;

namespace ShramSafal.Domain.Tests.Schedules;

public sealed class ScheduleLibraryCropRuleTests
{
    public static TheoryData<string, string, string> Cases()
    {
        var data = new TheoryData<string, string, string>();
        foreach (var c in Fixture().RootElement.GetProperty("cases").EnumerateArray())
        {
            data.Add(c.GetProperty("name").GetString()!, c.GetProperty("cycleCrop").GetString()!, c.GetProperty("cropCode").GetString()!);
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void The_server_reads_a_crop_name_exactly_as_the_phone_library_does(string name, string cycleCrop, string cropCode)
    {
        Assert.True(ScheduleLibrary.CropCode(cycleCrop) == cropCode, $"{name}: '{cycleCrop}' read as {ScheduleLibrary.CropCode(cycleCrop)}, not {cropCode}");

        // The built-in library: exactly the schedules of its crop match, and no other.
        foreach (var template in ReferenceDataCatalog.ScheduleTemplates)
        {
            var sameCrop = ScheduleLibrary.CropCode(template.CropType) == cropCode;
            Assert.Equal(sameCrop, ScheduleLibrary.MatchesCrop(template, cycleCrop));
        }
    }

    [Fact]
    public void The_fixture_names_the_built_in_library_exactly()
    {
        var builtIns = Fixture().RootElement.GetProperty("builtInTemplates").EnumerateArray()
            .Select(t => (Id: t.GetProperty("id").GetGuid(), Code: t.GetProperty("cropCode").GetString()))
            .OrderBy(t => t.Id)
            .ToList();
        var catalog = ReferenceDataCatalog.ScheduleTemplates
            .Select(t => (t.Id, Code: (string?)ScheduleLibrary.CropCode(t.CropType)))
            .OrderBy(t => t.Id)
            .ToList();
        Assert.Equal(catalog, builtIns);
    }

    [Fact]
    public void A_listed_schedules_version_tag_fits_the_subscription_column()
    {
        var tag = ScheduleLibrary.VersionTagOf(ReferenceDataCatalog.ScheduleTemplates[0]);
        Assert.Equal(ScheduleLibrary.MaxVersionTagLength, tag.Length);
        Assert.StartsWith(tag, ReferenceDataCatalog.VersionHash, StringComparison.Ordinal);
    }

    private static JsonDocument Fixture()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "sync-contract", "tests", "fixtures", "crop-schedule-match.json");
            if (File.Exists(candidate))
            {
                return JsonDocument.Parse(File.ReadAllText(candidate));
            }

            current = current.Parent;
        }

        throw new FileNotFoundException("sync-contract/tests/fixtures/crop-schedule-match.json was not found above the test output.");
    }
}

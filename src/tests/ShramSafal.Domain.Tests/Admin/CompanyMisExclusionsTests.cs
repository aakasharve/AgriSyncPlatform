// spec: company-mis-real-numbers-2026-11-15 (plan CR-2a, Task 2, decision 4)
//
// The test-account list: configuration key CompanyMis:ExcludedUserIds, user
// GUIDs only. Blanks are ignored; a value that is not a GUID stops start-up
// with a message naming the key and the position, never the value itself.
// Made-up GUIDs only.

using FluentAssertions;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using Xunit;

namespace ShramSafal.Domain.Tests.Admin;

public sealed class CompanyMisExclusionsTests
{
    private static readonly Guid FakeOne = Guid.Parse("eeeeeeee-0000-0000-0000-000000000001");
    private static readonly Guid FakeTwo = Guid.Parse("eeeeeeee-0000-0000-0000-000000000002");

    [Fact]
    public void Parse_accepts_guids_and_ignores_blanks()
    {
        var parsed = CompanyMisExclusions.Parse(new[]
        {
            "  " + FakeOne.ToString("D") + "  ",
            "",
            null,
            "   ",
            FakeTwo.ToString("D").ToUpperInvariant(),
        });

        parsed.UserIds.Should().BeEquivalentTo(new[] { FakeOne, FakeTwo });

        CompanyMisExclusions.Parse(null).UserIds.Should().BeEmpty("no key at all is an empty list");
        CompanyMisExclusions.Parse(Array.Empty<string?>()).UserIds.Should().BeEmpty("appsettings.json carries []");
    }

    [Fact]
    public void Parse_refuses_a_non_guid_without_echoing_it()
    {
        const string NotAGuid = "fake-phone-number-not-an-id";

        var act = () => CompanyMisExclusions.Parse(new[] { FakeOne.ToString("D"), FakeTwo.ToString("D"), NotAGuid });

        var thrown = act.Should().Throw<InvalidOperationException>().Which;
        thrown.Message.Should().Contain("CompanyMis:ExcludedUserIds", "the message names the key to fix");
        thrown.Message.Should().NotContain(NotAGuid, "the value may be personal data and is never echoed");
        // The bad entry is the third (index 2); either counting convention names it.
        thrown.Message.Should().MatchRegex(@"(?<!\d)[23](?!\d)", "the message names the position of the bad entry");
    }
}

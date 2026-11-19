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

    // Review finding V1: CompanyMis__ExcludedUserIds=<id> (no __0) must not silently become an empty list.

    [Fact]
    public void A_single_value_with_no_list_entries_is_refused_and_asks_for_a_list()
    {
        var single = FakeOne.ToString("D");

        var act = () => CompanyMisExclusions.FromConfiguration(single, Array.Empty<string?>());

        var thrown = act.Should().Throw<InvalidOperationException>().Which;
        thrown.Message.Should().Contain("CompanyMis:ExcludedUserIds", "the message names the key to fix");
        thrown.Message.Should().MatchRegex("(?i)list|__0|:0", "the message asks for a list");
        thrown.Message.Should().NotContain(single, "the value is never echoed");

        var noChildren = () => CompanyMisExclusions.FromConfiguration(single, null);
        noChildren.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void A_proper_list_is_accepted_from_configuration()
    {
        var parsed = CompanyMisExclusions.FromConfiguration(
            null, new[] { FakeOne.ToString("D"), " " + FakeTwo.ToString("D") + " " });

        parsed.UserIds.Should().BeEquivalentTo(new[] { FakeOne, FakeTwo });
    }

    [Fact]
    public void An_absent_key_is_an_empty_list()
    {
        CompanyMisExclusions.FromConfiguration(null, null).UserIds.Should().BeEmpty();
        CompanyMisExclusions.FromConfiguration(null, Array.Empty<string?>()).UserIds.Should().BeEmpty();
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

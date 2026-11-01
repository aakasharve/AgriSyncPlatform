// spec: plr-d10 lane PRV fix pass 3 (M-A) — the audience algebra a record's change applies to its money: everyone in both,
// never anyone in only one; Selected people with nobody in common leave Only me.
using FluentAssertions;
using ShramSafal.Domain.RecordPrivacy;
using Xunit;

namespace ShramSafal.Domain.Tests.RecordPrivacy;

public sealed class RecordAudienceFixThreeTests
{
    private static readonly Guid A = Guid.Parse("7a000000-0000-4000-8000-0000000000a1");
    private static readonly Guid B = Guid.Parse("7a000000-0000-4000-8000-0000000000b1");
    private static readonly Guid C = Guid.Parse("7a000000-0000-4000-8000-0000000000c1");

    private static AudienceSet Selected(params Guid[] people) => AudienceSet.Of(RecordAudience.Selected, people);

    [Fact]
    public void Intersect_keeps_only_whom_both_admit()
    {
        AudienceSet.Team.Intersect(AudienceSet.OnlyMe).SameAs(AudienceSet.OnlyMe).Should().BeTrue();
        AudienceSet.Team.Intersect(Selected(A, B)).SameAs(Selected(A, B)).Should().BeTrue();
        Selected(A).Intersect(Selected(A, B)).SameAs(Selected(A)).Should().BeTrue("money inside keeps its own choice; B is not added");
        Selected(A, C).Intersect(Selected(A, B)).SameAs(Selected(A)).Should().BeTrue("C loses it, B is not added");
        Selected(C).Intersect(Selected(A, B)).SameAs(AudienceSet.OnlyMe).Should().BeTrue("nobody in common: the holder and the maker only");
        Selected(A).Intersect(AudienceSet.OnlyMe).SameAs(AudienceSet.OnlyMe).Should().BeTrue();
        Selected(A, C).Intersect(AudienceSet.Team).SameAs(Selected(C, A)).Should().BeTrue("a widening to the team gives back his own choice");
    }

    [Fact]
    public void Within_tells_a_narrowing_from_a_widening()
    {
        AudienceSet.Team.Within(Selected(A)).Should().BeFalse("Team -> Selected narrows");
        Selected(A).Within(AudienceSet.Team).Should().BeTrue("Selected -> Team widens");
        Selected(A, B).Within(Selected(A, C)).Should().BeFalse("B is dropped: part narrowing");
        AudienceSet.OnlyMe.Within(Selected(A)).Should().BeTrue();
        AudienceSet.Of(RecordAudience.OnlyMe, [A]).SameAs(AudienceSet.OnlyMe).Should().BeTrue("people count only for Selected");
    }
}

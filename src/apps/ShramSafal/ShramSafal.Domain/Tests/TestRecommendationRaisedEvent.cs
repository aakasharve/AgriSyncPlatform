using AgriSync.BuildingBlocks.Events;

namespace ShramSafal.Domain.Tests;

public sealed class TestRecommendationRaisedEvent : DomainEvent
{
    public TestRecommendationRaisedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid testRecommendationId,
        Guid testInstanceId,
        string ruleCode)
        : base(eventId, occurredOnUtc)
    {
        TestRecommendationId = testRecommendationId;
        TestInstanceId = testInstanceId;
        RuleCode = ruleCode;
    }

    public Guid TestRecommendationId { get; }
    public Guid TestInstanceId { get; }
    public string RuleCode { get; }
}

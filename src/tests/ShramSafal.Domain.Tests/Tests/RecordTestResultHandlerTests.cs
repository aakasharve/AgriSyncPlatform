using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Tests.RecordTestResult;
using ShramSafal.Domain.Tests;
using Xunit;

namespace ShramSafal.Domain.Tests.Tests;

public sealed class RecordTestResultHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);

    private static RecordTestResultHandler CreateHandler(
        TestInstance instance,
        out FakeTestInstanceRepository instanceRepo,
        out FakeTestRecommendationRepository recRepo,
        out FakeAuditOnlyRepository auditRepo)
    {
        instanceRepo = new FakeTestInstanceRepository();
        instanceRepo.Seed(instance);
        recRepo = new FakeTestRecommendationRepository();
        auditRepo = new FakeAuditOnlyRepository();
        return new RecordTestResultHandler(instanceRepo, recRepo, auditRepo, new FakeClock(Now));
    }

    private static TestInstance NewCollectedSoilInstance()
    {
        var instance = TestInstance.Schedule(
            id: Guid.NewGuid(),
            testProtocolId: Guid.NewGuid(),
            protocolKind: TestProtocolKind.Soil,
            cropCycleId: Guid.NewGuid(),
            farmId: new FarmId(Guid.NewGuid()),
            plotId: Guid.NewGuid(),
            stageName: "PreFlowering",
            plannedDueDate: new DateOnly(2026, 5, 1),
            createdAtUtc: Now);
        instance.MarkCollected(UserId.New(), AppRole.LabOperator, Now);
        return instance;
    }

    [Fact]
    public async Task RecordTestResult_ValidResults_TransitionsToReported_AndCreatesRecommendations_WhenRuleMatches()
    {
        var instance = NewCollectedSoilInstance();
        var handler = CreateHandler(instance, out var instanceRepo, out var recRepo, out var auditRepo);

        // pH = 5.4 triggers the "soil.ph.low.apply-lime" rule (< 6.0).
        var results = new[]
        {
            new TestResult("pH", "5.4", "pH", 6.0m, 7.5m)
        };
        var attachments = new[] { Guid.NewGuid() };

        var result = await handler.HandleAsync(new RecordTestResultCommand(
            TestInstanceId: instance.Id,
            Results: results,
            AttachmentIds: attachments,
            CallerUserId: UserId.New(),
            CallerRole: AppRole.LabOperator,
            ClientCommandId: "cmd-1"));

        Assert.True(result.IsSuccess); // [DoesNotReturnIf(false)] + [MemberNotNullWhen] enables Value deref
        result.Value.Status.Should().Be("Reported");
        result.Value.Recommendations.Should().HaveCount(1);
        result.Value.Recommendations[0].RuleCode.Should().Be("soil.ph.low.apply-lime");

        instance.Status.Should().Be(TestInstanceStatus.Reported);
        recRepo.Added.Should().HaveCount(1);
        recRepo.Added[0].RuleCode.Should().Be("soil.ph.low.apply-lime");

        auditRepo.AuditEvents.Should().HaveCount(1);
        auditRepo.AuditEvents[0].Action.Should().Be("test.reported");
        auditRepo.AuditEvents[0].ClientCommandId.Should().Be("cmd-1");
    }

    [Fact]
    public async Task RecordTestResult_ValidResults_InRange_DoesNotCreateRecommendations()
    {
        var instance = NewCollectedSoilInstance();
        var handler = CreateHandler(instance, out _, out var recRepo, out var auditRepo);

        var results = new[]
        {
            new TestResult("pH", "6.8", "pH", 6.0m, 7.5m)
        };

        var result = await handler.HandleAsync(new RecordTestResultCommand(
            TestInstanceId: instance.Id,
            Results: results,
            AttachmentIds: new[] { Guid.NewGuid() },
            CallerUserId: UserId.New(),
            CallerRole: AppRole.LabOperator,
            ClientCommandId: null));

        Assert.True(result.IsSuccess); // [DoesNotReturnIf(false)] + [MemberNotNullWhen] enables Value deref
        result.Value.Status.Should().Be("Reported");
        result.Value.Recommendations.Should().BeEmpty();
        recRepo.Added.Should().BeEmpty();
        auditRepo.AuditEvents.Should().HaveCount(1);
    }

    [Fact]
    public async Task RecordTestResult_EmptyAttachments_Returns_Failure()
    {
        var instance = NewCollectedSoilInstance();
        var handler = CreateHandler(instance, out var instanceRepo, out var recRepo, out var auditRepo);

        var results = new[]
        {
            new TestResult("pH", "6.5", "pH", 6.0m, 7.5m)
        };

        var result = await handler.HandleAsync(new RecordTestResultCommand(
            TestInstanceId: instance.Id,
            Results: results,
            AttachmentIds: Array.Empty<Guid>(),
            CallerUserId: UserId.New(),
            CallerRole: AppRole.LabOperator,
            ClientCommandId: null));

        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("ShramSafal.TestAttachmentInvalid");
        instance.Status.Should().Be(TestInstanceStatus.Collected);
        recRepo.Added.Should().BeEmpty();
        auditRepo.AuditEvents.Should().BeEmpty();
        instanceRepo.SaveCalls.Should().Be(0);
    }

    [Fact]
    public async Task RecordTestResult_Worker_Returns_Forbidden()
    {
        var instance = NewCollectedSoilInstance();
        var handler = CreateHandler(instance, out _, out _, out var auditRepo);

        var result = await handler.HandleAsync(new RecordTestResultCommand(
            TestInstanceId: instance.Id,
            Results: new[] { new TestResult("pH", "6.5", "pH", 6.0m, 7.5m) },
            AttachmentIds: new[] { Guid.NewGuid() },
            CallerUserId: UserId.New(),
            CallerRole: AppRole.Worker,
            ClientCommandId: null));

        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("ShramSafal.TestRoleNotAllowed");
        auditRepo.AuditEvents.Should().BeEmpty();
    }
}

using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal static class TypedIdConverters
{
    public static readonly ValueConverter<FarmId, Guid> FarmId =
        new(id => id.Value, value => new FarmId(value));

    public static readonly ValueConverter<UserId, Guid> UserId =
        new(id => id.Value, value => new UserId(value));

    public static readonly ValueConverter<OwnerAccountId, Guid> OwnerAccountId =
        new(id => id.Value, value => new OwnerAccountId(value));

    public static readonly ValueConverter<FarmInvitationId, Guid> FarmInvitationId =
        new(id => id.Value, value => new FarmInvitationId(value));

    public static readonly ValueConverter<FarmJoinTokenId, Guid> FarmJoinTokenId =
        new(id => id.Value, value => new FarmJoinTokenId(value));

    public static readonly ValueConverter<ScheduleTemplateId, Guid> ScheduleTemplateId =
        new(id => id.Value, value => new ScheduleTemplateId(value));

    public static readonly ValueConverter<ScheduleSubscriptionId, Guid> ScheduleSubscriptionId =
        new(id => id.Value, value => new ScheduleSubscriptionId(value));

    public static readonly ValueConverter<ScheduleSubscriptionId?, Guid?> NullableScheduleSubscriptionId =
        new(
            id => id == null ? (Guid?)null : id.Value.Value,
            value => value == null ? null : new ScheduleSubscriptionId(value.Value));

    public static readonly ValueConverter<PrescribedTaskId, Guid> PrescribedTaskId =
        new(id => id.Value, value => new PrescribedTaskId(value));

    public static readonly ValueConverter<PrescribedTaskId?, Guid?> NullablePrescribedTaskId =
        new(
            id => id == null ? (Guid?)null : id.Value.Value,
            value => value == null ? null : new PrescribedTaskId(value.Value));
}

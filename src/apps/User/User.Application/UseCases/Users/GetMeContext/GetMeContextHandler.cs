using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using User.Application.Ports;
using User.Domain.Common;

namespace User.Application.UseCases.Users.GetMeContext;

/// <summary>
/// Assembles the "who am I + what can I see" payload for the semi-literate
/// Marathi farmer. All computation (role→capabilities, subscription→plan
/// string, alerts) happens here so the frontend stays a pure renderer.
/// </summary>
public sealed class GetMeContextHandler(
    IUserRepository userRepository,
    IAccountsSnapshotReader accountsReader,
    IFarmMembershipSnapshotReader membershipReader,
    IAffiliationSnapshotReader affiliationReader,
    IClock clock)
{
    private const int PlanExpiringWindowDays = 7;

    public async Task<Result<MeContextDto>> HandleAsync(UserId userId, CancellationToken ct = default)
    {
        var user = await userRepository.GetByIdAsync(userId.Value, ct);
        if (user is null)
        {
            return Result.Failure<MeContextDto>(UserErrors.UserNotFound);
        }

        // Serialized: accountsReader + affiliationReader share the scoped AccountsDbContext;
        // parallel execution trips EF Core's concurrency detector.
        var accounts = await accountsReader.GetForUserAsync(userId, ct);
        var memberships = await membershipReader.GetForUserAsync(userId, ct);
        var affiliation = await affiliationReader.GetForUserAsync(userId, ct);

        var utcNow = clock.UtcNow;

        var farmDtos = memberships
            .Select(m => MapFarm(m, accounts, userId))
            .ToList();

        var alerts = BuildAlerts(user.PhoneVerifiedAtUtc, farmDtos, utcNow);

        var dto = new MeContextDto(
            Me: new MeIdentityDto(
                UserId: user.Id.Value,
                DisplayName: user.DisplayName,
                PhoneMasked: MaskPhone(user.Phone.Value),
                PhoneVerifiedAtUtc: user.PhoneVerifiedAtUtc,
                PreferredLanguage: user.PreferredLanguage,
                AuthMode: user.AuthMode.ToString()),
            Farms: farmDtos,
            Share: new MeShareDto(
                ReferralCode: affiliation.ReferralCode,
                ReferralsTotal: affiliation.ReferralsTotal,
                ReferralsQualified: affiliation.ReferralsQualified,
                BenefitsEarned: affiliation.BenefitsEarned),
            Alerts: alerts,
            ServerTimeUtc: utcNow);

        return Result.Success(dto);
    }

    private static MeFarmDto MapFarm(
        FarmMembershipSnapshot m,
        AccountsSnapshot accounts,
        UserId caller)
    {
        var plan = ResolvePlan(m.Subscription);
        var validUntil = m.Subscription?.ValidUntilUtc;
        var callerIsPrimaryOwner = accounts.OwnerAccounts
            .Any(a => a.OwnerAccountId == m.OwnerAccountId && a.CallerIsPrimaryOwner);

        return new MeFarmDto(
            FarmId: m.FarmId.Value,
            Name: m.FarmName,
            FarmCode: m.FarmCode,
            OwnerAccountId: m.OwnerAccountId.Value,
            Role: m.Role,
            Status: m.Status,
            JoinedVia: m.JoinedVia,
            Plan: plan,
            PlanValidUntilUtc: validUntil,
            Capabilities: ResolveCapabilities(m.Role, callerIsPrimaryOwner));
    }

    private static string ResolvePlan(SubscriptionSnapshot? sub)
    {
        if (sub is null) return "Free";
        return sub.Status switch
        {
            "Trialing" => "Trial",
            "Active" when sub.PlanCode.Equals("ShramSafalPro", StringComparison.OrdinalIgnoreCase) => "Pro",
            "Active" => "Free",
            "PastDue" => "PastDue",
            "Expired" or "Canceled" or "Suspended" => "Expired",
            _ => "Free",
        };
    }

    private static MeCapabilitiesDto ResolveCapabilities(string role, bool callerIsPrimaryOwner)
    {
        var canInvite = role is "PrimaryOwner" or "SecondaryOwner";
        var canAddCost = role is "PrimaryOwner" or "SecondaryOwner";
        var canVerify = role is "PrimaryOwner" or "SecondaryOwner" or "Mukadam";
        var canSeeBilling = role == "PrimaryOwner" && callerIsPrimaryOwner;

        return new MeCapabilitiesDto(
            CanInvite: canInvite,
            CanVerify: canVerify,
            CanAddCost: canAddCost,
            CanSeeBilling: canSeeBilling);
    }

    private static IReadOnlyList<MeAlertDto> BuildAlerts(
        DateTime? phoneVerifiedAtUtc,
        IReadOnlyList<MeFarmDto> farms,
        DateTime utcNow)
    {
        var alerts = new List<MeAlertDto>();

        if (phoneVerifiedAtUtc is null)
        {
            alerts.Add(new MeAlertDto("verify_phone", "info", null, null));
        }

        if (farms.Count == 0)
        {
            alerts.Add(new MeAlertDto("no_farms_yet", "info", null, null));
            return alerts;
        }

        foreach (var farm in farms)
        {
            switch (farm.Plan)
            {
                case "PastDue":
                    alerts.Add(new MeAlertDto("plan_expiring", "warn", farm.FarmId,
                        DaysLeft: DaysBetween(utcNow, farm.PlanValidUntilUtc)));
                    break;
                case "Expired":
                    alerts.Add(new MeAlertDto("plan_expired", "error", farm.FarmId, null));
                    break;
                case "Pro" or "Trial":
                    if (farm.PlanValidUntilUtc is { } until &&
                        until > utcNow &&
                        (until - utcNow).TotalDays <= PlanExpiringWindowDays)
                    {
                        alerts.Add(new MeAlertDto("plan_expiring", "warn", farm.FarmId,
                            DaysLeft: DaysBetween(utcNow, until)));
                    }
                    break;
            }
        }

        return alerts;
    }

    private static int? DaysBetween(DateTime utcNow, DateTime? target)
    {
        if (target is null) return null;
        var diff = (target.Value - utcNow).TotalDays;
        return diff < 0 ? 0 : (int)Math.Ceiling(diff);
    }

    private static string MaskPhone(string phone)
    {
        if (phone.Length < 4) return "****";
        return new string('*', phone.Length - 4) + phone[^4..];
    }
}

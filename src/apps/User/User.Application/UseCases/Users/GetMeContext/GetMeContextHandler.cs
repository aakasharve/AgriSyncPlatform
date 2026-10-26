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

    /// <summary>The membership status (as <c>FarmMembershipSnapshot.Status</c> spells it) that
    /// means access. Every other status is a relationship only.</summary>
    private const string ActiveSeatStatus = "Active";

    private static readonly MeCapabilitiesDto NoCapabilities = new(
        CanInvite: false,
        CanVerify: false,
        CanAddCost: false,
        CanSeeBilling: false);

    /// <param name="includePending">spec: plr-d7-m1-multiuser-2026-10-26 (step 1, P11) — list the
    /// seats that are NOT Active (a typed-code request waiting for the owner, a paused seat) too.
    /// Only the route's <c>?includePending=true</c> sets it, and only this release's phone sends
    /// it. Without it <c>farms</c> holds Active seats only — what an installed older app (the
    /// 1.0.16 APK) understood before step 1: a person whose only seat is a waiting request sees
    /// the no-farm screen (<c>no_farms_yet</c>) as before, never a farm he cannot open.</param>
    public async Task<Result<MeContextDto>> HandleAsync(
        UserId userId,
        bool includePending = false,
        CancellationToken ct = default)
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
            .Where(m => includePending || string.Equals(m.Status, ActiveSeatStatus, StringComparison.Ordinal))
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
        // spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — a seat that is not Active (a typed-code
        // join request still waiting for the owner, a paused seat) is a relationship, not access.
        // It is listed (only when asked with includePending) so the person can see THAT it waits —
        // name and status only, the same rule as GET /shramsafal/farms/mine (GetMyFarmsHandler):
        // no farm code, no owner account, no plan or plan date (so no plan alert), no
        // capabilities. The person has not been let in, so the owner's billing is not his to see.
        // Plan carries the contract's "nothing known" value, never the farm's real plan.
        if (!string.Equals(m.Status, ActiveSeatStatus, StringComparison.Ordinal))
        {
            return new MeFarmDto(
                FarmId: m.FarmId.Value,
                Name: m.FarmName,
                FarmCode: null,
                OwnerAccountId: Guid.Empty,
                Role: m.Role,
                Status: m.Status,
                JoinedVia: m.JoinedVia,
                Plan: ResolvePlan(sub: null),
                PlanValidUntilUtc: null,
                Capabilities: NoCapabilities);
        }

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

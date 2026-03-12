using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Domain.Logs;

public static class VerificationStateMachine
{
    private static readonly HashSet<AppRole> OwnerRoles =
    [
        AppRole.PrimaryOwner,
        AppRole.SecondaryOwner
    ];

    private static readonly HashSet<AppRole> AllRoles =
    [
        AppRole.PrimaryOwner,
        AppRole.SecondaryOwner,
        AppRole.Mukadam,
        AppRole.Worker
    ];

    private static readonly IReadOnlyDictionary<VerificationStatus, IReadOnlyList<TransitionRule>> Transitions =
        new Dictionary<VerificationStatus, IReadOnlyList<TransitionRule>>
        {
            [VerificationStatus.Draft] =
            [
                new TransitionRule(VerificationStatus.Confirmed, AllRoles)
            ],
            [VerificationStatus.Confirmed] =
            [
                new TransitionRule(VerificationStatus.Verified, OwnerRoles),
                new TransitionRule(VerificationStatus.Disputed, OwnerRoles)
            ],
            [VerificationStatus.Verified] =
            [
                new TransitionRule(VerificationStatus.Disputed, OwnerRoles)
            ],
            [VerificationStatus.Disputed] =
            [
                new TransitionRule(VerificationStatus.CorrectionPending, AllRoles)
            ],
            [VerificationStatus.CorrectionPending] =
            [
                new TransitionRule(VerificationStatus.Draft, AllRoles)
            ]
        };

    public static bool CanTransition(VerificationStatus from, VerificationStatus to)
    {
        if (!Transitions.TryGetValue(from, out var rules))
        {
            return false;
        }

        return rules.Any(r => r.To == to);
    }

    public static bool CanTransitionWithRole(VerificationStatus from, VerificationStatus to, AppRole role)
    {
        if (!Transitions.TryGetValue(from, out var rules))
        {
            return false;
        }

        return rules.Any(r => r.To == to && r.AllowedRoles.Contains(role));
    }

    public static VerificationStatus GetNextStatusForEdit(VerificationStatus current)
    {
        return current switch
        {
            VerificationStatus.Confirmed => VerificationStatus.Draft,
            VerificationStatus.Verified => VerificationStatus.Draft,
            _ => current
        };
    }

    public static VerificationStatus[] GetAvailableTransitions(VerificationStatus from, AppRole role)
    {
        if (!Transitions.TryGetValue(from, out var rules))
        {
            return [];
        }

        return rules
            .Where(r => r.AllowedRoles.Contains(role))
            .Select(r => r.To)
            .ToArray();
    }

    private sealed record TransitionRule(VerificationStatus To, IReadOnlySet<AppRole> AllowedRoles);
}

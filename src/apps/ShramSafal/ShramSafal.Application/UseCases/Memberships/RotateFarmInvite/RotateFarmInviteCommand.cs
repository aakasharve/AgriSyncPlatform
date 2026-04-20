using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.UseCases.Memberships.IssueFarmInvite;

namespace ShramSafal.Application.UseCases.Memberships.RotateFarmInvite;

public sealed record RotateFarmInviteCommand(FarmId FarmId, UserId CallerUserId);

/// <summary>
/// Rotate returns the same shape as Issue so the owner UI is the same
/// "here is your QR" screen in both cases.
/// </summary>
public sealed record RotateFarmInviteResult(IssueFarmInviteResult Issued);

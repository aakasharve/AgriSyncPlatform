using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1, review S1) — founder D-31 / D-26:
/// WHO MAY HEAR A RECORD'S WORDS. One rule, two surfaces:
/// <list type="bullet">
/// <item>the original voice of a record (<c>GetLogOriginalVoiceHandler</c>), and</item>
/// <item>his words inside what Sathi understood (the content document the pull sends,
/// <c>LogContentDocument.WordKeys</c>).</item>
/// </list>
///
/// <para><b>The rule.</b> A member of the record's farm may hear the words when he IS the speaker
/// (the log's <c>OperatorUserId</c>), or he is the farm's primary owner, or he holds the owner's
/// grant (<see cref="LabourManagementGate.HasExplicitGrantAsync"/>, the confirm authority). Anyone
/// else on the farm gets the record's values without the words. A caller with no membership
/// (<paramref name="callerRole"/> null) hears nothing.</para>
///
/// <para><b>Why the grant is a callback.</b> The voice route reads it for one record; the pull
/// reads it once per farm for many records. The rule stays here and nowhere else; only the cost
/// of answering its last clause differs, and it is asked only when the speaker and the role have
/// not already answered.</para>
/// </summary>
public static class RecordWordsGate
{
    public static async Task<bool> MayHearAsync(
        Guid callerUserId,
        Guid speakerUserId,
        AppRole? callerRole,
        Func<Task<bool>> callerHoldsGrant)
    {
        ArgumentNullException.ThrowIfNull(callerHoldsGrant);

        if (callerRole is not { } role || callerUserId == Guid.Empty)
        {
            return false;
        }

        if (callerUserId == speakerUserId || role == AppRole.PrimaryOwner)
        {
            return true;
        }

        return await callerHoldsGrant();
    }
}

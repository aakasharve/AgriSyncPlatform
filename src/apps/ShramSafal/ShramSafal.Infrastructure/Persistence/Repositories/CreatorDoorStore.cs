using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Creators;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

// spec: plr-d10 schedule slice 15 (the creator door), server half. Every query here is filtered by FORCE row security to the scope it runs under.
internal sealed class CreatorDoorStore(ShramSafalDbContext context) : ICreatorDoorStore
{
    public async Task<CreatorProfile?> GetProfileAsync(Guid creatorId, CancellationToken ct = default) =>
        await context.CreatorProfiles.FirstOrDefaultAsync(p => p.Id == creatorId, ct);

    public async Task<CreatorProfile?> GetProfileByPhoneAsync(string phone, CancellationToken ct = default) =>
        await context.CreatorProfiles.FirstOrDefaultAsync(p => p.Phone == phone, ct);

    public async Task<IReadOnlyList<CreatorProfile>> ListProfilesAsync(CancellationToken ct = default) =>
        await context.CreatorProfiles.AsNoTracking().OrderBy(p => p.InvitedAtUtc).ThenBy(p => p.Id).ToListAsync(ct);

    public void Add(CreatorProfile profile) => context.CreatorProfiles.Add(profile);

    public async Task<int> CountCodesIssuedSinceAsync(string phone, DateTime sinceUtc, CancellationToken ct = default) =>
        await context.CreatorSignInCodes.CountAsync(c => c.Phone == phone && c.IssuedAtUtc >= sinceUtc, ct);

    public async Task<CreatorSignInCode?> GetPendingCodeAsync(string phone, CancellationToken ct = default) =>
        await context.CreatorSignInCodes.FirstOrDefaultAsync(c => c.Phone == phone && c.Status == CreatorSignInCodeStatus.Pending, ct);

    public void Add(CreatorSignInCode code) => context.CreatorSignInCodes.Add(code);

    public async Task<CreatorSession?> GetSessionByTokenHashAsync(string tokenHash, CancellationToken ct = default) =>
        await context.CreatorSessions.FirstOrDefaultAsync(s => s.TokenHash == tokenHash, ct);

    public async Task<IReadOnlyList<CreatorSession>> ListLiveSessionsAsync(Guid creatorId, DateTime nowUtc, CancellationToken ct = default) =>
        await context.CreatorSessions.Where(s => s.CreatorId == creatorId && s.RevokedAtUtc == null && s.ExpiresAtUtc > nowUtc).ToListAsync(ct);

    public void Add(CreatorSession session) => context.CreatorSessions.Add(session);

    public async Task<CreatorSubmission?> GetSubmissionAsync(Guid submissionId, CancellationToken ct = default) =>
        await context.CreatorSubmissions.FirstOrDefaultAsync(s => s.Id == submissionId, ct);

    public async Task<IReadOnlyList<CreatorSubmission>> ListSubmissionsAsync(CancellationToken ct = default) =>
        await context.CreatorSubmissions.AsNoTracking().OrderByDescending(s => s.ModifiedAtUtc).ThenBy(s => s.Id).ToListAsync(ct);

    public async Task<IReadOnlyList<CreatorSubmission>> ListRoundsOfWorkAsync(Guid workId, CancellationToken ct = default) =>
        await context.CreatorSubmissions.AsNoTracking().Where(s => s.WorkId == workId).OrderBy(s => s.Round).ToListAsync(ct);

    public void Add(CreatorSubmission submission) => context.CreatorSubmissions.Add(submission);

    public void Remove(CreatorSubmission submission) => context.CreatorSubmissions.Remove(submission);

    public async Task<IReadOnlyList<CreatorSubmissionDecision>> ListDecisionsAsync(IReadOnlyCollection<Guid> submissionIds, CancellationToken ct = default)
    {
        if (submissionIds.Count == 0)
        {
            return [];
        }

        var ids = submissionIds.ToList();
        return await context.CreatorSubmissionDecisions.AsNoTracking().Where(d => ids.Contains(d.SubmissionId)).OrderBy(d => d.DecidedAtUtc).ToListAsync(ct);
    }

    public void Add(CreatorSubmissionDecision decision) => context.CreatorSubmissionDecisions.Add(decision);

    public async Task<CreatorFile?> GetFileAsync(Guid fileId, CancellationToken ct = default) =>
        await context.CreatorFiles.FirstOrDefaultAsync(f => f.Id == fileId, ct);

    public async Task<IReadOnlyList<CreatorFile>> ListFilesOfWorkAsync(Guid workId, CancellationToken ct = default) =>
        await context.CreatorFiles.Where(f => f.WorkId == workId).OrderBy(f => f.CreatedAtUtc).ThenBy(f => f.Id).ToListAsync(ct);

    public void Add(CreatorFile file) => context.CreatorFiles.Add(file);

    public void Remove(CreatorFile file) => context.CreatorFiles.Remove(file);

    public async Task<IReadOnlyList<CreatorTermsAcceptance>> ListTermsAsync(Guid creatorId, CancellationToken ct = default) =>
        await context.CreatorTermsAcceptances.AsNoTracking().Where(t => t.CreatorId == creatorId).ToListAsync(ct);

    public void Add(CreatorTermsAcceptance acceptance) => context.CreatorTermsAcceptances.Add(acceptance);

    public Task SaveChangesAsync(CancellationToken ct = default) => context.SaveChangesAsync(ct);
}

// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-S; founder D-146)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Pictures;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Tests.Common;

namespace ShramSafal.Domain.Tests.Pictures;

/// <summary>Doubles and builders shared by the picture tests: a repository that knows farms and schedules, an in-memory store and storage.</summary>
internal static class PictureTestKit
{
    public static readonly DateTime Now = new(2026, 11, 17, 6, 0, 0, DateTimeKind.Utc);

    // The bytes of a real (tiny) file of each type: only the first bytes matter to the server.
    public static byte[] Jpeg(int size = 64, byte fill = 1) => Pad([0xFF, 0xD8, 0xFF, 0xE0], size, fill);
    public static byte[] Png(int size = 64, byte fill = 2) => Pad([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], size, fill);

    public static byte[] Webp(int size = 64, byte fill = 3) =>
        Pad([(byte)'R', (byte)'I', (byte)'F', (byte)'F', 0, 0, 0, 0, (byte)'W', (byte)'E', (byte)'B', (byte)'P'], size, fill);

    public static byte[] Pad(byte[] head, int size, byte fill)
    {
        var bytes = new byte[Math.Max(size, head.Length)];
        Array.Copy(head, bytes, head.Length);
        for (var i = head.Length; i < bytes.Length; i++)
        {
            bytes[i] = fill;
        }

        return bytes;
    }

    public static Farm FarmOwnedBy(Guid farmId, Guid owner) =>
        Farm.Create(new FarmId(farmId), "Farm", new UserId(owner), Now);

    /// <summary>A person's own schedule (Team, owner = <paramref name="owner"/>), typed by <paramref name="typist"/>.</summary>
    public static ScheduleTemplate OwnSchedule(Guid id, Guid owner, Guid? typist = null) =>
        ScheduleTemplate.CreateOwn(id, "My schedule", "grapes", new UserId(owner), new UserId(typist ?? owner), Now);

    public static ScheduleTemplate PublicSchedule(Guid id) =>
        ScheduleTemplate.Create(id, "University schedule", "Pruning", Now, new UserId(Guid.NewGuid()), TenantScope.Public);

    public static FarmReadScope Seat(Guid farmId, bool ownRecordsOnly) =>
        new(farmId, ownRecordsOnly, SeeMoney: false, SeeWages: false, SeeAttendance: false, SeeTests: !ownRecordsOnly,
            SeeCompliance: !ownRecordsOnly, SeeFarmOverview: !ownRecordsOnly, IsPrimaryAccountHolder: false, AccessChangedAtUtc: null);

    public static Picture PictureOf(PictureKind kind, Guid subject, Guid setBy, byte fill = 9)
    {
        var bytes = Jpeg(64, fill);
        return Picture.Create(Guid.NewGuid(), kind, subject, PictureRules.Jpeg, bytes.Length, PictureRules.Sha256Hex(bytes), new UserId(setBy), Now);
    }
}

internal sealed class PictureRepo : FakeShramSafalRepository, IShramSafalRepository
{
    public Dictionary<(Guid Farm, Guid User), FarmAccess> Access { get; } = [];

    /// <summary>The caller's standing on a farm (what <c>FarmReadScope.Of</c> turns into his read scope).</summary>
    public void Seat(Guid farmId, Guid userId, AppRole role)
    {
        Access[(farmId, userId)] = new FarmAccess(role, MembershipStatus.Active, IsRegistrant: false, StoredPermissions: null);
        var farms = _farmsOf.TryGetValue(userId, out var have) ? have : [];
        farms.Add(farmId);
        _farmsOf[userId] = farms;
    }

    Task<FarmAccess?> IShramSafalRepository.GetFarmAccessForUserAsync(Guid farmId, Guid userId, CancellationToken ct) =>
        Task.FromResult(Access.GetValueOrDefault((farmId, userId)));

    public Dictionary<Guid, Farm> Farms { get; } = [];
    public Dictionary<Guid, ScheduleTemplate> Templates { get; } = [];
    public List<AuditEvent> Audits { get; } = [];
    public int Saves { get; private set; }

    public override Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) =>
        Task.FromResult(Farms.GetValueOrDefault(farmId));

    public override Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) =>
        Task.FromResult(Templates.GetValueOrDefault(templateId));

    private readonly Dictionary<Guid, List<Guid>> _farmsOf = [];

    /// <summary>The farms <paramref name="userId"/> works on (what the team rule of the schedule viewer reads).</summary>
    public void OverrideFarmsOf(Guid userId, params Guid[] farmIds) => _farmsOf[userId] = farmIds.ToList();

    public override Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) =>
        Task.FromResult(_farmsOf.TryGetValue(userId, out var farms) ? farms.ToList() : []);

    public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
    {
        Audits.Add(auditEvent);
        return Task.CompletedTask;
    }

    public override Task SaveChangesAsync(CancellationToken ct = default)
    {
        Saves++;
        return Task.CompletedTask;
    }
}

internal class MemoryPictureStore : IPictureStore
{
    public List<Picture> Rows { get; } = [];

    /// <summary>How many times the first-picture save ran (<see cref="IPictureStore.TrySaveNewAsync"/>): the first picture of a subject saves through the store.</summary>
    public int Saves { get; private set; }

    public virtual Task<bool> TrySaveNewAsync(CancellationToken ct = default)
    {
        Saves++;
        return Task.FromResult(true);
    }

    public Task<Picture?> GetAsync(PictureKind kind, Guid subjectId, CancellationToken ct = default) =>
        Task.FromResult(Rows.FirstOrDefault(p => p.Kind == kind && p.SubjectId == subjectId));

    public Task<Picture?> GetByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult(Rows.FirstOrDefault(p => p.Id == id));

    public Task<IReadOnlyList<Picture>> GetManyAsync(PictureKind kind, IReadOnlyCollection<Guid> subjectIds, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<Picture>>(Rows.Where(p => p.Kind == kind && subjectIds.Contains(p.SubjectId)).ToList());

    public void Stage(Picture picture) => Rows.Add(picture);

    public void Remove(Picture picture) => Rows.Remove(picture);
}

internal sealed class MemoryStorage : IAttachmentStorageService
{
    public Dictionary<string, byte[]> Files { get; } = [];
    public List<string> Deleted { get; } = [];
    public HashSet<string> FailDeleteOf { get; } = [];

    public Task<long> SaveAsync(string relativePath, Stream content, string? contentType = null, CancellationToken ct = default)
    {
        using var copy = new MemoryStream();
        content.CopyTo(copy);
        Files[relativePath] = copy.ToArray();
        return Task.FromResult((long)copy.Length);
    }

    public Task<Stream?> OpenReadAsync(string relativePath, CancellationToken ct = default) =>
        Task.FromResult<Stream?>(Files.TryGetValue(relativePath, out var bytes) ? new MemoryStream(bytes) : null);

    public Task DeleteAsync(string relativePath, CancellationToken ct = default)
    {
        if (FailDeleteOf.Contains(relativePath))
        {
            throw new IOException("storage refused the delete");
        }

        Deleted.Add(relativePath);
        Files.Remove(relativePath);
        return Task.CompletedTask;
    }
}

internal sealed class FixedClock(DateTime utcNow) : IClock
{
    public DateTime UtcNow { get; } = utcNow;
}

/// <summary>Answers "may review schedules" for exactly the staff it was given; every other member is unused here.</summary>
internal sealed class StaffEntitlements(params Guid[] staff) : IEntitlementResolver
{
    public Task<ResolveResult> ResolveAsync(UserId userId, Guid? activeOrgId, CancellationToken ct) =>
        throw new NotSupportedException("The picture rules only ask MayCheckSchedulesAsync.");

    public Task<bool> MayCheckSchedulesAsync(UserId userId, CancellationToken ct) => Task.FromResult(staff.Contains(userId.Value));
}

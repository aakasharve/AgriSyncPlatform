using ShramSafal.Domain.Organizations;

namespace ShramSafal.Domain.ControlRoom;

/// <summary>One per-person tick and the module keys it opens. <see cref="IsPersonalData"/> ticks show orange on the People page.</summary>
public sealed record ControlRoomTick(
    string Key,
    IReadOnlyList<string> ReadModules,
    IReadOnlyList<string> WriteModules,
    bool IsPersonalData);

public static class ControlRoomTicks
{
    public const string CompanyNumbers = "company_numbers";
    public const string ServerHealth = "server_health";
    public const string ApiErrors = "api_errors";
    public const string AllFarms = "all_farms";
    public const string FarmsToCall = "farms_to_call";
    public const string FarmerHealth = "farmer_health";
    public const string Schedules = "schedules";
    public const string Users = "users";
    public const string FarmerPhones = "farmer_phones";
    public const string Downloads = "downloads";
    public const string GiveVisits = "give_visits";
    public const string MyVisits = "my_visits";

    private static readonly string[] None = [];

    public static IReadOnlyList<ControlRoomTick> All { get; } =
    [
        new(CompanyNumbers, [ModuleKey.MetricsNsm], None, false),
        new(ServerHealth, [ModuleKey.OpsLive], None, false),
        new(ApiErrors, [ModuleKey.OpsErrors], None, false),
        new(AllFarms, [ModuleKey.FarmsList], None, false),
        new(FarmsToCall, [ModuleKey.FarmsSilentChurn, ModuleKey.FarmsSuffering], None, false),
        new(FarmerHealth, [ModuleKey.FarmerHealth], None, false),
        new(Schedules, [ModuleKey.ScheduleReview], [ModuleKey.ScheduleReview], false),
        new(Users, [ModuleKey.AdminUsers], None, false),
        new(FarmerPhones, [ModuleKey.FarmsPhones], None, true),
        new(Downloads, [ModuleKey.ExportsDaySheet], None, true),
        new(GiveVisits, [ModuleKey.VisitsAssign], [ModuleKey.VisitsAssign], false),
        new(MyVisits, [ModuleKey.VisitsMine], [ModuleKey.VisitsMine], false)
    ];

    public static bool IsKnown(string key) => All.Any(t => t.Key == key);

    /// <summary>
    /// What the ticks open: one entry per <see cref="ModuleKey.All"/>, in that order. <c>admin.self</c> is always readable;
    /// unknown ticks open nothing; nothing here ever grants export, the audit ledger or an organisation write.
    /// </summary>
    public static IReadOnlyList<ModuleEntitlement> ModulesFor(IEnumerable<string> ticks)
    {
        var held = new HashSet<string>(ticks ?? []);
        var read = new HashSet<string> { ModuleKey.AdminSelf };
        var write = new HashSet<string>();
        foreach (var tick in All)
        {
            if (!held.Contains(tick.Key)) continue;
            read.UnionWith(tick.ReadModules);
            write.UnionWith(tick.WriteModules);
        }

        var result = new List<ModuleEntitlement>(ModuleKey.All.Count);
        foreach (var key in ModuleKey.All)
            result.Add(new ModuleEntitlement(key, read.Contains(key), false, write.Contains(key)));
        return result;
    }
}

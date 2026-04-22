namespace ShramSafal.Domain.Organizations;

public static class ModuleKey
{
    public const string AdminSelf = "admin.self";
    public const string AdminOrgsRead = "admin.orgs.read";
    public const string AdminOrgsWrite = "admin.orgs.write";
    public const string AdminUsers = "admin.users";

    public const string OpsLive = "ops.live";
    public const string OpsErrors = "ops.errors";
    public const string OpsVoice = "ops.voice";
    public const string OpsAlerts = "ops.alerts";

    public const string MetricsNsm = "metrics.nsm";
    public const string MetricsRetention = "metrics.retention";
    public const string MetricsFunnel = "metrics.funnel";
    public const string MetricsEngagement = "metrics.engagement";

    public const string FarmsList = "farms.list";
    public const string FarmsDetail = "farms.detail";
    public const string FarmsSilentChurn = "farms.silent-churn";
    public const string FarmsSuffering = "farms.suffering";

    public const string CeiW1Deviation = "cei.w1.deviation";
    public const string CeiW1DeviationReasons = "cei.w1.deviation.reasons";
    public const string CeiW1Lineage = "cei.w1.lineage";
    public const string CeiW1Authorship = "cei.w1.authorship";
    public const string CeiW1Attention = "cei.w1.attention";
    public const string CeiW1Overrides = "cei.w1.overrides";

    public const string CeiW2Tests = "cei.w2.tests";
    public const string CeiW2Recommendations = "cei.w2.recommendations";
    public const string CeiW2Roles = "cei.w2.roles";
    public const string CeiW2Lab = "cei.w2.lab";

    public const string CeiW3Compliance = "cei.w3.compliance";
    public const string CeiW3ServiceProof = "cei.w3.service-proof";

    public const string CeiW4Jobs = "cei.w4.jobs";
    public const string CeiW4Workers = "cei.w4.workers";
    public const string CeiW4Labour = "cei.w4.labour";

    public const string OrgSettings = "org.settings";
    public const string OrgMembers = "org.members";
    public const string OrgFarmScope = "org.farm-scope";

    public static readonly IReadOnlySet<string> All = typeof(ModuleKey)
        .GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)
        .Where(f => f.IsLiteral && f.FieldType == typeof(string))
        .Select(f => (string)f.GetRawConstantValue()!)
        .ToHashSet();
}

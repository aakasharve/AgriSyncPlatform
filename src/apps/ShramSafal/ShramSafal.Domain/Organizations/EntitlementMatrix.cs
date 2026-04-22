namespace ShramSafal.Domain.Organizations;

public static class EntitlementMatrix
{
    public static IReadOnlyList<ModuleEntitlement> For(
        OrganizationType type,
        OrganizationRole role)
    {
        var result = new List<ModuleEntitlement>(ModuleKey.All.Count);
        foreach (var key in ModuleKey.All)
        {
            var (r, e, w) = Lookup(type, role, key);
            result.Add(new ModuleEntitlement(key, r, e, w));
        }
        return result;
    }

    private static (bool R, bool E, bool W) Lookup(
        OrganizationType type, OrganizationRole role, string moduleKey)
    {
        if (type == OrganizationType.Platform && role == OrganizationRole.Owner)
            return (true, true, IsWriteModule(moduleKey));

        if (type == OrganizationType.Platform && role == OrganizationRole.Analyst)
            return (true, IsExportableByAnalyst(moduleKey), false);

        if (moduleKey == ModuleKey.AdminSelf)
            return (true, false, false);

        return type switch
        {
            OrganizationType.FPO => FpoLookup(role, moduleKey),
            OrganizationType.FPC => FpcLookup(role, moduleKey),
            OrganizationType.ConsultingFirm => ConsultingLookup(role, moduleKey),
            OrganizationType.Lab => LabLookup(role, moduleKey),
            _ => (false, false, false)
        };
    }

    private static bool IsWriteModule(string key) =>
        key == ModuleKey.AdminOrgsWrite
        || key == ModuleKey.OrgSettings
        || key == ModuleKey.OrgMembers
        || key == ModuleKey.OrgFarmScope;

    private static bool IsExportableByAnalyst(string key) =>
        key.StartsWith("cei.")
        || key.StartsWith("metrics.")
        || key.StartsWith("farms.")
        || key == ModuleKey.OpsErrors;

    private static (bool R, bool E, bool W) FpoLookup(OrganizationRole role, string key) =>
        (role, key) switch
        {
            (OrganizationRole.Owner, ModuleKey.AdminOrgsRead) => (true, false, false),
            (OrganizationRole.Owner, ModuleKey.AdminOrgsWrite) => (false, false, true),
            (OrganizationRole.Owner, ModuleKey.OrgSettings) => (true, false, true),
            (OrganizationRole.Owner, ModuleKey.OrgMembers) => (true, false, true),
            (OrganizationRole.Owner, ModuleKey.OrgFarmScope) => (true, false, true),
            (OrganizationRole.Owner, _) when IsScopedFpoReadModule(key) => (true, IsFpoExport(key), false),
            (OrganizationRole.Analyst, _) when IsScopedFpoReadModule(key) => (true, false, false),
            (OrganizationRole.Employee, ModuleKey.FarmsList) => (true, false, false),
            (OrganizationRole.Employee, ModuleKey.CeiW1Attention) => (true, false, false),
            (OrganizationRole.Employee, ModuleKey.CeiW2Tests) => (true, false, false),
            (OrganizationRole.Auditor, _) when IsScopedFpoReadModule(key) => (true, false, false),
            (OrganizationRole.Viewer, ModuleKey.FarmsList) => (true, false, false),
            _ => (false, false, false)
        };

    private static bool IsScopedFpoReadModule(string key) =>
        key == ModuleKey.MetricsNsm
        || key == ModuleKey.FarmsList
        || key == ModuleKey.FarmsDetail
        || key == ModuleKey.FarmsSilentChurn
        || key == ModuleKey.FarmsSuffering
        || key == ModuleKey.CeiW1Deviation
        || key == ModuleKey.CeiW1DeviationReasons
        || key == ModuleKey.CeiW1Attention
        || key == ModuleKey.CeiW1Overrides
        || key == ModuleKey.CeiW2Tests
        || key == ModuleKey.CeiW2Recommendations
        || key == ModuleKey.CeiW3Compliance
        || key == ModuleKey.CeiW4Jobs
        || key == ModuleKey.CeiW4Workers
        || key == ModuleKey.CeiW4Labour;

    private static bool IsFpoExport(string key) =>
        key == ModuleKey.MetricsNsm
        || key == ModuleKey.CeiW1Attention
        || key == ModuleKey.CeiW1Deviation
        || key == ModuleKey.CeiW3Compliance
        || key == ModuleKey.CeiW4Jobs
        || key == ModuleKey.CeiW4Labour;

    private static (bool R, bool E, bool W) FpcLookup(OrganizationRole role, string key) =>
        (role, key) switch
        {
            (OrganizationRole.Owner, ModuleKey.AdminOrgsRead) => (true, false, false),
            (OrganizationRole.Owner, ModuleKey.AdminOrgsWrite) => (false, false, true),
            (OrganizationRole.Owner, ModuleKey.OrgSettings) => (true, false, true),
            (OrganizationRole.Owner, ModuleKey.OrgMembers) => (true, false, true),
            (OrganizationRole.Owner, ModuleKey.OrgFarmScope) => (true, false, true),
            (OrganizationRole.Owner, ModuleKey.CeiW2Lab) => (true, true, false),
            (OrganizationRole.Owner, _) when IsScopedFpoReadModule(key) => (true, IsFpoExport(key), false),
            (OrganizationRole.Employee, ModuleKey.FarmsList) => (true, false, false),
            (OrganizationRole.Employee, ModuleKey.CeiW1Attention) => (true, false, false),
            (OrganizationRole.Employee, ModuleKey.CeiW2Tests) => (true, false, false),
            (OrganizationRole.Employee, ModuleKey.CeiW4Jobs) => (true, false, false),
            _ => (false, false, false)
        };

    private static (bool R, bool E, bool W) ConsultingLookup(OrganizationRole role, string key) =>
        (role, key) switch
        {
            (OrganizationRole.Owner, ModuleKey.AdminOrgsRead) => (true, false, false),
            (OrganizationRole.Owner, ModuleKey.AdminOrgsWrite) => (false, false, true),
            (OrganizationRole.Owner, ModuleKey.OrgSettings) => (true, false, true),
            (OrganizationRole.Owner, ModuleKey.OrgMembers) => (true, false, true),
            (OrganizationRole.Owner, ModuleKey.OrgFarmScope) => (true, false, false),
            (OrganizationRole.Owner, ModuleKey.CeiW1Lineage) => (true, false, false),
            (OrganizationRole.Owner, ModuleKey.CeiW1Attention) => (true, false, false),
            (OrganizationRole.Owner, ModuleKey.CeiW1Deviation) => (true, true, false),
            (OrganizationRole.Owner, ModuleKey.CeiW3ServiceProof) => (true, true, false),
            (OrganizationRole.Owner, ModuleKey.CeiW3Compliance) => (true, false, false),
            (OrganizationRole.Owner, ModuleKey.FarmsList) => (true, false, false),
            (OrganizationRole.Owner, ModuleKey.FarmsDetail) => (true, false, false),
            (OrganizationRole.Employee, ModuleKey.CeiW1Lineage) => (true, false, false),
            (OrganizationRole.Employee, ModuleKey.CeiW1Deviation) => (true, false, false),
            (OrganizationRole.Employee, ModuleKey.CeiW3ServiceProof) => (true, false, false),
            _ => (false, false, false)
        };

    private static (bool R, bool E, bool W) LabLookup(OrganizationRole role, string key) =>
        (role, key) switch
        {
            (OrganizationRole.Owner, ModuleKey.AdminOrgsRead) => (true, false, false),
            (OrganizationRole.Owner, ModuleKey.AdminOrgsWrite) => (false, false, true),
            (OrganizationRole.Owner, ModuleKey.OrgSettings) => (true, false, true),
            (OrganizationRole.Owner, ModuleKey.OrgMembers) => (true, false, true),
            (OrganizationRole.Owner, ModuleKey.OrgFarmScope) => (true, false, false),
            (OrganizationRole.Owner, ModuleKey.CeiW2Lab) => (true, true, false),
            (OrganizationRole.Owner, ModuleKey.CeiW2Tests) => (true, false, false),
            (OrganizationRole.Owner, ModuleKey.FarmsList) => (true, false, false),
            (OrganizationRole.Employee, ModuleKey.CeiW2Tests) => (true, false, false),
            (OrganizationRole.Employee, ModuleKey.CeiW2Lab) => (true, false, false),
            _ => (false, false, false)
        };
}

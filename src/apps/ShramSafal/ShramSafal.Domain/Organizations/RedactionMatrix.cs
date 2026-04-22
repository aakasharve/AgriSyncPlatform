namespace ShramSafal.Domain.Organizations;

public static class RedactionMatrix
{
    public static FieldRedactionPolicy For(
        OrganizationType orgType,
        OrganizationRole orgRole,
        string moduleKey)
    {
        if (orgType == OrganizationType.Platform && orgRole == OrganizationRole.Owner)
            return FieldRedactionPolicy.Empty;

        var dict = new Dictionary<string, FieldAccess>(StringComparer.Ordinal);

        if (orgType == OrganizationType.Platform && orgRole == OrganizationRole.Analyst)
        {
            dict["ownerPhone"] = FieldAccess.Masked;
            dict["workerPhone"] = FieldAccess.Masked;
            return new(dict);
        }

        if (orgType == OrganizationType.FPO && orgRole == OrganizationRole.Employee)
        {
            dict["ownerPhone"] = FieldAccess.Masked;
            dict["workerName"] = FieldAccess.Masked;
            dict["workerPhone"] = FieldAccess.Masked;
            dict["payoutAmount"] = FieldAccess.Aggregated;
            dict["farmGpsCoordinates"] = FieldAccess.Hidden;
            dict["deviationNote"] = FieldAccess.Masked;
            return new(dict);
        }

        if (orgType == OrganizationType.ConsultingFirm)
        {
            dict["ownerPhone"] = FieldAccess.Hidden;
            dict["workerName"] = FieldAccess.Hidden;
            dict["workerPhone"] = FieldAccess.Hidden;
            dict["payoutAmount"] = FieldAccess.Hidden;
            dict["farmGpsCoordinates"] = FieldAccess.Hidden;
            dict["deviationNote"] = FieldAccess.Masked;
            return new(dict);
        }

        if (orgType == OrganizationType.Lab && orgRole == OrganizationRole.Employee)
        {
            dict["ownerPhone"] = FieldAccess.Hidden;
            dict["workerPhone"] = FieldAccess.Masked;
            dict["payoutAmount"] = FieldAccess.Hidden;
            dict["farmGpsCoordinates"] = FieldAccess.Hidden;
            dict["deviationNote"] = FieldAccess.Hidden;
            return new(dict);
        }

        dict["ownerPhone"] = FieldAccess.Masked;
        dict["workerPhone"] = FieldAccess.Masked;
        dict["farmGpsCoordinates"] = FieldAccess.Hidden;
        return new(dict);
    }
}

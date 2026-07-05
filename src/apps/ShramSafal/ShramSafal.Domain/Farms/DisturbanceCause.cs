namespace ShramSafal.Domain.Farms;

// §3.2g typed cause — mirrors frontend BucketIssueType (log.types.ts):
// WATER_SOURCE→WaterSource, LABOR_SHORTAGE→LabourShortage, MATERIAL_SHORTAGE→MaterialShortage.
public enum DisturbanceCause { Machinery, Electricity, Weather, WaterSource, Pest, Disease, LabourShortage, MaterialShortage, Other }

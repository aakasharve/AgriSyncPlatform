using ShramSafal.Domain.Finance;

namespace ShramSafal.Infrastructure.Persistence.Seed;

/// <summary>
/// DATA_PRINCIPLE_SPINE sub-phase 02.5 — canonical 13-code cost-category
/// seed. The list is the single source of truth surfaced by the
/// Conflict-Resolver R0 verdict (decisions-log 2026-05-15). Order matches
/// the verdict table and is preserved on serialization for deterministic
/// reference-data hashes.
/// </summary>
public static class CostCategorySeed
{
    public static readonly IReadOnlyList<CostCategory> All =
    [
        CostCategory.Create("labour_payout",  "मजुरी (कामगार पेमेंट)",   "मज़दूरी (कामगार पेमेंट)",  "Labour payout"),
        CostCategory.Create("labour_misc",    "इतर मजुरी",                "अन्य मज़दूरी",              "Labour (misc)"),
        CostCategory.Create("seeds",          "बियाणे",                   "बीज",                       "Seeds"),
        CostCategory.Create("fertilizer",     "खत",                       "उर्वरक",                    "Fertilizer"),
        CostCategory.Create("pesticide",      "कीटकनाशक",                 "कीटनाशक",                   "Pesticide"),
        CostCategory.Create("irrigation",     "सिंचन",                    "सिंचाई",                    "Irrigation"),
        CostCategory.Create("machinery_rent", "मशीन भाडे",                "मशीनरी किराया",             "Machinery rent"),
        CostCategory.Create("equipment",      "उपकरण व दुरुस्ती",         "उपकरण व मरम्मत",            "Equipment & repair"),
        CostCategory.Create("fuel",           "इंधन (डिझेल/पेट्रोल)",     "ईंधन (डीज़ल/पेट्रोल)",      "Fuel (diesel/petrol)"),
        CostCategory.Create("transport",      "वाहतूक",                   "परिवहन",                    "Transport"),
        CostCategory.Create("electricity",    "वीज",                      "बिजली",                     "Electricity"),
        CostCategory.Create("packaging",      "पॅकिंग",                   "पैकेजिंग",                  "Packaging"),
        CostCategory.Create("other",          "इतर",                      "अन्य",                      "Other"),
    ];
}

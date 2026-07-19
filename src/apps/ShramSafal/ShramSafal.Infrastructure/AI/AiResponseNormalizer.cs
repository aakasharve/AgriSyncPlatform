using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ShramSafal.Infrastructure.AI;

internal sealed class AiResponseNormalizer
{
    private static readonly HashSet<string> AllowedDayOutcomes =
    [
        "WORK_RECORDED",
        "DISTURBANCE_RECORDED",
        "NO_WORK_PLANNED",
        "IRRELEVANT_INPUT"
    ];

    private static readonly HashSet<string> AllowedReceiptScopes =
    [
        "PLOT",
        "CROP",
        "FARM",
        "UNKNOWN"
    ];

    // dfes-companion-2026-07-11 — provenance guardrail.
    //
    // LIVE BUG this exists to catch: the model concatenated a real phrase
    // from the transcript with an INVENTED phrase inside a single
    // `sourceText` field, then extracted a whole fabricated operation
    // (pruning) from its own invention. `sourceText` is the provenance
    // field — Prompts/core/systemBase.md says "Keep sourceText as the
    // exact phrase that caused extraction" — but nothing verified that
    // promise. This is a MECHANICAL (non-AI) check: every array below that
    // carries a `sourceText` per outputContract.md gets a boolean
    // `provenanceVerified` stamped on each item. We never delete anything —
    // a strict text match has false negatives (paraphrase, transcription
    // noise), so deleting would silently destroy real farmer work.
    private static readonly string[] ProvenanceCheckedArrayNames =
    [
        "cropActivities",
        "irrigation",
        "labour",
        "inputs",
        "machinery",
        "activityExpenses",
        "observations",
        "plannedTasks"
    ];

    // "A small character threshold" per spec — segments shorter than this
    // (after normalization) are noise (a stray "OK"/"हो") and are ignored
    // rather than being allowed to flag a whole item on their own.
    private const int ProvenanceMinSegmentLength = 4;

    public string NormalizeVoiceJson(
        string rawJson,
        string schemaVersion = "1.0.0",
        string pipelineVersion = "gemini-server-v1",
        string promptVersion = "2026-02-22")
    {
        var root = ParseJsonObject(rawJson);
        PromoteLegacyDailyLogShape(root);

        EnsureString(root, "summary", "Log processed.");
        EnsureString(root, "fullTranscript", string.Empty);
        EnsureArray(root, "cropActivities");
        EnsureArray(root, "irrigation");
        EnsureArray(root, "labour");
        EnsureArray(root, "inputs");
        EnsureArray(root, "machinery");
        EnsureArray(root, "activityExpenses");
        EnsureArray(root, "observations");
        EnsureArray(root, "plannedTasks");
        EnsureArray(root, "missingSegments");
        EnsureArray(root, "unclearSegments");
        EnsureArray(root, "questionsForUser");

        if (root["fieldConfidences"] is not JsonObject)
        {
            root["fieldConfidences"] = new JsonObject();
        }

        var confidence = NormalizeConfidence(root["confidence"]);
        root["confidence"] = confidence;

        var dayOutcome = NormalizeDayOutcome(root["dayOutcome"]?.GetValue<string>());
        if (!HasAnyWork(root) && root["disturbance"] is JsonObject)
        {
            dayOutcome = "DISTURBANCE_RECORDED";
        }

        root["dayOutcome"] = dayOutcome;

        ApplyProvenanceVerification(root);

        root["_meta"] = new JsonObject
        {
            ["schemaVersion"] = schemaVersion,
            ["pipelineVersion"] = pipelineVersion,
            ["promptVersion"] = promptVersion
        };

        return root.ToJsonString();
    }

    public string NormalizeGenericJson(string rawJson)
    {
        var root = ParseJsonObject(rawJson);

        if (LooksLikeReceipt(root))
        {
            NormalizeReceipt(root);
        }
        else if (LooksLikePatti(root))
        {
            NormalizePatti(root);
        }

        return root.ToJsonString();
    }

    private static bool LooksLikeReceipt(JsonObject root)
    {
        return root.ContainsKey("lineItems")
               || root.ContainsKey("vendorName")
               || root.ContainsKey("grandTotal")
               || root.ContainsKey("suggestedScope");
    }

    private static bool LooksLikePatti(JsonObject root)
    {
        return root.ContainsKey("pattiNumber")
               || root.ContainsKey("deductions")
               || root.ContainsKey("netAmount");
    }

    private static void NormalizeReceipt(JsonObject root)
    {
        var sourceItems = root["lineItems"] as JsonArray ?? root["items"] as JsonArray ?? [];
        var normalizedItems = new JsonArray();

        decimal subtotal = 0m;
        foreach (var sourceItem in sourceItems)
        {
            var item = sourceItem as JsonObject ?? new JsonObject();
            var quantity = ReadDecimal(item["quantity"]);
            var unitPrice = ReadDecimal(item["unitPrice"]);
            var totalAmount = ReadDecimal(item["totalAmount"]);

            if (!totalAmount.HasValue && quantity.HasValue && unitPrice.HasValue)
            {
                totalAmount = decimal.Round(quantity.Value * unitPrice.Value, 2, MidpointRounding.AwayFromZero);
            }

            var safeTotal = decimal.Round(totalAmount ?? 0m, 2, MidpointRounding.AwayFromZero);
            subtotal += safeTotal;

            normalizedItems.Add(new JsonObject
            {
                ["name"] = ReadString(item["name"], "Unknown item"),
                ["quantity"] = quantity,
                ["unit"] = ReadString(item["unit"], string.Empty),
                ["unitPrice"] = unitPrice,
                ["totalAmount"] = safeTotal,
                ["suggestedCategory"] = NormalizeCategory(ReadString(item["suggestedCategory"], "MISC")),
                ["confidence"] = NormalizeConfidencePercent(item["confidence"])
            });
        }

        var discount = ReadDecimal(root["discount"]) ?? 0m;
        var tax = ReadDecimal(root["tax"]) ?? 0m;
        var grandTotal = ReadDecimal(root["grandTotal"])
                         ?? decimal.Round(subtotal - discount + tax, 2, MidpointRounding.AwayFromZero);
        var rawTextExtracted = ReadNullableString(root["rawTextExtracted"]);

        EnsureArray(root, "warnings");
        ApplyReceiptAmountCorrections(root, normalizedItems, rawTextExtracted, discount, tax, ref subtotal, ref grandTotal);

        var suggestedScope = ReadString(root["suggestedScope"], "UNKNOWN").ToUpperInvariant();
        if (!AllowedReceiptScopes.Contains(suggestedScope))
        {
            suggestedScope = "UNKNOWN";
        }

        root["success"] = root["success"]?.GetValue<bool?>() ?? true;
        root["confidence"] = NormalizeConfidencePercent(root["confidence"]);
        root["vendorName"] = ReadNullableString(root["vendorName"]);
        root["vendorPhone"] = ReadNullableString(root["vendorPhone"]);
        root["date"] = ReadString(root["date"], DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        root["lineItems"] = normalizedItems;
        root["subtotal"] = decimal.Round(subtotal, 2, MidpointRounding.AwayFromZero);
        root["discount"] = decimal.Round(discount, 2, MidpointRounding.AwayFromZero);
        root["tax"] = decimal.Round(tax, 2, MidpointRounding.AwayFromZero);
        root["grandTotal"] = decimal.Round(grandTotal, 2, MidpointRounding.AwayFromZero);
        root["suggestedScope"] = suggestedScope;
        root["suggestedCropName"] = ReadNullableString(root["suggestedCropName"]);
        root["rawTextExtracted"] = rawTextExtracted;
    }

    private static void NormalizePatti(JsonObject root)
    {
        var sourceItems = root["items"] as JsonArray ?? [];
        var normalizedItems = new JsonArray();
        decimal grossTotal = 0m;

        foreach (var sourceItem in sourceItems)
        {
            var item = sourceItem as JsonObject ?? new JsonObject();
            var quantity = ReadDecimal(item["quantity"]);
            var rate = ReadDecimal(item["rate"]);
            var amount = ReadDecimal(item["amount"]);
            if (!amount.HasValue && quantity.HasValue && rate.HasValue)
            {
                amount = decimal.Round(quantity.Value * rate.Value, 2, MidpointRounding.AwayFromZero);
            }

            var safeAmount = decimal.Round(amount ?? 0m, 2, MidpointRounding.AwayFromZero);
            grossTotal += safeAmount;

            normalizedItems.Add(new JsonObject
            {
                ["gradeRaw"] = ReadString(item["gradeRaw"], "Unknown"),
                ["quantity"] = quantity,
                ["unit"] = ReadString(item["unit"], "Kg"),
                ["rate"] = rate,
                ["amount"] = safeAmount
            });
        }

        var deductions = root["deductions"] as JsonObject ?? new JsonObject();
        var commission = ReadDecimal(deductions["commission"]) ?? 0m;
        var transport = ReadDecimal(deductions["transport"]) ?? 0m;
        var other = ReadDecimal(deductions["other"]) ?? 0m;
        var totalDeductions = commission + transport + other;

        var netAmount = ReadDecimal(root["netAmount"])
                        ?? decimal.Round(grossTotal - totalDeductions, 2, MidpointRounding.AwayFromZero);

        root["date"] = ReadNullableString(root["date"]);
        root["pattiNumber"] = ReadNullableString(root["pattiNumber"]);
        root["buyerName"] = ReadNullableString(root["buyerName"]);
        root["items"] = normalizedItems;
        root["deductions"] = new JsonObject
        {
            ["commission"] = decimal.Round(commission, 2, MidpointRounding.AwayFromZero),
            ["transport"] = decimal.Round(transport, 2, MidpointRounding.AwayFromZero),
            ["other"] = decimal.Round(other, 2, MidpointRounding.AwayFromZero)
        };
        root["grossTotal"] = decimal.Round(ReadDecimal(root["grossTotal"]) ?? grossTotal, 2, MidpointRounding.AwayFromZero);
        root["netAmount"] = decimal.Round(netAmount, 2, MidpointRounding.AwayFromZero);
    }

    private static void PromoteLegacyDailyLogShape(JsonObject root)
    {
        if (root["dailyLog"] is not JsonObject dailyLog)
        {
            return;
        }

        if (root["cropActivities"] is null && dailyLog["cropActivities"] is JsonNode cropActivities)
        {
            root["cropActivities"] = EnsureArrayNode(cropActivities);
        }

        if (root["irrigation"] is null && dailyLog["irrigation"] is JsonNode irrigation)
        {
            root["irrigation"] = EnsureArrayNode(irrigation);
        }

        if (root["labour"] is null && dailyLog["labour"] is JsonNode labour)
        {
            root["labour"] = EnsureArrayNode(labour);
        }

        if (root["inputs"] is null && dailyLog["inputs"] is JsonNode inputs)
        {
            if (inputs is JsonObject inputObject && inputObject["items"] is JsonNode items)
            {
                root["inputs"] = EnsureArrayNode(items);
            }
            else
            {
                root["inputs"] = EnsureArrayNode(inputs);
            }
        }

        if (root["machinery"] is null && dailyLog["machinery"] is JsonNode machinery)
        {
            root["machinery"] = EnsureArrayNode(machinery);
        }
    }

    private static JsonNode EnsureArrayNode(JsonNode node)
    {
        return node switch
        {
            JsonArray array => array,
            null => new JsonArray(),
            _ => new JsonArray(node)
        };
    }

    private static bool HasAnyWork(JsonObject root)
    {
        return HasAnyArrayItems(root, "cropActivities")
               || HasAnyArrayItems(root, "irrigation")
               || HasAnyArrayItems(root, "labour")
               || HasAnyArrayItems(root, "inputs")
               || HasAnyArrayItems(root, "machinery")
               || HasAnyArrayItems(root, "activityExpenses");
    }

    private static bool HasAnyArrayItems(JsonObject root, string propertyName)
    {
        return root[propertyName] is JsonArray array && array.Count > 0;
    }

    /// <summary>
    /// Mechanically verifies that every extracted item's <c>sourceText</c> is
    /// genuinely present in the parse's <c>fullTranscript</c>, and stamps a
    /// boolean <c>provenanceVerified</c> flag on the item. Never deletes or
    /// otherwise mutates the item — only adds the flag — so a false negative
    /// (paraphrase, transcription variance) never destroys real farmer work;
    /// it only surfaces a signal for downstream/UI to act on.
    /// </summary>
    private static void ApplyProvenanceVerification(JsonObject root)
    {
        var transcript = ReadNullableString(root["fullTranscript"]);
        var hasTranscript = !string.IsNullOrWhiteSpace(transcript);

        // No transcript ⇒ nothing is verifiable. This is exactly the
        // failure mode (STT provider down, model goes audio→structure
        // directly) under which the live fabrication happened — trust
        // nothing rather than trusting the model's unverifiable claims.
        var normalizedTranscript = hasTranscript
            ? NormalizeProvenanceText(transcript!)
            : string.Empty;

        foreach (var arrayName in ProvenanceCheckedArrayNames)
        {
            if (root[arrayName] is not JsonArray array)
            {
                continue;
            }

            foreach (var node in array)
            {
                if (node is not JsonObject item)
                {
                    continue;
                }

                item["provenanceVerified"] = hasTranscript &&
                    IsSourceTextVerified(item["sourceText"], normalizedTranscript);
            }
        }
    }

    private static bool IsSourceTextVerified(JsonNode? sourceTextNode, string normalizedTranscript)
    {
        var sourceText = ReadNullableString(sourceTextNode);
        if (string.IsNullOrWhiteSpace(sourceText))
        {
            // No sourceText ⇒ no provenance claim was made on this item —
            // there is nothing to falsify, so it is not flagged. (Chosen
            // behaviour, documented: absence of sourceText is not treated
            // the same as a failed verification — that would flood the UI
            // with false "unverified" flags on items that never claimed a
            // verbatim quote, or on legacy parses that predate this field.)
            return true;
        }

        var meaningfulSegments = SplitProvenanceSegments(sourceText)
            .Select(NormalizeProvenanceText)
            .Where(segment => segment.Length >= ProvenanceMinSegmentLength)
            .ToList();

        if (meaningfulSegments.Count == 0)
        {
            // Every segment was noise/too short to meaningfully check
            // (e.g. a single short word) — nothing checkable, don't flag.
            return true;
        }

        // Segment-wise AND: every non-trivial segment must independently
        // appear in the transcript. This is what catches a real phrase
        // concatenated with an invented one — the invented segment fails
        // even though the real segment (if verbatim) would pass.
        return meaningfulSegments.All(segment =>
            normalizedTranscript.Contains(segment, StringComparison.Ordinal));
    }

    private static IEnumerable<string> SplitProvenanceSegments(string sourceText)
    {
        return System.Text.RegularExpressions.Regex
            .Split(sourceText, @"[।.!?\n]+")
            .Where(segment => !string.IsNullOrWhiteSpace(segment));
    }

    /// <summary>
    /// Tolerant normalization ONLY: trim, collapse internal whitespace,
    /// strip punctuation (including danda ।/॥), case-fold Latin text.
    /// Deliberately does NOT transliterate or fuzzy/semantically match
    /// Devanagari against Latin transcription variants (e.g. "thrill" vs
    /// "इथरेल") — that would re-introduce the guessing this check exists
    /// to remove. Comparison happens purely on these normalized forms.
    /// </summary>
    private static string NormalizeProvenanceText(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        // Keep letters, digits (any script), and whitespace only — this
        // strips ASCII punctuation and Devanagari danda/double-danda
        // (।/॥, Unicode category Po) alike without special-casing them.
        var lettersAndDigitsOnly = System.Text.RegularExpressions.Regex.Replace(
            value,
            @"[^\p{L}\p{Nd}\s]",
            " ");

        var collapsedWhitespace = System.Text.RegularExpressions.Regex.Replace(
            lettersAndDigitsOnly,
            @"\s+",
            " ").Trim();

        return collapsedWhitespace.ToLowerInvariant();
    }

    private static string NormalizeDayOutcome(string? dayOutcome)
    {
        if (string.IsNullOrWhiteSpace(dayOutcome))
        {
            return "WORK_RECORDED";
        }

        var normalized = dayOutcome.Trim().ToUpperInvariant();
        return AllowedDayOutcomes.Contains(normalized)
            ? normalized
            : "WORK_RECORDED";
    }

    private static decimal NormalizeConfidence(JsonNode? value)
    {
        var numeric = ReadDecimal(value) ?? 0.75m;
        if (numeric > 1m)
        {
            numeric /= 100m;
        }

        return Math.Clamp(decimal.Round(numeric, 4, MidpointRounding.AwayFromZero), 0m, 1m);
    }

    private static decimal NormalizeConfidencePercent(JsonNode? value)
    {
        var numeric = ReadDecimal(value) ?? 85m;
        if (numeric <= 1m)
        {
            numeric *= 100m;
        }

        return Math.Clamp(decimal.Round(numeric, 2, MidpointRounding.AwayFromZero), 0m, 100m);
    }

    private static void ApplyReceiptAmountCorrections(
        JsonObject root,
        JsonArray normalizedItems,
        string? rawTextExtracted,
        decimal discount,
        decimal tax,
        ref decimal subtotal,
        ref decimal grandTotal)
    {
        var suspiciousSignals = 0;

        foreach (var itemNode in normalizedItems.OfType<JsonObject>())
        {
            var itemTotal = ReadDecimal(itemNode["totalAmount"]);
            if (!IsLikelyTrailingDigitSmear(itemTotal))
            {
                continue;
            }

            itemNode["totalAmount"] = CorrectTrailingDigitSmear(itemTotal!.Value);
            suspiciousSignals++;

            var unitPrice = ReadDecimal(itemNode["unitPrice"]);
            if (IsLikelyTrailingDigitSmear(unitPrice))
            {
                itemNode["unitPrice"] = CorrectTrailingDigitSmear(unitPrice!.Value);
            }
        }

        var correctedSubtotal = normalizedItems.OfType<JsonObject>()
            .Select(item => ReadDecimal(item["totalAmount"]) ?? 0m)
            .Sum();

        var suspiciousGrandTotal = IsLikelyTrailingDigitSmear(grandTotal);
        var correctedGrandTotal = suspiciousGrandTotal
            ? CorrectTrailingDigitSmear(grandTotal)
            : grandTotal;

        if (suspiciousGrandTotal)
        {
            suspiciousSignals++;
        }

        if (suspiciousSignals == 0 || correctedSubtotal <= 0m)
        {
            return;
        }

        var previousBalanceHint = TryReadPreviousBalance(rawTextExtracted);
        var deltaAfterCorrection = correctedGrandTotal - correctedSubtotal;

        var shouldApply =
            previousBalanceHint.HasValue && Math.Abs(deltaAfterCorrection - previousBalanceHint.Value) <= 2m ||
            suspiciousGrandTotal && deltaAfterCorrection >= 0m && deltaAfterCorrection <= 5000m ||
            suspiciousGrandTotal && correctedSubtotal < subtotal / 5m;

        if (!shouldApply)
        {
            return;
        }

        subtotal = decimal.Round(correctedSubtotal, 2, MidpointRounding.AwayFromZero);
        grandTotal = suspiciousGrandTotal
            ? decimal.Round(correctedGrandTotal, 2, MidpointRounding.AwayFromZero)
            : decimal.Round(subtotal - discount + tax, 2, MidpointRounding.AwayFromZero);

        if (root["warnings"] is JsonArray warnings)
        {
            warnings.Add("Applied arithmetic correction to probable OCR digit-smear in handwritten amounts.");
        }
    }

    private static bool IsLikelyTrailingDigitSmear(decimal? amount)
    {
        return amount.HasValue &&
               amount.Value >= 100000m &&
               decimal.Truncate(amount.Value) == amount.Value &&
               amount.Value % 10m == 1m;
    }

    private static decimal CorrectTrailingDigitSmear(decimal amount)
    {
        return decimal.Floor(amount / 10m);
    }

    private static decimal? TryReadPreviousBalance(string? rawTextExtracted)
    {
        if (string.IsNullOrWhiteSpace(rawTextExtracted))
        {
            return null;
        }

        var patterns = new[]
        {
            @"(?:मागील|बाकी|उधार|previous\s*balance|balance)[^\d]{0,8}(?<amount>\d[\d,]*)",
            @"(?<amount>\d[\d,]*)[^\S\r\n]*(?:मागील|बाकी|previous\s*balance|balance)"
        };

        foreach (var pattern in patterns)
        {
            var match = System.Text.RegularExpressions.Regex.Match(
                rawTextExtracted,
                pattern,
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);

            if (!match.Success)
            {
                continue;
            }

            var amountText = match.Groups["amount"].Value.Replace(",", string.Empty, StringComparison.Ordinal);
            if (decimal.TryParse(amountText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var amount))
            {
                return amount;
            }
        }

        return null;
    }

    private static string NormalizeCategory(string category)
    {
        if (string.IsNullOrWhiteSpace(category))
        {
            return "MISC";
        }

        var normalized = category.Trim().ToUpperInvariant();
        return normalized switch
        {
            "FERTILIZER" or
            "PESTICIDE" or
            "FUNGICIDE" or
            "SEEDS_PLANTS" or
            "IRRIGATION" or
            "LABOUR" or
            "MACHINERY_RENTAL" or
            "FUEL" or
            "TRANSPORT" or
            "PACKAGING" or
            "ELECTRICITY" or
            "EQUIPMENT_REPAIR" or
            "MISC" => normalized,
            _ => "MISC"
        };
    }

    private static JsonObject ParseJsonObject(string rawJson)
    {
        if (string.IsNullOrWhiteSpace(rawJson))
        {
            return new JsonObject();
        }

        try
        {
            var parsed = JsonNode.Parse(rawJson)?.AsObject() ?? new JsonObject();

            // JsonNode.Parse defers building each JsonObject's backing dictionary
            // until first access (indexer/enumeration) — it does NOT eagerly
            // validate for duplicate property names at parse time. That means a
            // duplicate key nested somewhere the normalizer never happens to
            // touch would otherwise serialize/escape untouched, while a
            // duplicate key the normalizer DOES touch would throw ArgumentException
            // far away from this method (or even outside it, in caller code) — too
            // late for us to safely intervene. So force full materialization of the
            // whole tree right here, inside this try block, so any duplicate-key
            // ArgumentException — at any depth — surfaces here and is handled below.
            EnsureFullyMaterialized(parsed);
            return parsed;
        }
        catch (JsonException)
        {
            return new JsonObject();
        }
        catch (ArgumentException)
        {
            // LLMs (e.g. the Sarvam sarvam-30b model, observed live: repeated
            // "plannedTasks" key) routinely emit JSON objects with duplicate
            // property names. JsonNode/JsonObject throws ArgumentException in
            // that case ("An item with the same key has already been added"),
            // not JsonException, so it isn't caught above and would otherwise
            // escape as a hard provider failure. Re-parse tolerantly via
            // JsonDocument (which permits duplicate keys) and rebuild an
            // equivalent JsonObject, applying last-one-wins for duplicated
            // keys, recursively — a duplicate can be nested inside a child
            // object or inside an object within an array — instead of
            // silently discarding the farmer's parsed log as an empty object.
            try
            {
                using var document = JsonDocument.Parse(rawJson);
                return BuildJsonObjectFromElement(document.RootElement);
            }
            catch (Exception)
            {
                return new JsonObject();
            }
        }
    }

    private static void EnsureFullyMaterialized(JsonNode? node)
    {
        switch (node)
        {
            case JsonObject jsonObject:
                // Enumerating a JsonObject forces it to build its backing
                // dictionary, which is where a duplicate-key ArgumentException
                // actually gets thrown.
                foreach (var property in jsonObject)
                {
                    EnsureFullyMaterialized(property.Value);
                }

                break;
            case JsonArray jsonArray:
                foreach (var item in jsonArray)
                {
                    EnsureFullyMaterialized(item);
                }

                break;
        }
    }

    private static JsonObject BuildJsonObjectFromElement(JsonElement element)
    {
        var result = new JsonObject();
        foreach (var property in element.EnumerateObject())
        {
            // JsonObject's indexer overwrites any existing value for the same
            // key, so iterating properties in document order and assigning
            // via the indexer naturally implements last-one-wins.
            result[property.Name] = ConvertElementToNode(property.Value);
        }

        return result;
    }

    private static JsonArray BuildJsonArrayFromElement(JsonElement element)
    {
        var result = new JsonArray();
        foreach (var item in element.EnumerateArray())
        {
            result.Add(ConvertElementToNode(item));
        }

        return result;
    }

    private static JsonNode? ConvertElementToNode(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.Object => BuildJsonObjectFromElement(element),
            JsonValueKind.Array => BuildJsonArrayFromElement(element),
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            _ => JsonValue.Create(element.Clone())
        };
    }

    private static void EnsureString(JsonObject root, string propertyName, string fallbackValue)
    {
        if (ReadNullableString(root[propertyName]) is { Length: > 0 })
        {
            return;
        }

        root[propertyName] = fallbackValue;
    }

    private static void EnsureArray(JsonObject root, string propertyName)
    {
        if (root[propertyName] is JsonArray)
        {
            return;
        }

        root[propertyName] = new JsonArray();
    }

    private static string ReadString(JsonNode? value, string fallback)
    {
        return ReadNullableString(value) ?? fallback;
    }

    private static string? ReadNullableString(JsonNode? value)
    {
        if (value is null)
        {
            return null;
        }

        return value.GetValueKind() switch
        {
            JsonValueKind.String => value.GetValue<string?>(),
            JsonValueKind.Number => value.GetValue<decimal>().ToString(CultureInfo.InvariantCulture),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => null
        };
    }

    private static decimal? ReadDecimal(JsonNode? value)
    {
        if (value is null)
        {
            return null;
        }

        if (value.GetValueKind() == JsonValueKind.Number)
        {
            return value.GetValue<decimal>();
        }

        if (value.GetValueKind() != JsonValueKind.String)
        {
            return null;
        }

        var raw = value.GetValue<string>()?.Trim();
        return decimal.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }
}

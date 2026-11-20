// spec: facts-card-input-truth-2026-11-19 (lane FACTS, slice B)
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ShramSafal.Domain.Inputs;

/// <summary>
/// The ingredient facts file this assembly embeds (<c>Inputs/Generated/ingredient-facts.json</c>, copied byte for byte from
/// <c>sync-contract/reference/inputs/ingredient-facts.json</c> by <c>generate.mjs</c>). The server reads from it only the three things
/// a stored use needs: which facts key a library ingredient name is, that ingredient's IRAC / FRAC group, and the file's version (so a
/// derived row says which facts it was derived with, doctrine P8). The sourced "what it does" lines are NOT copied into any row: they
/// stay in the repo (D-97) and reach a farmer only after an agronomist's tick (D-96) on the phone card.
/// </summary>
public static class IngredientFactsReference
{
    private sealed record FactsFile(string Version, IReadOnlyList<FactsIngredient> Ingredients);

    private sealed record FactsIngredient(string Key, IReadOnlyList<string> Names, string? Group);

    private static readonly Lazy<(string Version, IReadOnlyDictionary<string, (string Key, string? Group)> ByName)> Loaded = new(Load);

    /// <summary>The facts file's version, written on every derived use.</summary>
    public static string Version => Loaded.Value.Version;

    /// <summary>Library names are compared on letters and digits only ("Beta-Cyfluthrin" is "beta cyfluthrin"), as the phone does.</summary>
    public static string Norm(string? name) => Regex.Replace((name ?? string.Empty).ToLowerInvariant(), "[^a-z0-9]", string.Empty);

    /// <summary>The facts key and group of a library ingredient name, or <c>null</c> when the file holds none (then no group is written, P4).</summary>
    public static (string Key, string? Group)? Find(string? englishName) =>
        Loaded.Value.ByName.TryGetValue(Norm(englishName), out var hit) ? hit : null;

    /// <summary>The group of a facts key (<c>nitrogen</c>, <c>potassium</c>), or <c>null</c>.</summary>
    public static string? GroupOfKey(string key) =>
        Loaded.Value.ByName.TryGetValue(Norm(key), out var hit) ? hit.Group : null;

    private static (string, IReadOnlyDictionary<string, (string, string?)>) Load()
    {
        var file = JsonSerializer.Deserialize<FactsFile>(InputReferenceResource.ReadBytes("ingredient-facts.json"), InputReferenceResource.JsonOptions)
            ?? throw new InvalidOperationException("Embedded resource 'ingredient-facts.json' is empty.");
        var byName = new Dictionary<string, (string, string?)>(StringComparer.Ordinal);
        foreach (var ingredient in file.Ingredients)
        {
            foreach (var name in (ingredient.Names ?? []).Append(ingredient.Key))
            {
                byName[Norm(name)] = (ingredient.Key, ingredient.Group);
            }
        }

        return (file.Version, byName);
    }
}

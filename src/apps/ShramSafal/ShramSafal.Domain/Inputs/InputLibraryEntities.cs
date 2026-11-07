// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Task 1)
namespace ShramSafal.Domain.Inputs;

/// <summary>The two states of a library row. A <c>draft</c> row is never served to a farm.</summary>
public static class InputLibraryStatus
{
    public const string Draft = "draft";
    public const string Published = "published";
}

/// <summary>How an intake conflict was settled. <c>open</c> blocks publishing.</summary>
public static class InputLibraryConflictStatus
{
    public const string Open = "open";

    /// <summary>The two sources really differ: BOTH values are kept and shown (D-108 3).</summary>
    public const string RealDifference = "real_difference";

    /// <summary>One source is wrong: the incoming value is dropped.</summary>
    public const string Error = "error";
}

/// <summary>The fields an intake compares, plus <see cref="Match"/> (the matching key found more than one library product).</summary>
public static class InputLibraryConflictField
{
    /// <summary>The key (same active ingredients, same % and same form) matched more than one product and nothing told
    /// them apart. The incoming product is held as a new draft; <c>real_difference</c> keeps it as its own product,
    /// <c>error</c> drops it.</summary>
    public const string Match = "match";

    public const string Category = "category";
    public const string Modes = "modes";
    public const string Methods = "methods";
    public const string Stages = "stages";
    public const string Targets = "targets";
    public const string NpkGrade = "npkGrade";
    public const string Tags = "tags";

    /// <summary>The Marathi form only: the form code is part of the matching key.</summary>
    public const string Formulation = "formulation";

    /// <summary>The ingredients' Marathi names and strengths only: the name and % are part of the matching key.</summary>
    public const string ActiveIngredients = "activeIngredients";

    public const string Benefits = "benefits";
    public const string Company = "company";
    public const string CompanyMr = "companyMr";
    public const string IngredientUnknown = "ingredientUnknown";

    /// <summary>The fields a second source can differ on, in the order they are compared. Brands and aliases are not in it:
    /// they are only more names for the same product, so the intake reports them as notes.</summary>
    public static readonly IReadOnlyList<string> Compared =
    [
        Category, Modes, Methods, Stages, Targets, NpkGrade, Tags, Formulation, ActiveIngredients, Benefits, Company, CompanyMr, IngredientUnknown,
    ];
}

/// <summary>One source the library lists (<c>ssf.input_library_sources</c>). Reference data: no farm column.</summary>
public sealed class InputLibrarySource
{
    private static readonly string[] Kinds = ["guide", "company-list", "university", "label"];

    private InputLibrarySource()
    {
        Id = string.Empty;
        Title = string.Empty;
        Kind = string.Empty;
        Status = InputLibraryStatus.Draft;
    } // EF Core

    public string Id { get; private set; }
    public string Title { get; private set; }
    public string Kind { get; private set; }
    public DateOnly ReceivedOn { get; private set; }
    public string? CheckedBy { get; private set; }
    public string Status { get; private set; }

    /// <summary>1-based place among the sources, in the order they joined. A farm sees "स्रोत {Position}", never the title.</summary>
    public int Position { get; private set; }

    public static InputLibrarySource Create(string id, string title, string kind, DateOnly receivedOn, string? checkedBy, string status, int position)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            throw new ArgumentException("A source needs an id.", nameof(id));
        }

        if (string.IsNullOrWhiteSpace(title))
        {
            throw new ArgumentException("A source needs a title.", nameof(title));
        }

        if (!Kinds.Contains(kind, StringComparer.Ordinal))
        {
            throw new ArgumentException($"A source kind is one of {string.Join(", ", Kinds)}.", nameof(kind));
        }

        if (status is not (InputLibraryStatus.Draft or InputLibraryStatus.Published))
        {
            throw new ArgumentException("A source is draft or published.", nameof(status));
        }

        if (position < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(position), "A source position starts at 1.");
        }

        return new InputLibrarySource
        {
            Id = id.Trim(),
            Title = title.Trim(),
            Kind = kind,
            ReceivedOn = receivedOn,
            CheckedBy = string.IsNullOrWhiteSpace(checkedBy) ? null : checkedBy.Trim(),
            Status = status,
            Position = position,
        };
    }

    internal void MarkPublished() => Status = InputLibraryStatus.Published;
}

/// <summary>One product of the library (<c>ssf.input_library_products</c>). Its facts are one JSON object in the library
/// product shape (ingredients, formulation, brands, modes, methods, stages, targets, NPK grade, tags, aliases, benefits and
/// the optional ingredient-unknown / company marks). The id and category are columns; the source refs are rows.</summary>
public sealed class InputLibraryProduct
{
    private InputLibraryProduct()
    {
        Id = string.Empty;
        Category = string.Empty;
        Facts = "{}";
        MatchKey = string.Empty;
        Status = InputLibraryStatus.Draft;
    } // EF Core

    public string Id { get; private set; }
    public string Category { get; private set; }

    /// <summary>The product's facts as a JSON object (jsonb).</summary>
    public string Facts { get; private set; }

    /// <summary>Same active ingredients, same % for each and same form: the same key means the same product.</summary>
    public string MatchKey { get; private set; }

    public string Status { get; private set; }

    /// <summary>Catalogue order. The library is served in this order, so candidate lists keep their order.</summary>
    public int Ordinal { get; private set; }

    public static InputLibraryProduct Create(string id, string category, string facts, string matchKey, string status, int ordinal)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            throw new ArgumentException("A product needs an id.", nameof(id));
        }

        if (string.IsNullOrWhiteSpace(category))
        {
            throw new ArgumentException("A product needs a category.", nameof(category));
        }

        if (status is not (InputLibraryStatus.Draft or InputLibraryStatus.Published))
        {
            throw new ArgumentException("A product is draft or published.", nameof(status));
        }

        return new InputLibraryProduct
        {
            Id = id.Trim(),
            Category = category.Trim(),
            Facts = facts,
            MatchKey = matchKey,
            Status = status,
            Ordinal = ordinal,
        };
    }

    internal void MarkPublished() => Status = InputLibraryStatus.Published;
}

/// <summary>Where a product came from (<c>ssf.input_library_source_refs</c>): a listed source and the place in it.
/// <see cref="Entry"/> is the source's own entry id, kept for traceability only.</summary>
public sealed class InputLibrarySourceRef
{
    private InputLibrarySourceRef()
    {
        ProductId = string.Empty;
        SourceId = string.Empty;
        Ref = string.Empty;
    } // EF Core

    public string ProductId { get; private set; }
    public string SourceId { get; private set; }
    public string Ref { get; private set; }
    public string? Entry { get; private set; }

    public static InputLibrarySourceRef Create(string productId, string sourceId, string @ref, string? entry)
    {
        if (string.IsNullOrWhiteSpace(productId) || string.IsNullOrWhiteSpace(sourceId) || string.IsNullOrWhiteSpace(@ref))
        {
            throw new ArgumentException("A source ref names a product, a source and the place in it.");
        }

        return new InputLibrarySourceRef
        {
            ProductId = productId.Trim(),
            SourceId = sourceId.Trim(),
            Ref = @ref.Trim(),
            Entry = string.IsNullOrWhiteSpace(entry) ? null : entry.Trim(),
        };
    }
}

/// <summary>A field where an incoming source differs from the library (<c>ssf.input_library_conflicts</c>). The existing and
/// incoming values are JSON. Publishing is refused while any conflict is <c>open</c>.</summary>
public sealed class InputLibraryConflict
{
    private InputLibraryConflict()
    {
        ProductId = string.Empty;
        Field = string.Empty;
        ExistingValue = "null";
        IncomingSourceId = string.Empty;
        IncomingValue = "null";
        Status = InputLibraryConflictStatus.Open;
    } // EF Core

    public Guid Id { get; private set; }

    /// <summary>The library product the incoming source disagrees with.</summary>
    public string ProductId { get; private set; }

    public string Field { get; private set; }
    public string ExistingValue { get; private set; }
    public string IncomingSourceId { get; private set; }

    /// <summary>The place in the incoming source (<c>line 12</c>), so the reviewer can look it up.</summary>
    public string? IncomingRef { get; private set; }

    public string IncomingValue { get; private set; }

    /// <summary>Only for a <see cref="InputLibraryConflictField.Match"/> conflict: the draft product the incoming entry became.</summary>
    public string? IncomingProductId { get; private set; }

    public string Status { get; private set; }
    public string? DecidedBy { get; private set; }
    public DateTime? DecidedOn { get; private set; }

    public static InputLibraryConflict Open(
        Guid id, string productId, string field, string existingValue, string incomingSourceId, string? incomingRef, string incomingValue, string? incomingProductId)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("A conflict needs an id.", nameof(id));
        }

        if (string.IsNullOrWhiteSpace(productId) || string.IsNullOrWhiteSpace(field) || string.IsNullOrWhiteSpace(incomingSourceId))
        {
            throw new ArgumentException("A conflict names a product, a field and the incoming source.");
        }

        return new InputLibraryConflict
        {
            Id = id,
            ProductId = productId,
            Field = field,
            ExistingValue = existingValue,
            IncomingSourceId = incomingSourceId,
            IncomingRef = incomingRef,
            IncomingValue = incomingValue,
            IncomingProductId = incomingProductId,
            Status = InputLibraryConflictStatus.Open,
        };
    }

    /// <summary>Settles the conflict. <paramref name="decision"/> is <c>real_difference</c> or <c>error</c>; someone must own the call.</summary>
    public void Decide(string decision, string decidedBy, DateTime decidedOnUtc)
    {
        if (decision is not (InputLibraryConflictStatus.RealDifference or InputLibraryConflictStatus.Error))
        {
            throw new ArgumentException("A conflict is settled as real_difference or error.", nameof(decision));
        }

        if (string.IsNullOrWhiteSpace(decidedBy))
        {
            throw new ArgumentException("Say who decided it.", nameof(decidedBy));
        }

        Status = decision;
        DecidedBy = decidedBy.Trim();
        DecidedOn = decidedOnUtc;
    }
}

/// <summary>The one row of <c>ssf.input_library_meta</c>: the published version and the library's shared word list.</summary>
public sealed class InputLibraryMeta
{
    /// <summary>The only row's id.</summary>
    public const int OnlyId = 1;

    private InputLibraryMeta()
    {
        ShapeVersion = string.Empty;
        NonMatchingWords = "[]";
    } // EF Core

    public int Id { get; private set; } = OnlyId;

    /// <summary>The library's shape version (<c>inputs-2</c>), the first part of the served version string.</summary>
    public string ShapeVersion { get; private set; }

    /// <summary>Bumped on every publish. The served version is <c>{ShapeVersion}.{PublishedVersion}</c>.</summary>
    public int PublishedVersion { get; private set; }

    /// <summary>The common words that never match a product, as a JSON array.</summary>
    public string NonMatchingWords { get; private set; }

    public static InputLibraryMeta Create(string shapeVersion, int publishedVersion, string nonMatchingWords)
    {
        if (string.IsNullOrWhiteSpace(shapeVersion))
        {
            throw new ArgumentException("The library needs a shape version.", nameof(shapeVersion));
        }

        if (publishedVersion < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(publishedVersion), "The first published version is 1.");
        }

        return new InputLibraryMeta { ShapeVersion = shapeVersion, PublishedVersion = publishedVersion, NonMatchingWords = nonMatchingWords };
    }

    /// <summary>The version string the library is served under (and the ETag).</summary>
    public string VersionString => $"{ShapeVersion}.{PublishedVersion}";

    internal void BumpVersion() => PublishedVersion++;
}

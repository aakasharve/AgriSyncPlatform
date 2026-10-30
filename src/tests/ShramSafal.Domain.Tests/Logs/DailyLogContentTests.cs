// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1)
using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.Content;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// Lane F1 — what Sathi understood, stored as one unchangeable row per record version
/// (<see cref="DailyLogContent"/>), and the server's structural reading of the document
/// (<see cref="LogContentDocument"/>). The real-Postgres half (RLS, privileges, atomic create,
/// revisions, the race, pull, erasure) is <c>DailyLogContentRealPostgresTests</c>.
/// </summary>
public sealed class DailyLogContentTests
{
    private static readonly Guid FarmGuid = Guid.Parse("f1f10000-0000-4000-8000-000000000001");
    private static readonly Guid OperatorGuid = Guid.Parse("f1f10000-0000-4000-8000-000000000002");
    private static readonly DateTime At = new(2026, 10, 30, 5, 0, 0, DateTimeKind.Utc);

    private const string Doc = """{"schema":1,"irrigation":[{"id":"irr-1","method":"Flood","source":"Canal","sourceText":"पाटाने दोन तास"}]}""";

    /// <summary>
    /// Review S3 — HIS WORDS, written out here by hand from <c>log.types.ts</c> /
    /// <c>observation.types.ts</c>, NEVER read from <see cref="LogContentDocument.WordKeys"/>: a test
    /// that takes its expectation from the list under test can only ever agree with it.
    /// </summary>
    private static readonly string[] HisWordFields =
    [
        "fullTranscript",
        "sourceText",
        "spokenText",
        "notes",
        "note",
        "impact",
        "dueHint",
        "rawText",
        "description",
        "systemInterpretation",
    ];

    private static DailyLog FarmLog() => DailyLog.CreateForFarm(
        Guid.NewGuid(), FarmGuid, OperatorGuid, new DateOnly(2026, 10, 30), "idem-f1", null, At,
        provenance: Provenance.Manual("1.0.18"), sourceAiJobId: null);

    // ── DailyLogContent ─────────────────────────────────────────────────────────────────

    [Fact]
    public void A_row_takes_its_farm_and_version_from_the_log_never_from_the_caller()
    {
        var log = FarmLog();
        log.NoteContentChanged();

        var row = DailyLogContent.Create(Guid.NewGuid(), log, 1, Doc, DailyLogContent.OriginRevision, 1,
            new UserId(OperatorGuid), At, "req-1", "1.0.18");

        row.DailyLogId.Should().Be(log.Id);
        ((Guid)row.FarmId).Should().Be(FarmGuid);
        row.ContentVersion.Should().Be(2, "the log is at version 2 after one change");
        row.BaseVersion.Should().Be(1);
        row.WordsErasedAtUtc.Should().BeNull();
    }

    [Fact]
    public void A_revision_must_name_the_version_it_was_made_from_and_a_create_must_not()
    {
        var log = FarmLog();

        var noBase = () => DailyLogContent.Create(Guid.NewGuid(), log, 1, Doc, DailyLogContent.OriginRevision, null, new UserId(OperatorGuid), At, null, null);
        noBase.Should().Throw<ArgumentException>();

        var zeroBase = () => DailyLogContent.Create(Guid.NewGuid(), log, 1, Doc, DailyLogContent.OriginRevision, 0, new UserId(OperatorGuid), At, null, null);
        zeroBase.Should().Throw<ArgumentException>();

        var createWithBase = () => DailyLogContent.Create(Guid.NewGuid(), log, 1, Doc, DailyLogContent.OriginCreate, 1, new UserId(OperatorGuid), At, null, null);
        createWithBase.Should().Throw<ArgumentException>();
    }

    [Theory]
    [InlineData("guessed")]
    [InlineData("")]
    public void An_unknown_origin_is_refused(string origin)
    {
        var act = () => DailyLogContent.Create(Guid.NewGuid(), FarmLog(), 1, Doc, origin, null, new UserId(OperatorGuid), At, null, null);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void An_empty_document_or_id_is_refused()
    {
        var emptyDoc = () => DailyLogContent.Create(Guid.NewGuid(), FarmLog(), 1, " ", DailyLogContent.OriginCreate, null, new UserId(OperatorGuid), At, null, null);
        emptyDoc.Should().Throw<ArgumentException>();

        var emptyId = () => DailyLogContent.Create(Guid.Empty, FarmLog(), 1, Doc, DailyLogContent.OriginCreate, null, new UserId(OperatorGuid), At, null, null);
        emptyId.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Erasure_replaces_the_document_once_and_stamps_when()
    {
        var row = DailyLogContent.Create(Guid.NewGuid(), FarmLog(), 1, Doc, DailyLogContent.OriginCreate, null, new UserId(OperatorGuid), At, null, null);

        row.EraseWords("""{"schema":1}""", At.AddDays(1));
        row.EraseWords("""{"schema":1}""", At.AddDays(2));

        row.DocumentJson.Should().Be("""{"schema":1}""");
        row.WordsErasedAtUtc.Should().Be(At.AddDays(1), "the first erasure is the fact; a re-run does not move it");
    }

    // ── DailyLog.MarkContentRevised ─────────────────────────────────────────────────────

    [Fact]
    public void The_log_clock_moves_forward_on_a_content_change_and_never_back()
    {
        var log = FarmLog();
        log.MarkContentRevised(At.AddMinutes(5));
        log.ModifiedAtUtc.Should().Be(At.AddMinutes(5));

        log.MarkContentRevised(At.AddMinutes(1));
        log.ModifiedAtUtc.Should().Be(At.AddMinutes(5), "a backward step would hide the change from every phone's cursor");
    }

    // ── LogContentDocument.Validate — the same rules as the zod schema ───────────────────

    [Fact]
    public void A_real_document_is_accepted()
    {
        using var doc = JsonDocument.Parse(Doc);
        LogContentDocument.Validate(doc.RootElement).Should().BeNull();
    }

    [Theory]
    [InlineData("""{"irrigation":[]}""", "schema is required")]
    [InlineData("""{"schema":2}""", "only format 1 exists")]
    [InlineData("""{"schema":1,"labour":[]}""", "labour has its own path")]
    [InlineData("""{"schema":1,"guess":true}""", "unknown keys are refused, not dropped")]
    [InlineData("""{"schema":1,"inputs":{}}""", "a bucket is a list")]
    [InlineData("""{"schema":1,"inputs":[1]}""", "an item is an object")]
    [InlineData("""{"schema":1,"inputs":[{"productName":"x"}]}""", "an item has an id")]
    [InlineData("""{"schema":1,"inputs":[{"id":""}]}""", "an id is not blank")]
    [InlineData("""{"schema":1,"inputs":[{"id":7}]}""", "an id is a string")]
    [InlineData("""{"schema":1,"disturbance":[]}""", "the chip is an object")]
    [InlineData("""{"schema":1,"fullTranscript":5}""", "his words are a string")]
    [InlineData("""[]""", "the document is an object")]
    [InlineData("""{"schema":1,"inputs":[{"id":"p1"},{"id":"p1"}]}""", "two items in one bucket may not share an id")]
    public void A_malformed_document_is_refused(string json, string because)
    {
        using var doc = JsonDocument.Parse(json);
        LogContentDocument.Validate(doc.RootElement).Should().NotBeNull(because);
    }

    [Fact]
    public void An_item_id_longer_than_128_characters_is_refused()
    {
        using var ok = JsonDocument.Parse($$"""{"schema":1,"inputs":[{"id":"{{new string('a', 128)}}"}]}""");
        LogContentDocument.Validate(ok.RootElement).Should().BeNull();
        using var tooLong = JsonDocument.Parse($$"""{"schema":1,"inputs":[{"id":"{{new string('a', 129)}}"}]}""");
        LogContentDocument.Validate(tooLong.RootElement).Should().NotBeNull();
    }

    [Fact]
    public void The_size_cap_is_64_KiB_of_UTF8_measured_on_the_raw_document()
    {
        static string WithNotes(int n) => $$"""{"schema":1,"inputs":[{"id":"x","notes":"{{new string('a', n)}}"}]}""";
        var overhead = System.Text.Encoding.UTF8.GetByteCount(WithNotes(0));

        using var atCap = JsonDocument.Parse(WithNotes(LogContentDocument.MaxBytes - overhead));
        System.Text.Encoding.UTF8.GetByteCount(atCap.RootElement.GetRawText()).Should().Be(LogContentDocument.MaxBytes);
        LogContentDocument.Validate(atCap.RootElement).Should().BeNull();

        using var over = JsonDocument.Parse(WithNotes(LogContentDocument.MaxBytes - overhead + 1));
        LogContentDocument.Validate(over.RootElement).Should().NotBeNull();
    }

    [Fact]
    public void His_whole_words_are_bounded_at_20000_characters()
    {
        using var ok = JsonDocument.Parse($$"""{"schema":1,"fullTranscript":"{{new string('अ', LogContentDocument.MaxTranscriptLength)}}"}""");
        LogContentDocument.Validate(ok.RootElement).Should().BeNull();
        using var tooLong = JsonDocument.Parse($$"""{"schema":1,"fullTranscript":"{{new string('a', LogContentDocument.MaxTranscriptLength + 1)}}"}""");
        LogContentDocument.Validate(tooLong.RootElement).Should().NotBeNull();
    }

    // ── SameDocument / StripWords / FromManualDraft ─────────────────────────────────────

    [Fact]
    public void Two_documents_saying_the_same_thing_are_the_same_whatever_their_key_order()
    {
        using var reordered = JsonDocument.Parse("""{"irrigation":[{"sourceText":"पाटाने दोन तास","source":"Canal","method":"Flood","id":"irr-1"}],"schema":1}""");
        LogContentDocument.SameDocument(Doc, reordered.RootElement).Should().BeTrue();

        using var changed = JsonDocument.Parse("""{"schema":1,"irrigation":[{"id":"irr-1","method":"Drip","source":"Canal","sourceText":"पाटाने दोन तास"}]}""");
        LogContentDocument.SameDocument(Doc, changed.RootElement).Should().BeFalse();
    }

    [Fact]
    public void Erasure_removes_his_words_at_every_depth_and_keeps_every_value_and_the_observation_text()
    {
        const string full = """
            {"schema":1,"fullTranscript":"आज फवारणी केली","capturedAtUtc":"2026-10-30T05:00:00Z",
             "inputs":[{"id":"p1","productName":"इथरेल","quantity":250,"unit":"मिली","sourceText":"इथरेल अडीचशे मिली","notes":"माझी टीप",
                        "systemInterpretation":"इथरेल फवारणी","provenanceVerified":true,
                        "numbers":{"dose":{"certainty":"approximate","quantity":250,"spokenText":"अंदाजे अडीचशे"}},
                        "mix":[{"id":"m1","productName":"इथरेल","numbers":{"dose":{"certainty":"reported","spokenText":"अडीचशे"}}}],
                        "issue":{"issueType":"PEST","reason":"अळी","note":"खालच्या पानांवर","severity":"HIGH","sourceText":"अळी दिसली"}}],
             "observations":[{"id":"o1","textRaw":"पानावर डाग","textCleaned":"Spots","sourceText":"पानावर डाग दिसले",
                              "extractedTasks":[{"id":"tc1","title":"फवारणी","rawText":"उद्या फवारू"}]}],
             "plannedTasks":[{"id":"t1","title":"फवारणी","description":"उद्या फवारू","dueHint":"उद्या","dueDate":"2026-10-31"}],
             "disturbance":{"scope":"PARTIAL","group":"weather","reason":"पाऊस","note":"दुपारी थांबलो","impact":"अर्धा दिवस गेला",
                            "blockedSegments":["irrigation"],"sourceText":"पाऊस आला"}}
            """;

        // The fixture really carries every one of his word fields, so the assertion below bites.
        foreach (var word in HisWordFields)
        {
            full.Should().Contain($"\"{word}\"", $"the fixture must carry '{word}' for this test to mean anything");
        }

        var stripped = LogContentDocument.StripWords(full);
        using var doc = JsonDocument.Parse(stripped);
        var text = doc.RootElement.GetRawText();

        foreach (var word in HisWordFields)
        {
            text.Should().NotContain($"\"{word}\"", $"'{word}' is his words");
        }

        var input = doc.RootElement.GetProperty("inputs")[0];
        input.GetProperty("productName").GetString().Should().Be("इथरेल");
        input.GetProperty("quantity").GetInt32().Should().Be(250);
        input.GetProperty("unit").GetString().Should().Be("मिली");
        input.GetProperty("provenanceVerified").GetBoolean().Should().BeTrue();
        input.GetProperty("numbers").GetProperty("dose").GetProperty("certainty").GetString().Should().Be("approximate");
        input.GetProperty("numbers").GetProperty("dose").GetProperty("quantity").GetInt32().Should().Be(250);
        input.GetProperty("issue").GetProperty("reason").GetString().Should().Be("अळी", "the issue's reason is its value");
        input.GetProperty("issue").GetProperty("severity").GetString().Should().Be("HIGH");
        doc.RootElement.GetProperty("observations")[0].GetProperty("textRaw").GetString().Should().Be("पानावर डाग",
            "observation text follows the existing D-FREETEXT-PRESERVE disposition");
        doc.RootElement.GetProperty("plannedTasks")[0].GetProperty("dueDate").GetString().Should().Be("2026-10-31");
        doc.RootElement.GetProperty("plannedTasks")[0].GetProperty("title").GetString().Should().Be("फवारणी");
        var disturbance = doc.RootElement.GetProperty("disturbance");
        disturbance.GetProperty("reason").GetString().Should().Be("पाऊस", "the disturbance reason follows D-FREETEXT-PRESERVE");
        disturbance.GetProperty("scope").GetString().Should().Be("PARTIAL");
        doc.RootElement.GetProperty("capturedAtUtc").GetString().Should().Be("2026-10-30T05:00:00Z");
    }

    [Fact]
    public void The_word_list_is_exactly_the_free_text_he_says_or_types()
    {
        LogContentDocument.WordKeys.Should().BeEquivalentTo(HisWordFields,
            "a field added to or dropped from the list must be a decision recorded here, by hand");
    }

    // ── Review S1 — an edit by someone who was sent the document WITHOUT the words ──────────

    [Fact]
    public void An_edit_by_a_reader_who_could_not_see_the_words_keeps_them_and_keeps_his_own_changes()
    {
        const string previous = """
            {"schema":1,"fullTranscript":"आज पाणी दिलं आणि इथरेल मारलं",
             "irrigation":[{"id":"i1","durationHours":2,"sourceText":"दोन तास पाणी","notes":"विहीर",
                            "numbers":{"durationHours":{"certainty":"reported","quantity":2,"spokenText":"दोन तास"}}}],
             "inputs":[{"id":"p1","productName":"इथरेल","sourceText":"इथरेल मारलं"},
                       {"id":"p2","productName":"युरिया","sourceText":"युरिया टाकला"}]}
            """;
        // What the worker's phone was sent (no words), then edited: the hours changed, युरिया removed,
        // a new spray added with his own note.
        const string edit = """
            {"schema":1,
             "irrigation":[{"id":"i1","durationHours":3,"numbers":{"durationHours":{"certainty":"reported","quantity":3}}}],
             "inputs":[{"id":"p1","productName":"इथरेल"},{"id":"p3","productName":"मॅन्कोझेब","notes":"नवीन"}]}
            """;

        using var merged = JsonDocument.Parse(LogContentDocument.CarryWordsForward(previous, edit));
        var root = merged.RootElement;

        root.GetProperty("fullTranscript").GetString().Should().Be("आज पाणी दिलं आणि इथरेल मारलं");
        var water = root.GetProperty("irrigation")[0];
        water.GetProperty("durationHours").GetInt32().Should().Be(3, "his change stands");
        water.GetProperty("sourceText").GetString().Should().Be("दोन तास पाणी");
        water.GetProperty("notes").GetString().Should().Be("विहीर");
        water.GetProperty("numbers").GetProperty("durationHours").GetProperty("spokenText").GetString().Should().Be("दोन तास");
        water.GetProperty("numbers").GetProperty("durationHours").GetProperty("quantity").GetInt32().Should().Be(3);
        root.GetProperty("inputs").GetArrayLength().Should().Be(2, "the removed item stays removed");
        root.GetProperty("inputs")[0].GetProperty("sourceText").GetString().Should().Be("इथरेल मारलं");
        root.GetProperty("inputs")[1].GetProperty("notes").GetString().Should().Be("नवीन", "what he wrote is his");
        root.GetProperty("inputs")[1].TryGetProperty("sourceText", out _).Should().BeFalse("a new item has no earlier words");
        root.GetRawText().Should().NotContain("युरिया टाकला", "the words of an item he removed do not come back");
    }

    [Fact]
    public void An_older_phones_manual_draft_becomes_its_content_labour_and_the_day_outcome_left_out()
    {
        using var draft = JsonDocument.Parse("""
            {"labour":[{"id":"l1","count":8}],"dayOutcome":"WORK_RECORDED",
             "irrigation":[{"id":"irr-1","method":"Flood","source":"Canal","durationHours":2}],
             "inputs":[],"machinery":null,"disturbance":{"scope":"PARTIAL","reason":"पाऊस"}}
            """);

        var json = LogContentDocument.FromManualDraft(draft.RootElement);

        json.Should().NotBeNull();
        using var doc = JsonDocument.Parse(json!);
        LogContentDocument.Validate(doc.RootElement).Should().BeNull();
        doc.RootElement.TryGetProperty("labour", out _).Should().BeFalse();
        doc.RootElement.TryGetProperty("dayOutcome", out _).Should().BeFalse();
        doc.RootElement.TryGetProperty("inputs", out _).Should().BeFalse("an empty bucket says nothing");
        doc.RootElement.GetProperty("irrigation")[0].GetProperty("method").GetString().Should().Be("Flood");
        doc.RootElement.GetProperty("disturbance").GetProperty("reason").GetString().Should().Be("पाऊस");
    }

    // ── TaskLines — every item gets exactly ONE task line, from whichever source wrote it first ──

    [Fact]
    public void A_new_phones_create_lines_every_item_an_old_phones_draft_none()
    {
        TaskLines.All.Write.Should().BeTrue();
        TaskLines.All.AlreadyLined.Should().BeEmpty();
        TaskLines.None.Write.Should().BeFalse("an older phone sends its own add_log_task for every item");
    }

    [Fact]
    public void A_revision_lines_only_items_the_previous_version_did_not_have()
    {
        var since = TaskLines.NewSince(Doc);
        since.Write.Should().BeTrue();
        since.AlreadyLined.Should().BeEquivalentTo(["irrigation:irr-1"]);
        since.MatchOlderLines.Should().BeFalse();
    }

    [Fact]
    public void A_revision_of_an_older_record_lines_only_the_item_no_existing_line_stands_for()
    {
        // An older phone's voice save: two task lines, no stored content (review S6).
        var log = FarmLog();
        var sprayLine = Guid.NewGuid();
        var waterLine = Guid.NewGuid();
        log.AddTask(sprayLine, "Spray इथरेल", null, At);
        log.AddTask(waterLine, "Irrigation", "Duration: 2 hrs", At);

        // A new phone rebuilt the items from those lines (item id = line id), changed the water
        // and added a spray.
        using var doc = JsonDocument.Parse($$"""
            {"schema":1,
             "irrigation":[{"id":"{{waterLine}}","durationHours":3}],
             "inputs":[{"id":"{{sprayLine}}","productName":"इथरेल"},{"id":"new-1","productName":"मॅन्कोझेब"}]}
            """);

        var lines = TaskLines.Unlined(
            LogTaskProjection.Project(log.Id, doc.RootElement), log.Tasks, TaskLines.NewSince(null));

        lines.Should().ContainSingle("only the spray he added is new");
        lines[0].ActivityType.Should().Be("Spray मॅन्कोझेब");
        lines[0].ItemId.Should().Be("new-1");
    }

    [Fact]
    public void The_older_phones_own_copy_of_its_record_matches_its_lines_by_what_they_say()
    {
        // The phone that made the record kept its own item ids, which its task lines never carried
        // (a scoped id is replaced by a fresh one on the wire). Each line reads exactly like one item.
        var log = FarmLog();
        log.AddTask(Guid.NewGuid(), "Irrigation", "Duration: 2 hrs", At);
        log.AddTask(Guid.NewGuid(), "Weeding", null, At);

        using var doc = JsonDocument.Parse("""
            {"schema":1,
             "cropActivities":[{"id":"act-1::plot-a","title":"Weeding"}],
             "irrigation":[{"id":"irr-1::plot-a","durationHours":2},{"id":"irr-2","durationHours":2}]}
            """);

        var lines = TaskLines.Unlined(
            LogTaskProjection.Project(log.Id, doc.RootElement), log.Tasks, TaskLines.NewSince(null));

        lines.Should().ContainSingle("two items are the existing lines; the second, identical watering is new");
        lines[0].ItemId.Should().Be("irr-2");
    }

    [Theory]
    [InlineData("""{"labour":[{"id":"l1"}],"dayOutcome":"NO_WORK_PLANNED"}""")]
    [InlineData("""{"irrigation":[{"method":"Flood"}]}""")]
    public void A_draft_with_nothing_to_store_or_an_item_without_an_id_stores_no_content(string json)
    {
        using var draft = JsonDocument.Parse(json);
        LogContentDocument.FromManualDraft(draft.RootElement).Should().BeNull(
            "the old path then stands alone, exactly as today — nothing is refused (P9)");
    }
}

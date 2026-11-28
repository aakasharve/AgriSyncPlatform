using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Inputs;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice AI, founder 28 Nov 2026) — what the speech-to-text calls now carry
/// (saaras:v4 keyterms, codemix, no diarization) and the live-words pieces (audio check, ration, transcriber).
/// Fakes and canned Sarvam answers only: no test here reaches Sarvam. A canned answer proves WE ask for, and keep, what the
/// model is documented to return; it cannot prove how well the model itself hears, which needs a real, paid call.
/// </summary>
public sealed class PlrVoiceLiveWordsAndKeytermsTests(Xunit.Abstractions.ITestOutputHelper output)
{
    // ── keyterms: which terms ──────────────────────────────────────────────

    [Fact]
    public void Keyterms_OfTheRealLibrary_AreWithinSarvamsLimits_AndHaveNoRepeats()
    {
        var terms = SttKeyterms.Current;
        output.WriteLine($"KEYTERMS ({terms.Count}): {string.Join(" | ", terms)}");

        Assert.NotEmpty(terms);
        Assert.True(terms.Count <= SttKeyterms.MaxTerms, $"{terms.Count} terms, Sarvam takes at most {SttKeyterms.MaxTerms}");
        Assert.All(terms, t => Assert.InRange(t.Length, 1, SttKeyterms.MaxTermChars));
        Assert.Equal(terms.Count, terms.Select(t => t.ToLowerInvariant()).Distinct().Count());
        Assert.All(terms, t => Assert.DoesNotContain(t, c => char.IsDigit(c))); // strengths and NPK grades are not names he says
    }

    [Fact]
    public void Keyterms_OfTheRealLibrary_HoldThePilotCrops_TheApprovedExampleBrand_AndTheMostCommonChemicals()
    {
        var terms = SttKeyterms.Current;

        foreach (var crop in SttKeyterms.PilotCrops)
        {
            Assert.Contains(crop, terms);
        }

        Assert.Contains(terms, t => string.Equals(t, "Confidor", StringComparison.OrdinalIgnoreCase));
        // Held by the most library products, so first in line (Mancozeb is in 14 products, the most of any name).
        Assert.Contains("Mancozeb", terms);
        Assert.Contains("Imidacloprid", terms);
        Assert.Contains("Tebuconazole", terms);
        // No common English word that the library prints as a brand ("root", "double") is ever a term.
        foreach (var word in InputCatalog.NonMatchingWords)
        {
            Assert.DoesNotContain(terms, t => string.Equals(t, word, StringComparison.OrdinalIgnoreCase));
        }
    }

    [Fact]
    public void Keyterms_ChooseIngredientsByHowManyNewProductsEachOneReaches()
    {
        // A holds p1,p2,p3; B holds p3,p4; C holds p1,p2 (adds nothing after A); D holds p5.
        var products = new[]
        {
            Product("p1", ["A"]),
            Product("p2", ["A", "C"]),
            Product("p3", ["A", "B"]),
            Product("p4", ["B"]),
            Product("p5", ["D"]),
        };

        var terms = SttKeyterms.Build(products, []);

        var chemicals = terms.Except(SttKeyterms.PilotCrops).ToList();
        Assert.Equal(["A", "B", "D", "C"], chemicals); // A (3 new), B (1 new: p4), D (1 new: p5, A-Z after B), then C (0 new)
    }

    [Fact]
    public void Keyterms_TakeTheLibrarysOwnSpellingOfTheBrand_AndSkipWordsTheLibraryCallsCommon()
    {
        var products = new[]
        {
            Product("p1", ["Imidacloprid"], brands: ["Confidor"]),
            Product("p2", ["Root"], brands: ["Other"]),
        };

        var terms = SttKeyterms.Build(products, ["root"]);

        Assert.Contains("Confidor", terms);
        Assert.Contains("Imidacloprid", terms);
        Assert.DoesNotContain(terms, t => t.Equals("Root", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Keyterms_NeverGoPastFifty_AndDropBracketedNotesDigitsAndLongNames()
    {
        var many = Enumerable.Range(0, 80)
            .Select(i => Product($"p{i}", [$"Chem{(char)('a' + i % 26)}{(char)('a' + i / 26)}x"]))
            .Append(Product("note", ["Homobrassinolide (HBR)"]))
            .Append(Product("digit", ["Vitamin B12"]))
            .Append(Product("long", [new string('z', 70)]))
            .ToList();

        var terms = SttKeyterms.Build(many, []);

        Assert.Equal(SttKeyterms.MaxTerms, terms.Count);
        Assert.DoesNotContain(terms, t => t.Contains('(') || t.Any(char.IsDigit) || t.Length > SttKeyterms.MaxTermChars);
        Assert.Equal("Homobrassinolide", SttKeyterms.Clean("Homobrassinolide (HBR)"));
        Assert.Null(SttKeyterms.Clean("Vitamin B12"));
    }

    [Fact]
    public void Keyterms_WireValue_IsOneJsonArrayText_WithDevanagariKept()
    {
        var wire = SttKeyterms.ToFormValue(["Mancozeb", "द्राक्ष"]);

        Assert.Equal("[\"Mancozeb\",\"द्राक्ष\"]", wire);
        Assert.Equal(["Mancozeb", "द्राक्ष"], JsonSerializer.Deserialize<string[]>(wire!)!);
        Assert.Null(SttKeyterms.ToFormValue([]));
        Assert.True(SttKeyterms.ModelSupports("saaras:v4"));
        Assert.False(SttKeyterms.ModelSupports("saaras:v3"));
        Assert.False(SttKeyterms.ModelSupports(null));
    }

    // ── keyterms / mode / diarization on the wire ──────────────────────────

    [Fact]
    public async Task SttCall_OnSaarasV4_SendsCodemixMarathiAndKeyterms_AndNeverDiarization()
    {
        var fields = await CaptureFieldsAsync(new SarvamOptions { ApiSubscriptionKey = "k", SttEndpoint = "https://unit.test/stt" });

        Assert.Equal("saaras:v4", fields["model"]);
        Assert.Equal("codemix", fields["mode"]);
        Assert.Equal("mr-IN", fields["language_code"]);
        Assert.DoesNotContain("with_diarization", fields.Keys);
        var keyterms = JsonSerializer.Deserialize<string[]>(fields["keyterms"])!;
        Assert.Equal(SttKeyterms.Current, keyterms);
        Assert.Contains("Mancozeb", keyterms);
    }

    [Fact]
    public async Task SttCall_SendsNoKeyterms_OnAnotherModel_OrWhenSwitchedOff()
    {
        var older = await CaptureFieldsAsync(new SarvamOptions { ApiSubscriptionKey = "k", SttEndpoint = "https://unit.test/stt", SttModel = "saaras:v3" });
        var off = await CaptureFieldsAsync(new SarvamOptions { ApiSubscriptionKey = "k", SttEndpoint = "https://unit.test/stt", SttKeytermsEnabled = false });

        Assert.DoesNotContain("keyterms", older.Keys);
        Assert.DoesNotContain("keyterms", off.Keys);
        Assert.Equal("codemix", off["mode"]);
    }

    [Fact]
    public async Task DiarizationRequest_IsRefusedWithoutAnyRequest_BecauseSarvamsRestHasNone()
    {
        var calls = 0;
        var stt = Client(new SarvamOptions { ApiSubscriptionKey = "k", SttEndpoint = "https://unit.test/stt" }, _ => { calls++; return Answer("{\"transcript\":\"x\"}"); });

        await using var audio = new MemoryStream([1, 2, 3, 4]);
        var result = await stt.TranscribeAsync(audio, "audio/webm", "mr-IN", withDiarization: true, CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SarvamSttClient.DiarizationUnsupportedError, result.Error);
        Assert.Equal(0, calls);
    }

    // ── codemix keeps English names whole; Marathi number words are not touched (canned Sarvam answers) ──

    public static TheoryData<string> CodemixAnswers => new()
    {
        // The shape and style of Sarvam's documented codemix example: English words in Latin script, Indic words in Devanagari.
        "आज Confidor अडीचशे ml फवारणी केली",
        "आज पाच मजूर होते, चार तास Mancozeb ची फवारणी केली",
        "मेरा phone number है 9840950950",
        "NPK 19:19:19 दोन किलो आणि Imidacloprid दीडशे ml टाकलं",
        "आज पंधरा मजूर, चार तास, अडीचशे ग्रॅम, तीनशे रुपये",
    };

    [Theory]
    [MemberData(nameof(CodemixAnswers))]
    public async Task SttCall_ReturnsTheCodemixAnswerExactly_LatinNamesDigitsAndMarathiNumberWordsIntact(string spoken)
    {
        var body = JsonSerializer.Serialize(new { transcript = spoken, language_code = "mr-IN" }, new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.Default });
        var stt = Client(new SarvamOptions { ApiSubscriptionKey = "k", SttEndpoint = "https://unit.test/stt" }, _ => Answer(body));

        await using var audio = new MemoryStream([1, 2, 3, 4]);
        var result = await stt.TranscribeAsync(audio, "audio/webm", "mr-IN", CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(spoken, result.Transcript); // no re-spelling into Devanagari, no digit or number-word rewriting
        foreach (var latin in spoken.Split(' ', ',').Where(w => w.Length > 2 && w.All(c => c is >= 'A' and <= 'z')))
        {
            Assert.Contains(latin, result.Transcript);
        }
    }

    // ── live words: the audio check ────────────────────────────────────────

    [Fact]
    public void LiveWordsAudio_AcceptsOnePhraseInTheRecordersOwnFormat()
    {
        Assert.Null(LiveWordsAudio.Refusal(Wav(seconds: 3)));
        Assert.Null(LiveWordsAudio.Refusal(Wav(seconds: LiveWordsAudio.MaxSeconds)));
        Assert.Null(LiveWordsAudio.Refusal(Wav(seconds: LiveWordsAudio.MinSeconds)));
    }

    [Fact]
    public void LiveWordsAudio_RefusesEverythingElse_BeforeAnyMoneyIsSpent()
    {
        Assert.NotNull(LiveWordsAudio.Refusal([]));
        Assert.NotNull(LiveWordsAudio.Refusal("not a wav at all, just some text that is long enough for a header...."u8));
        Assert.Contains("longer than", LiveWordsAudio.Refusal(Wav(seconds: 13))!);
        Assert.Contains("too short", LiveWordsAudio.Refusal(Wav(seconds: 0.1))!);
        Assert.Contains("16 kHz", LiveWordsAudio.Refusal(Wav(seconds: 2, rate: 8000))!);
        Assert.Contains("mono", LiveWordsAudio.Refusal(Wav(seconds: 2, channels: 2))!);
        Assert.Contains("16-bit", LiveWordsAudio.Refusal(Wav(seconds: 2, bits: 8))!);
        Assert.Contains("16 kHz", LiveWordsAudio.Refusal(Wav(seconds: 2, format: 7))!); // mu-law
        var torn = Wav(seconds: 2);
        Assert.Contains("length", LiveWordsAudio.Refusal(torn.AsSpan(0, torn.Length - 10))!);
        Assert.True(LiveWordsAudio.MaxBytes >= Wav(seconds: LiveWordsAudio.MaxSeconds).Length);
    }

    // ── live words: the ration ─────────────────────────────────────────────

    [Fact]
    public void Gate_HoldsAtMostTheConfiguredNumberAtOnce_AndFreesAPlaceWhenAPieceEnds()
    {
        var gate = new LiveWordsGate(Options.Create(new SarvamOptions { LiveWordsMaxConcurrent = 2, LiveWordsMaxPerMinute = 100 }));

        var first = gate.TryEnter();
        var second = gate.TryEnter();
        Assert.NotNull(first);
        Assert.NotNull(second);
        Assert.Null(gate.TryEnter());

        first!.Dispose();
        first.Dispose(); // a second dispose frees nothing more
        var third = gate.TryEnter();
        Assert.NotNull(third);
        Assert.Null(gate.TryEnter());
        second!.Dispose();
        third!.Dispose();
    }

    [Fact]
    public void Gate_HoldsAtMostTheConfiguredNumberPerRollingMinute()
    {
        var clock = new FakeClock();
        var gate = new LiveWordsGate(Options.Create(new SarvamOptions { LiveWordsMaxConcurrent = 10, LiveWordsMaxPerMinute = 3 }), clock);

        for (var i = 0; i < 3; i++)
        {
            gate.TryEnter()!.Dispose();
        }

        Assert.Null(gate.TryEnter());
        clock.Advance(TimeSpan.FromSeconds(59));
        Assert.Null(gate.TryEnter());
        clock.Advance(TimeSpan.FromSeconds(2));
        Assert.NotNull(gate.TryEnter());
    }

    // ── live words: the transcriber over the real client with a fake Sarvam ─

    [Fact]
    public async Task LiveWords_ReturnsTheWordsHeard_AndAskedSarvamOnceWithKeytermsAndNoRetry()
    {
        var calls = 0;
        IReadOnlyDictionary<string, string>? fields = null;
        var transcriber = Transcriber(new SarvamOptions { ApiSubscriptionKey = "k", SttEndpoint = "https://unit.test/stt" }, request =>
        {
            calls++;
            fields = FormFieldsOf(request);
            return Answer("{\"transcript\":\"आज पाच मजूर होते\",\"language_code\":\"mr-IN\"}");
        });

        var result = await transcriber.TranscribeAsync(Wav(seconds: 3), null, CancellationToken.None);

        Assert.Equal(LiveWordsOutcome.Words, result.Outcome);
        Assert.Equal("आज पाच मजूर होते", result.Text);
        Assert.Equal(1, calls);
        Assert.Equal("codemix", fields!["mode"]);
        Assert.Equal("mr-IN", fields["language_code"]);
        Assert.Contains("keyterms", fields.Keys);
    }

    [Fact]
    public async Task LiveWords_AQuietPiece_IsNotAFailure()
    {
        var transcriber = Transcriber(new SarvamOptions { ApiSubscriptionKey = "k", SttEndpoint = "https://unit.test/stt" }, _ => Answer("{\"transcript\":\"\",\"language_code\":\"mr-IN\"}"));

        var result = await transcriber.TranscribeAsync(Wav(seconds: 2), "mr-IN", CancellationToken.None);

        Assert.Equal(LiveWordsOutcome.Quiet, result.Outcome);
        Assert.Equal(string.Empty, result.Text);
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests, LiveWordsOutcome.Busy)]
    [InlineData(HttpStatusCode.BadGateway, LiveWordsOutcome.Busy)]
    [InlineData(HttpStatusCode.BadRequest, LiveWordsOutcome.Unavailable)]
    public async Task LiveWords_ASarvamFailure_IsNeverRetried_AndNeverThrown(HttpStatusCode status, LiveWordsOutcome expected)
    {
        var calls = 0;
        var transcriber = Transcriber(new SarvamOptions { ApiSubscriptionKey = "k", SttEndpoint = "https://unit.test/stt" }, _ =>
        {
            calls++;
            return new HttpResponseMessage(status) { Content = new StringContent("{\"error\":\"x\"}", Encoding.UTF8, "application/json") };
        });

        var result = await transcriber.TranscribeAsync(Wav(seconds: 2), null, CancellationToken.None);

        Assert.Equal(expected, result.Outcome);
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task LiveWords_WhenSwitchedOff_OrTheRationIsUsedUp_NoRequestIsMade()
    {
        var calls = 0;
        var off = Transcriber(new SarvamOptions { ApiSubscriptionKey = "k", SttEndpoint = "https://unit.test/stt", LiveWordsEnabled = false }, _ => { calls++; return Answer("{\"transcript\":\"x\"}"); });
        Assert.False(off.Enabled);
        Assert.Equal(LiveWordsOutcome.Unavailable, (await off.TranscribeAsync(Wav(seconds: 2), null, CancellationToken.None)).Outcome);

        var options = new SarvamOptions { ApiSubscriptionKey = "k", SttEndpoint = "https://unit.test/stt", LiveWordsMaxConcurrent = 1 };
        var gate = new LiveWordsGate(Options.Create(options));
        using var held = gate.TryEnter(); // another farmer's piece is in flight
        var busy = Transcriber(options, _ => { calls++; return Answer("{\"transcript\":\"x\"}"); }, gate);

        Assert.Equal(LiveWordsOutcome.Busy, (await busy.TranscribeAsync(Wav(seconds: 2), null, CancellationToken.None)).Outcome);
        Assert.Equal(0, calls);
    }

    [Fact]
    public async Task LiveWords_ALostConnection_IsAnAnswerNotAnException()
    {
        var transcriber = Transcriber(new SarvamOptions { ApiSubscriptionKey = "k", SttEndpoint = "https://unit.test/stt" }, _ => throw new HttpRequestException("network down"));

        var result = await transcriber.TranscribeAsync(Wav(seconds: 2), null, CancellationToken.None);

        Assert.Equal(LiveWordsOutcome.Busy, result.Outcome); // a dropped connection is retryable: back off, try the next phrase
    }

    // ── helpers ────────────────────────────────────────────────────────────

    private static CatalogProduct Product(string id, string[] ingredients, string[]? brands = null, string[]? aliases = null) =>
        new(
            id, "insecticide",
            ingredients.Select(i => new CatalogIngredient(i, null, null)).ToList(),
            null,
            (brands ?? []).Select(b => new CatalogBrand(b, null, null, null)).ToList(),
            [], [], [], [], null, [], aliases ?? [], [], []);

    private static HttpResponseMessage Answer(string json) =>
        new(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private static SarvamSttClient Client(SarvamOptions options, Func<HttpRequestMessage, HttpResponseMessage> responder) =>
        new(Options.Create(options), new StaticHttpClientFactory(new HttpClient(new StubHttpMessageHandler(responder))), NullLogger<SarvamSttClient>.Instance);

    private static SarvamLiveWordsTranscriber Transcriber(SarvamOptions options, Func<HttpRequestMessage, HttpResponseMessage> responder, LiveWordsGate? gate = null) =>
        new(Client(options, responder), gate ?? new LiveWordsGate(Options.Create(options)), Options.Create(options), NullLogger<SarvamLiveWordsTranscriber>.Instance);

    private static async Task<IReadOnlyDictionary<string, string>> CaptureFieldsAsync(SarvamOptions options)
    {
        IReadOnlyDictionary<string, string>? fields = null;
        var stt = Client(options, request =>
        {
            fields = FormFieldsOf(request);
            return Answer("{\"transcript\":\"ok\",\"language_code\":\"mr-IN\"}");
        });
        await using var audio = new MemoryStream([1, 2, 3, 4]);
        var result = await stt.TranscribeAsync(audio, "audio/webm", "mr-IN", CancellationToken.None);
        Assert.True(result.IsSuccess);
        return fields!;
    }

    /// <summary>The text fields of a multipart request (the audio file part is left out).</summary>
    private static Dictionary<string, string> FormFieldsOf(HttpRequestMessage request)
    {
        var fields = new Dictionary<string, string>();
        foreach (var part in (MultipartFormDataContent)request.Content!)
        {
            var name = part.Headers.ContentDisposition?.Name?.Trim('"');
            if (name is null || part.Headers.ContentDisposition?.FileName is not null)
            {
                continue;
            }

            fields[name] = part.ReadAsStringAsync().GetAwaiter().GetResult();
        }

        return fields;
    }

    /// <summary>A canonical 44-byte-header PCM WAV with silence for its samples.</summary>
    private static byte[] Wav(double seconds, int rate = 16000, short channels = 1, short bits = 16, short format = 1)
    {
        var data = (int)(seconds * 16000 * 2);
        var bytes = new byte[44 + data];
        Encoding.ASCII.GetBytes("RIFF").CopyTo(bytes, 0);
        BitConverter.GetBytes(36 + data).CopyTo(bytes, 4);
        Encoding.ASCII.GetBytes("WAVEfmt ").CopyTo(bytes, 8);
        BitConverter.GetBytes(16).CopyTo(bytes, 16);
        BitConverter.GetBytes(format).CopyTo(bytes, 20);
        BitConverter.GetBytes(channels).CopyTo(bytes, 22);
        BitConverter.GetBytes(rate).CopyTo(bytes, 24);
        BitConverter.GetBytes(rate * channels * bits / 8).CopyTo(bytes, 28);
        BitConverter.GetBytes((short)(channels * bits / 8)).CopyTo(bytes, 32);
        BitConverter.GetBytes(bits).CopyTo(bytes, 34);
        Encoding.ASCII.GetBytes("data").CopyTo(bytes, 36);
        BitConverter.GetBytes(data).CopyTo(bytes, 40);
        return bytes;
    }

    private sealed class FakeClock : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 11, 28, 6, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now += by;
    }
}

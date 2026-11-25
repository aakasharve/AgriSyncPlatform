// spec: plr-d10-schedule-approved-spec-2026-11-23 (acceptance: "A creator cannot reach a farm, admin, another creator's work or self-approval" and "One invited creator goes
// end to end: send, return, approve, a farmer follows"); slice 15, server half.
//
// A creator's work and files, and the staff check of them. Real Postgres as agrisync_app, the real host, a creator signed in for real.
using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Domain.Creators;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Creators;

[Trait("Category", "RequiresPostgres")]
public sealed class CreatorDoorFilesRealPostgresTests(ITestOutputHelper output) : CreatorDoorLane(output)
{
    /// <summary>The standard anti-virus test file, assembled from parts (no file of this repository holds it whole). It never touches a disk here: it travels in memory only.</summary>
    private static byte[] TestVirus() => Encoding.ASCII.GetBytes("X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + "EICAR-STANDARD-" + "ANTIVIRUS-TEST-FILE" + "!$H+H*");

    private int StoredFiles() => Directory.Exists(StorageDirectory)
        ? Directory.EnumerateFiles(StorageDirectory, "*", SearchOption.AllDirectories).Count(f => f.Replace('\\', '/').Contains(CreatorFile.StoragePrefix, StringComparison.Ordinal))
        : 0;

    [Fact]
    public async Task EicarTestFile_Blocked_WithWords()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var creator = await InvitedCreatorAsync();
        var draft = await NewDraftAsync(creator);

        // As it is, under an innocent name and type.
        var plain = await UploadAsync(creator, draft, TestVirus(), "schedule-source.pdf", "application/pdf");
        plain.Status.Should().Be(HttpStatusCode.UnprocessableEntity, plain.Body);
        plain.Error.Should().Be("Creator.FileBlocked");
        plain.Message.Should().Contain("standard anti-virus test file").And.Contain("treated as a virus").And.Contain("not kept");

        // Hidden inside something that starts like a real PDF.
        var wrapped = Pdf(2000);
        TestVirus().CopyTo(wrapped, 900);
        var hidden = await UploadAsync(creator, draft, wrapped, "notes.pdf", "application/pdf");
        hidden.Status.Should().Be(HttpStatusCode.UnprocessableEntity, hidden.Body);
        hidden.Message.Should().Contain("standard anti-virus test file");

        // What is kept: two rows saying what was refused and why (state 2 = blocked), and NOT ONE byte in storage.
        (await ScalarAsync("SELECT string_agg(state::text || ':' || scanner_name || ':' || (scan_words LIKE '%anti-virus test file%')::text, '|') FROM ssf.creator_files"))
            .Should().Be("2:builtin:true|2:builtin:true");
        StoredFiles().Should().Be(0, "a refused file is never written anywhere");

        // Nobody can read it: not its creator, not staff; and it does not count as a file of the work.
        var list = await DoorAsync(HttpMethod.Get, $"/creator/submissions/{draft}/files", bearer: creator.Token);
        var rows = list.Json.EnumerateArray().ToList();
        rows.Should().HaveCount(2).And.OnlyContain(f => f.GetProperty("state").GetString() == "Blocked");
        var blockedId = rows[0].GetProperty("id").GetGuid();
        (await DoorAsync(HttpMethod.Get, $"/creator/files/{blockedId}", bearer: creator.Token)).Status.Should().Be(HttpStatusCode.NotFound);
        await SubmitAsync(creator, draft);
        var (staffFile, _) = await SendJsonAsync(HttpMethod.Get, $"/shramsafal/creator-door/files/{blockedId}", PlatformEmployee, null);
        staffFile.Should().Be(HttpStatusCode.NotFound);
        (await StaffViewAsync(draft)).GetProperty("files").GetArrayLength().Should().Be(0);

        // A clean file beside it is kept and readable (the scanner is not refusing everything).
        var second = await NewDraftAsync(creator, Body(name: WorkName + " २"));
        var clean = await UploadAsync(creator, second, Pdf(), "clean.pdf");
        clean.Status.Should().Be(HttpStatusCode.Created, clean.Body);
        clean.Json.GetProperty("state").GetString().Should().Be("Clean");
        StoredFiles().Should().Be(1);
    }

    [Fact]
    public async Task FileLimits_And_TypeSniff()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var creator = await InvitedCreatorAsync();
        var draft = await NewDraftAsync(creator);

        // The kind is read from the bytes, never the name or the type the browser said.
        var words = await UploadAsync(creator, draft, Encoding.UTF8.GetBytes("just some words, named like a PDF"), "schedule.pdf", "application/pdf");
        words.Status.Should().Be(HttpStatusCode.UnprocessableEntity, words.Body);
        words.Message.Should().Contain("Only PDF, JPEG and PNG files are taken").And.Contain("not its name");
        var script = await UploadAsync(creator, draft, Encoding.ASCII.GetBytes("MZ\u0090\0 this is a program"), "photo.png", "image/png");
        script.Status.Should().Be(HttpStatusCode.UnprocessableEntity);
        var png = await UploadAsync(creator, draft, CreatorDoorPictures.Png(withMetadata: false), "notes.txt", "text/plain");
        png.Status.Should().Be(HttpStatusCode.Created, png.Body);
        png.Json.GetProperty("mimeType").GetString().Should().Be("image/png", "a PNG is a PNG whatever it was called");
        (await UploadAsync(creator, draft, [], "empty.pdf")).Error.Should().Be("Creator.FileEmpty");

        // Ten megabytes a file: exactly ten is taken, one byte more is not.
        var atLimit = await UploadAsync(creator, draft, Pdf((int)CreatorFile.MaxBytes), "big.pdf");
        atLimit.Status.Should().Be(HttpStatusCode.Created, atLimit.Body);
        var over = await UploadAsync(creator, draft, Pdf((int)CreatorFile.MaxBytes + 1), "too-big.pdf");
        over.Status.Should().Be(HttpStatusCode.BadRequest, over.Body);
        over.Error.Should().Be("Creator.FileTooLarge");
        over.Message.Should().Contain("at most 10 MB");

        // Ten files a piece of work (refused files do not count): two are kept so far; eight more fit, the eleventh does not.
        for (var i = 0; i < 8; i++)
        {
            (await UploadAsync(creator, draft, Pdf(400 + i), $"small-{i}.pdf")).Status.Should().Be(HttpStatusCode.Created);
        }

        var eleventh = await UploadAsync(creator, draft, Pdf(), "eleventh.pdf");
        eleventh.Status.Should().Be(HttpStatusCode.BadRequest, eleventh.Body);
        eleventh.Error.Should().Be("Creator.FileCount");
        eleventh.Message.Should().Contain("at most 10 files");
        (await ScalarAsync("SELECT count(*) FROM ssf.creator_files WHERE state = 1 AND submission_id = @s", ("s", draft))).Should().Be("10");

        // Fifty megabytes a piece of work: five files of ten megabytes fit; one more byte of file does not.
        var heavy = await NewDraftAsync(creator, Body(name: WorkName + " मोठे"));
        for (var i = 0; i < 5; i++)
        {
            (await UploadAsync(creator, heavy, Pdf((int)CreatorFile.MaxBytes, (byte)('a' + i)), $"ten-{i}.pdf")).Status.Should().Be(HttpStatusCode.Created);
        }

        var overTotal = await UploadAsync(creator, heavy, Pdf(), "one-more.pdf");
        overTotal.Status.Should().Be(HttpStatusCode.BadRequest, overTotal.Body);
        overTotal.Error.Should().Be("Creator.FileTotal");
        overTotal.Message.Should().Contain("at most 50 MB");

        // A file can be added only to a draft; removing the drafts removes their files and their bytes.
        var sent = await SentWorkAsync(creator, Body(name: WorkName + " पाठवलेले"));
        (await UploadAsync(creator, sent, Pdf(), "late.pdf")).Status.Should().Be(HttpStatusCode.Conflict);
        (await DoorAsync(HttpMethod.Delete, $"/creator/submissions/{heavy}", bearer: creator.Token)).Status.Should().Be(HttpStatusCode.NoContent);
        (await DoorAsync(HttpMethod.Delete, $"/creator/submissions/{draft}", bearer: creator.Token)).Status.Should().Be(HttpStatusCode.NoContent);
        (await ScalarAsync("SELECT count(*) FROM ssf.creator_files")).Should().Be("0");
        Directory.EnumerateFiles(StorageDirectory, "*", SearchOption.AllDirectories)
            .Count(f => f.Replace('\\', '/').Contains(CreatorFile.StoragePrefix, StringComparison.Ordinal)).Should().Be(0, "the bytes go with the rows");
    }

    [Fact]
    public async Task JpegLocation_Stripped()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var creator = await InvitedCreatorAsync();
        var draft = await NewDraftAsync(creator);

        // A JPEG whose EXIF block holds a GPS position, an XMP block and a comment.
        var original = CreatorDoorPictures.Jpeg(withMetadata: true);
        Encoding.Latin1.GetString(original).Should().Contain("Exif").And.Contain(CreatorDoorPictures.GpsMarker).And.Contain(CreatorDoorPictures.Comment);

        var upload = await UploadAsync(creator, draft, original, "field-photo.jpg", "image/jpeg");
        upload.Status.Should().Be(HttpStatusCode.Created, upload.Body);
        var id = upload.Json.GetProperty("id").GetGuid();

        // What the server kept and gives back: the same picture data, and nothing that says where it was taken.
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/creator/files/{id}");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", creator.Token);
        using var response = await SendRawAsync(request);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var kept = await response.Content.ReadAsByteArrayAsync();
        var text = Encoding.Latin1.GetString(kept);
        text.Should().NotContain("Exif").And.NotContain(CreatorDoorPictures.GpsMarker).And.NotContain("xmp").And.NotContain(CreatorDoorPictures.Comment);
        text.Should().Contain("JFIF", "the picture header is kept").And.Contain(CreatorDoorPictures.ScanData, "the picture itself is kept");
        kept.Should().Equal(CreatorDoorPictures.Jpeg(withMetadata: false), "exactly the picture without its metadata");
        kept.Length.Should().BeLessThan(original.Length);

        // The row describes what was KEPT (size and hash of the cleaned bytes), and the bytes on disk are those bytes.
        var hash = Convert.ToHexStringLower(SHA256.HashData(kept));
        (await ScalarAsync("SELECT content_hash || ':' || size_bytes || ':' || mime_type || ':' || state FROM ssf.creator_files WHERE id = @i", ("i", id)))
            .Should().Be($"{hash}:{kept.Length}:image/jpeg:1");
        var onDisk = Directory.EnumerateFiles(StorageDirectory, "*", SearchOption.AllDirectories).Single(f => f.Contains(id.ToString("N"), StringComparison.Ordinal));
        (await File.ReadAllBytesAsync(onDisk)).Should().Equal(kept);
        Encoding.Latin1.GetString(await File.ReadAllBytesAsync(onDisk)).Should().NotContain(CreatorDoorPictures.GpsMarker);

        // A download is a download: never run inside the page that asked.
        response.Content.Headers.ContentDisposition!.DispositionType.Should().Be("attachment");
        response.Headers.GetValues("X-Content-Type-Options").Single().Should().Be("nosniff");

        // The same for a PNG (its text, time and EXIF chunks go; its picture chunks stay).
        var png = await UploadAsync(creator, draft, CreatorDoorPictures.Png(withMetadata: true), "field.png", "image/png");
        png.Status.Should().Be(HttpStatusCode.Created, png.Body);
        var pngOnDisk = Directory.EnumerateFiles(StorageDirectory, "*", SearchOption.AllDirectories).Single(f => f.Contains(png.Json.GetProperty("id").GetGuid().ToString("N"), StringComparison.Ordinal));
        (await File.ReadAllBytesAsync(pngOnDisk)).Should().Equal(CreatorDoorPictures.Png(withMetadata: false));

        // A file that says it is a JPEG but cannot be walked as one is refused rather than kept uncleaned.
        var broken = await UploadAsync(creator, draft, [0xFF, 0xD8, 0xFF, 0xE1, 0xFF, 0xFF, 0x00, 0x01], "broken.jpg", "image/jpeg");
        broken.Status.Should().Be(HttpStatusCode.BadRequest, broken.Body);
        broken.Error.Should().Be("Creator.FileBroken");

        // Nothing read the picture for its meaning: no AI job and no document extraction was started by any upload.
        (await ScalarAsync("SELECT (SELECT count(*) FROM ssf.ai_jobs) + (SELECT count(*) FROM ssf.document_extraction_sessions)")).Should().Be("0");
    }
}

/// <summary>Tiny hand-built pictures: enough structure to be walked segment by segment; never decoded. The "GPS position" is a marker string, not a real place.</summary>
internal static class CreatorDoorPictures
{
    public const string GpsMarker = "GPS-LAT-17.0000-LON-74.0000";
    public const string Comment = "taken at the test farm gate";
    public const string ScanData = "PICTURE-SCAN-DATA-0123456789";

    private static byte[] Segment(byte marker, byte[] payload)
    {
        var segment = new byte[4 + payload.Length];
        segment[0] = 0xFF;
        segment[1] = marker;
        BinaryPrimitives.WriteUInt16BigEndian(segment.AsSpan(2), (ushort)(payload.Length + 2));
        payload.CopyTo(segment, 4);
        return segment;
    }

    public static byte[] Jpeg(bool withMetadata)
    {
        using var ms = new MemoryStream();
        ms.Write([0xFF, 0xD8]);
        ms.Write(Segment(0xE0, [.. "JFIF\0"u8, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
        if (withMetadata)
        {
            ms.Write(Segment(0xE1, [.. "Exif\0\0II*\0"u8, .. Encoding.ASCII.GetBytes(GpsMarker)]));
            ms.Write(Segment(0xE1, Encoding.ASCII.GetBytes("http://ns.adobe.com/xap/1.0/\0<xmp>" + GpsMarker + "</xmp>")));
            ms.Write(Segment(0xFE, Encoding.ASCII.GetBytes(Comment)));
        }

        ms.Write(Segment(0xDB, new byte[65]));
        ms.Write(Segment(0xC0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]));
        ms.Write(Segment(0xDA, [1, 1, 0, 0, 63, 0]));
        ms.Write(Encoding.ASCII.GetBytes(ScanData));
        ms.Write([0xFF, 0xD9]);
        return ms.ToArray();
    }

    private static byte[] Chunk(string type, byte[] data)
    {
        var chunk = new byte[12 + data.Length];
        BinaryPrimitives.WriteUInt32BigEndian(chunk, (uint)data.Length);
        Encoding.ASCII.GetBytes(type).CopyTo(chunk, 4);
        data.CopyTo(chunk, 8);
        // The checksum is not read by the walker (nothing here decodes the picture); a fixed value keeps the fixture small.
        BinaryPrimitives.WriteUInt32BigEndian(chunk.AsSpan(8 + data.Length), 0xC0FFEE00);
        return chunk;
    }

    public static byte[] Png(bool withMetadata)
    {
        using var ms = new MemoryStream();
        ms.Write([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        ms.Write(Chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]));
        if (withMetadata)
        {
            ms.Write(Chunk("tEXt", Encoding.ASCII.GetBytes("Comment\0" + Comment)));
            ms.Write(Chunk("eXIf", Encoding.ASCII.GetBytes("II*\0" + GpsMarker)));
            ms.Write(Chunk("iTXt", Encoding.ASCII.GetBytes("XML:com.adobe.xmp\0\0\0\0\0<xmp>" + GpsMarker + "</xmp>")));
            ms.Write(Chunk("tIME", [7, 0xEA, 11, 25, 10, 0, 0]));
        }

        ms.Write(Chunk("IDAT", Encoding.ASCII.GetBytes(ScanData)));
        ms.Write(Chunk("IEND", []));
        return ms.ToArray();
    }
}

[Trait("Category", "RequiresPostgres")]
public sealed class CreatorDoorTermsRealPostgresTests(ITestOutputHelper output) : CreatorDoorLane(output)
{
    protected override string TermsVersion => "2026-12";

    [Fact]
    public async Task Terms_MustBeAgreed_BeforeWorkIsSent()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var creator = await InvitedCreatorAsync();
        var profile = await DoorAsync(HttpMethod.Get, "/creator/profile", bearer: creator.Token);
        profile.Json.GetProperty("termsVersion").GetString().Should().Be("2026-12");
        profile.Json.GetProperty("termsAccepted").GetBoolean().Should().BeFalse();

        // A draft can be made, but not sent, until he agrees to the terms in force (and to that version, not another).
        var draft = await NewDraftAsync(creator);
        var early = await DoorAsync(HttpMethod.Post, $"/creator/submissions/{draft}/submit", bearer: creator.Token);
        early.Status.Should().Be(HttpStatusCode.BadRequest, early.Body);
        early.Error.Should().Be("Creator.TermsNotAccepted");
        (await DoorAsync(HttpMethod.Post, "/creator/profile/terms", new { version = "2025-01" }, bearer: creator.Token)).Error.Should().Be("Creator.TermsVersion");
        (await ScalarAsync("SELECT count(*) FROM ssf.creator_terms_acceptances")).Should().Be("0");

        var agreed = await DoorAsync(HttpMethod.Post, "/creator/profile/terms", new { version = "2026-12" }, bearer: creator.Token);
        agreed.Status.Should().Be(HttpStatusCode.OK, agreed.Body);
        agreed.Json.GetProperty("termsAccepted").GetBoolean().Should().BeTrue();
        (await DoorAsync(HttpMethod.Post, "/creator/profile/terms", new { version = "2026-12" }, bearer: creator.Token)).Status.Should().Be(HttpStatusCode.OK, "agreeing twice is one record");
        (await ScalarAsync("SELECT creator_id::text || ':' || terms_version FROM ssf.creator_terms_acceptances")).Should().Be($"{creator.Id}:2026-12");
        await SubmitAsync(creator, draft);

        // He may rename himself; nothing else of his profile is his to set.
        var renamed = await DoorAsync(HttpMethod.Put, "/creator/profile", new { displayName = "  डॉ. नवीन नाव  " }, bearer: creator.Token);
        renamed.Json.GetProperty("displayName").GetString().Should().Be("डॉ. नवीन नाव");
        (await DoorAsync(HttpMethod.Put, "/creator/profile", new { displayName = "" }, bearer: creator.Token)).Error.Should().Be("Creator.Name");
        (await AppWriteAsync(new Scope(Creator: creator.Id), "UPDATE ssf.creator_profiles SET status = 3, phone = NULL")).SqlState.Should().Be("42501", "he cannot mark himself erased or anything but invited or active");
    }
}

[Trait("Category", "RequiresPostgres")]
public sealed class CreatorDoorSubmissionRealPostgresTests(ITestOutputHelper output) : CreatorDoorLane(output)
{
    private Task<string> LibraryRowsAsync() => ScalarAsync("SELECT count(*) FROM ssf.schedule_templates WHERE name = @n", ("n", WorkName));

    [Fact]
    public async Task Submission_NotInLibrary_UntilApproved()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var creator = await InvitedCreatorAsync();
        var before = await ScalarAsync("SELECT count(*) FROM ssf.schedule_templates");

        // A draft, then sent: still not a library row of any kind, for anyone.
        var draft = await NewDraftAsync(creator);
        (await LibraryRowsAsync()).Should().Be("0");
        await SubmitAsync(creator, draft);
        (await ScalarAsync("SELECT count(*) FROM ssf.schedule_templates")).Should().Be(before, "a sent round lives in the creator tables only");
        (await ScalarAsync("SELECT (SELECT count(*) FROM ssf.schedule_tasks) + (SELECT count(*) FROM ssf.schedule_checks)")).Should().Be("0");
        (await LibraryAsync(Owner)).Should().NotContain(row => row.GetProperty("name").GetString() == WorkName, "a farmer sees nothing");
        (await ReviewLibraryAsync()).Should().NotContain(row => row.GetProperty("name").GetString() == WorkName, "there is no unchecked library row to list, clone or adopt");
        var (waiting, waitingBody) = await SendJsonAsync(HttpMethod.Get, "/shramsafal/schedule-templates/checks/waiting", PlatformOwner, null);
        waiting.Should().Be(HttpStatusCode.OK, waitingBody);
        waitingBody.Should().NotContain(WorkName);

        // Staff see it where creators' work waits.
        var (queue, queueBody) = await SendJsonAsync(HttpMethod.Get, "/shramsafal/creator-door/submissions", PlatformAnalyst, null);
        queue.Should().Be(HttpStatusCode.OK, queueBody);
        Json(queueBody).EnumerateArray().Should().ContainSingle(s => s.GetProperty("id").GetGuid() == draft && s.GetProperty("state").GetString() == "Submitted");

        // The approval must be slice 7's: every key ticked, on the hash seen. A missing key, or a hash of other content, makes NO library row.
        var view = await StaffViewAsync(draft);
        var keys = view.GetProperty("tasks").EnumerateArray().Select(t => t.GetProperty("taskKey").GetString()!).ToArray();
        var hash = view.GetProperty("contentHash").GetString()!;
        keys.Should().BeEquivalentTo(["t-prune", "t-spray", "t-water"]);
        async Task<(HttpStatusCode, string)> Approve(string[] ticked, string onHash, Guid by) => await SendJsonAsync(
            HttpMethod.Post, $"/shramsafal/creator-door/submissions/{draft}/approve", by,
            new { checkedTaskKeys = ticked, checkedChallengeKeys = Array.Empty<string>(), contentHash = onHash, checkerDisplayName = DisplayName });
        (await Approve(keys[..2], hash, PlatformEmployee)).Item1.Should().Be(HttpStatusCode.BadRequest, "one task was not ticked");
        (await Approve(keys, new string('0', 64), PlatformEmployee)).Item1.Should().Be(HttpStatusCode.BadRequest, "the ticks were made on other content");
        (await Approve(keys, hash, PlatformAnalyst)).Item1.Should().Be(HttpStatusCode.Forbidden, "the analyst reads, never approves");
        (await Approve(keys, hash, Owner)).Item1.Should().Be(HttpStatusCode.Forbidden, "a farm owner holds nothing here");
        (await LibraryRowsAsync()).Should().Be("0");
        (await ScalarAsync("SELECT state FROM ssf.creator_submissions WHERE id = @i", ("i", draft))).Should().Be("1");

        // Approved by a staff checker: now, and only now, the library row exists - made by the importer, its maker the creator, already checked by someone else.
        var (ok, okBody) = await Approve(keys, hash, PlatformEmployee);
        ok.Should().Be(HttpStatusCode.OK, okBody);
        var template = Json(okBody).GetProperty("libraryScheduleId").GetGuid();
        (await ScalarAsync(
            "SELECT created_by_user_id::text || ':' || tenant_scope || ':' || (SELECT count(*) FROM ssf.schedule_tasks k WHERE k.schedule_template_id = t.\"Id\") FROM ssf.schedule_templates t WHERE t.\"Id\" = @t",
            ("t", template))).Should().Be($"{creator.Id}:3:3");
        (await ScalarAsync("SELECT decision || ':' || checker_user_id::text || ':' || content_hash FROM ssf.schedule_checks WHERE schedule_template_id = @t", ("t", template)))
            .Should().Be($"Approved:{PlatformEmployee}:{hash}");
        (await ScalarAsync("SELECT state::text || ':' || library_template_id::text FROM ssf.creator_submissions WHERE id = @i", ("i", draft))).Should().Be($"3:{template}");
        var row = (await LibraryAsync(Owner)).Single(r => r.GetProperty("id").GetGuid() == template);
        row.GetProperty("name").GetString().Should().Be(WorkName);

        // Deciding twice is refused; a decided round is no longer waiting.
        (await Approve(keys, hash, PlatformEmployee)).Item1.Should().Be(HttpStatusCode.Conflict);
        (await ReturnAsync(draft, "late")).Status.Should().Be(HttpStatusCode.Conflict);
        (await LibraryRowsAsync()).Should().Be("1");
    }

    [Fact]
    public async Task Creator_CannotApproveOwn()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var creator = await InvitedCreatorAsync();
        var sent = await SentWorkAsync(creator);
        var view = await StaffViewAsync(sent);
        var ticks = new
        {
            checkedTaskKeys = view.GetProperty("tasks").EnumerateArray().Select(t => t.GetProperty("taskKey").GetString()!).ToArray(),
            checkedChallengeKeys = Array.Empty<string>(),
            contentHash = view.GetProperty("contentHash").GetString(),
            checkerDisplayName = "मीच",
            decision = "Approved",
        };

        // 1. No creator route approves, checks, returns or publishes anything (read from the host's own routes).
        var creatorRoutes = HostServices.GetServices<EndpointDataSource>().SelectMany(s => s.Endpoints).OfType<RouteEndpoint>()
            .Select(e => e.RoutePattern.RawText ?? string.Empty).Where(p => p.StartsWith("/creator", StringComparison.OrdinalIgnoreCase)).ToList();
        creatorRoutes.Should().NotBeEmpty();
        creatorRoutes.Should().NotContain(p => p.Contains("approve") || p.Contains("check") || p.Contains("return") || p.Contains("publish") || p.Contains("decision"));

        // 2. His token opens no staff route: the approval of his own round, the library check, the import.
        foreach (var (method, path) in new[]
                 {
                     (HttpMethod.Post, $"/shramsafal/creator-door/submissions/{sent}/approve"),
                     (HttpMethod.Post, $"/shramsafal/creator-door/submissions/{sent}/return"),
                     (HttpMethod.Get, $"/shramsafal/creator-door/submissions/{sent}"),
                     (HttpMethod.Post, $"/shramsafal/schedule-templates/{sent}/check"),
                     (HttpMethod.Post, "/shramsafal/schedule-templates/import/format-2"),
                     (HttpMethod.Post, $"/shramsafal/schedule-templates/{sent}/publish"),
                 })
        {
            (await DoorAsync(method, path, method == HttpMethod.Get ? null : ticks, bearer: creator.Token)).Status.Should().Be(HttpStatusCode.Unauthorized, $"{method} {path}");
        }

        // 3. The database refuses him too, whatever the application did: as the app role under HIS scope he can neither mark his round approved, nor write a decision, nor
        //    change a round he sent; and the round stays as it was.
        var his = new Scope(Creator: creator.Id);
        (await AppWriteAsync(his, $"UPDATE ssf.creator_submissions SET state = 3, library_template_id = gen_random_uuid(), decided_at_utc = now() WHERE id = '{sent}'"))
            .Rows.Should().Be(0, "a sent round is not his to change");
        var draft = await NewDraftAsync(creator, Body(name: WorkName + " २"));
        (await AppWriteAsync(his, $"UPDATE ssf.creator_submissions SET state = 3, library_template_id = gen_random_uuid(), submitted_at_utc = now(), expires_at_utc = NULL WHERE id = '{draft}'"))
            .SqlState.Should().Be("42501", "a draft can go to sent, never to approved");
        (await AppWriteAsync(his, $"UPDATE ssf.creator_submissions SET state = 2, submitted_at_utc = now(), expires_at_utc = NULL WHERE id = '{draft}'")).SqlState.Should().Be("42501");
        (await AppWriteAsync(his, $"""
            INSERT INTO ssf.creator_submission_decisions (id, submission_id, creator_id, decision, decided_by_user_id, decided_at_utc, library_template_id)
            VALUES (gen_random_uuid(), '{sent}', '{creator.Id}', 1, '{creator.Id}', now(), gen_random_uuid())
            """)).SqlState.Should().Be("42501", "no creator writes a decision");
        (await ScalarAsync("SELECT string_agg(state::text, ',' ORDER BY title) FROM ssf.creator_submissions")).Should().Be("1,0");
        (await ScalarAsync("SELECT (SELECT count(*) FROM ssf.creator_submission_decisions) + (SELECT count(*) FROM ssf.schedule_templates WHERE created_by_user_id = @c)", ("c", creator.Id)))
            .Should().Be("0");

        // 4. Once a staff checker approved it, the maker of the row is the creator, and the check rule itself would refuse the maker as checker.
        var template = await ApproveAsync(sent);
        await using var db = NewSuperuserContext();
        var row = (await new ShramSafal.Infrastructure.Persistence.Repositories.ShramSafalRepository(db).GetScheduleTemplateWithTasksByIdAsync(template))!;
        row.CreatedByUserId!.Value.Value.Should().Be(creator.Id);
        ScheduleCheck.Approve(
            row, new ScheduleCheckTicks([], row.Tasks.Select(t => t.TaskKey).ToList(), [], row.TaskFormatHash()), new UserId(creator.Id), "मीच", DateTime.UtcNow, out var problem)
            .Should().BeNull("a maker never approves his own version");
        problem!.Message.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Return_WithReasons_HistoryKept()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var creator = await InvitedCreatorAsync();
        var first = await SentWorkAsync(creator);

        // A return needs its reasons in words.
        (await ReturnAsync(first, "  ")).Status.Should().Be(HttpStatusCode.BadRequest);
        (await ScalarAsync("SELECT state FROM ssf.creator_submissions WHERE id = @i", ("i", first))).Should().Be("1");
        const string reasons = "फवारणीचे प्रमाण पुस्तिकेशी जुळत नाही; पान १२ पहा.";
        var (status, body) = await ReturnAsync(first, reasons);
        status.Should().Be(HttpStatusCode.OK, body);
        var second = Json(body).GetProperty("newDraftId").GetGuid();
        Json(body).GetProperty("newRound").GetInt32().Should().Be(2);

        // The creator sees the returned round with its reasons, and a new draft holding the same work.
        var list = (await DoorAsync(HttpMethod.Get, "/creator/submissions", bearer: creator.Token)).Json.EnumerateArray().ToList();
        list.Should().HaveCount(2);
        var returned = list.Single(s => s.GetProperty("id").GetGuid() == first);
        returned.GetProperty("state").GetString().Should().Be("Returned");
        returned.GetProperty("decisions")[0].GetProperty("reasons").GetString().Should().Be(reasons);
        var opened = list.Single(s => s.GetProperty("id").GetGuid() == second);
        opened.GetProperty("state").GetString().Should().Be("Draft");
        opened.GetProperty("round").GetInt32().Should().Be(2);
        opened.GetProperty("workId").GetGuid().Should().Be(returned.GetProperty("workId").GetGuid());

        // The returned round is history: it cannot be changed, sent again or removed.
        (await DoorAsync(HttpMethod.Put, $"/creator/submissions/{first}", Body(dose: DoseTwo), bearer: creator.Token)).Status.Should().Be(HttpStatusCode.Conflict);
        (await DoorAsync(HttpMethod.Post, $"/creator/submissions/{first}/submit", bearer: creator.Token)).Status.Should().Be(HttpStatusCode.Conflict);
        (await DoorAsync(HttpMethod.Delete, $"/creator/submissions/{first}", bearer: creator.Token)).Status.Should().Be(HttpStatusCode.Conflict);

        // He changes the new draft and sends it; staff see both rounds, the first with what was said about it.
        var changed = await DoorAsync(HttpMethod.Put, $"/creator/submissions/{second}", Body(dose: DoseTwo), bearer: creator.Token);
        changed.Status.Should().Be(HttpStatusCode.OK, changed.Body);
        await SubmitAsync(creator, second);
        var view = await StaffViewAsync(second);
        var rounds = view.GetProperty("rounds").EnumerateArray().ToList();
        rounds.Select(r => r.GetProperty("round").GetInt32()).Should().Equal(1, 2);
        rounds[0].GetProperty("decisions")[0].GetProperty("reasons").GetString().Should().Be(reasons);
        view.GetProperty("body").GetRawText().Should().Contain(DoseTwo);
        var firstBody = (await DoorAsync(HttpMethod.Get, $"/creator/submissions/{first}", bearer: creator.Token)).Json.GetProperty("body").GetRawText();
        firstBody.Should().Contain(DoseOne).And.NotContain(DoseTwo, "what was sent first is kept as it was sent");

        // What is really kept: both rounds, the one decision, and nobody (app role, any scope) can rewrite or remove a decision.
        (await ScalarAsync("SELECT string_agg(round::text || ':' || state::text, ',' ORDER BY round) FROM ssf.creator_submissions")).Should().Be("1:2,2:1");
        (await ScalarAsync("SELECT decision::text || ':' || reasons || ':' || decided_by_user_id::text FROM ssf.creator_submission_decisions")).Should().Be($"0:{reasons}:{PlatformEmployee}");
        foreach (var scope in new[] { new Scope(User: PlatformOwner), new Scope(Creator: creator.Id) })
        {
            (await AppWriteAsync(scope, "UPDATE ssf.creator_submission_decisions SET reasons = 'changed'")).SqlState.Should().Be("42501");
            (await AppWriteAsync(scope, "DELETE FROM ssf.creator_submission_decisions")).SqlState.Should().Be("42501");
        }

        // A body the importer refuses is refused with its words, and nothing is saved.
        var bad = await DoorAsync(HttpMethod.Post, "/creator/submissions", Body().Replace("\"format\":2", "\"format\":1"), bearer: creator.Token);
        bad.Status.Should().Be(HttpStatusCode.BadRequest, bad.Body);
        bad.Error.Should().Be("ShramSafal.ScheduleImportFormat");
        var extra = await DoorAsync(HttpMethod.Post, "/creator/submissions", Body().Replace("\"format\":2", "\"format\":2,\"approved\":true"), bearer: creator.Token);
        extra.Error.Should().Be("Creator.BodyShape");
        var system = await DoorAsync(HttpMethod.Post, "/creator/submissions", Body(ownerType: "SYSTEM_DEFAULT"), bearer: creator.Token);
        system.Error.Should().Be("Creator.OwnerType");
        var next = await DoorAsync(HttpMethod.Post, "/creator/submissions", Body(previousVersionId: Guid.NewGuid()), bearer: creator.Token);
        next.Error.Should().Be("Creator.PreviousVersion");
        (await ScalarAsync("SELECT count(*) FROM ssf.creator_submissions")).Should().Be("2");
    }

    [Fact]
    public async Task EndToEnd_InviteSubmitReturnApprove_FarmerFollows()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Invited by staff; signs in at his own door; names himself.
        var creator = await InvitedCreatorAsync(PhoneA, "डॉ. चाचणी तज्ज्ञ");
        var profile = await DoorAsync(HttpMethod.Get, "/creator/profile", bearer: creator.Token);
        profile.Status.Should().Be(HttpStatusCode.OK, profile.Body);
        profile.Json.GetProperty("displayName").GetString().Should().Be("डॉ. चाचणी तज्ज्ञ");
        profile.Json.GetProperty("phoneEnding").GetString().Should().Be("5001");

        // Makes a draft, attaches the source, sends it.
        var draft = await NewDraftAsync(creator);
        (await UploadAsync(creator, draft, Pdf(), "source.pdf")).Status.Should().Be(HttpStatusCode.Created);
        await SubmitAsync(creator, draft);

        // Staff read it (with its file), and return it with reasons.
        var firstView = await StaffViewAsync(draft);
        firstView.GetProperty("files").GetArrayLength().Should().Be(1);
        var fileId = firstView.GetProperty("files")[0].GetProperty("id").GetGuid();
        using (var staffFile = await SendAsync(HttpMethod.Get, $"/shramsafal/creator-door/files/{fileId}", PlatformEmployee))
        {
            staffFile.StatusCode.Should().Be(HttpStatusCode.OK);
            (await staffFile.Content.ReadAsByteArrayAsync()).Should().Equal(Pdf());
        }

        var (returned, returnedBody) = await ReturnAsync(draft, "प्रमाण पुन्हा तपासा.");
        returned.Should().Be(HttpStatusCode.OK, returnedBody);
        var second = Json(returnedBody).GetProperty("newDraftId").GetGuid();

        // He corrects the new draft and sends it; another staff member approves it, ticking every work on the content shown.
        (await DoorAsync(HttpMethod.Put, $"/creator/submissions/{second}", Body(dose: DoseTwo), bearer: creator.Token)).Status.Should().Be(HttpStatusCode.OK);
        await SubmitAsync(creator, second);
        var template = await ApproveAsync(second, PlatformEmployee);

        // A farmer finds it in the library as a checked schedule, follows it on his plot, and his phone's pull carries it.
        var row = (await LibraryAsync(Owner)).Single(r => r.GetProperty("id").GetGuid() == template);
        row.GetProperty("name").GetString().Should().Be(WorkName);
        row.GetRawText().Should().Contain("Checked", "the farmer is shown a schedule ShramSafal has checked");
        var (plot, cycle) = await SeedSeasonStartingAsync("grape", TodayIst().AddDays(-10));
        var subscription = await PushAdoptAsync(Owner, plot, cycle, template);
        (await ScalarAsync("SELECT schedule_template_id::text || ':' || state FROM ssf.schedule_subscriptions WHERE id = @s", ("s", subscription)))
            .Should().Be($"{template}:0", "the plot follows the creator's approved schedule");
        var (pullBody, pull) = await PullAsync(Owner);
        var followed = ArrayOf(pull, "scheduleSubscriptions").Single(s => s.GetProperty("id").GetGuid() == subscription);
        followed.GetProperty("scheduleTemplateId").GetGuid().Should().Be(template, "his phone's pull carries the creator's schedule as the one this plot follows");
        followed.GetProperty("state").GetString().Should().Be("Active");
        followed.GetProperty("checkState").GetString().Should().Be("Checked");
        pullBody.Should().NotContain(DoseOne, "the returned round never reached a farmer");

        // The works he reads are the corrected ones (the approved round), never the returned round's.
        var (tasksStatus, tasksBody) = await SendJsonAsync(HttpMethod.Get, $"/shramsafal/reference/schedule-templates/{template}/tasks?scheduleFormat=2", Owner, null);
        tasksStatus.Should().Be(HttpStatusCode.OK, tasksBody);
        tasksBody.Should().Contain(DoseTwo).And.Contain("t-spray").And.NotContain(DoseOne);

        // The creator sees his round approved and its totals (counts only; with one farmer, every number is hidden).
        var mine = (await DoorAsync(HttpMethod.Get, "/creator/submissions", bearer: creator.Token)).Json.EnumerateArray().ToList();
        mine.Single(s => s.GetProperty("id").GetGuid() == second).GetProperty("state").GetString().Should().Be("Approved");
        mine.Single(s => s.GetProperty("id").GetGuid() == second).GetProperty("libraryScheduleId").GetGuid().Should().Be(template);
        var totals = await DoorAsync(HttpMethod.Get, $"/creator/submissions/{second}/totals", bearer: creator.Token);
        totals.Status.Should().Be(HttpStatusCode.OK, totals.Body);
        totals.Json.GetProperty("scheduleId").GetGuid().Should().Be(template);
        totals.Json.GetProperty("kind").GetString().Should().Be("totals");
        totals.Json.GetProperty("following").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null, "one farmer is under the threshold of five: no number");
        totals.Body.Should().NotContain(Owner.ToString()).And.NotContain(FarmA.ToString()).And.NotContain(plot.ToString());
        (await DoorAsync(HttpMethod.Get, $"/creator/submissions/{draft}/totals", bearer: creator.Token)).Error.Should().Be("Creator.NotApproved");
    }

    [Fact]
    public async Task Creator_CannotReach_Farm_Admin_OtherCreator()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await InvitedCreatorAsync(PhoneA, "निर्माता अ");
        var b = await InvitedCreatorAsync(PhoneB, "निर्माता ब");
        var hisDraft = await NewDraftAsync(b, Body(name: "ब चे काम"));
        var hisSent = await SentWorkAsync(b, Body(name: "ब चे पाठवलेले काम"));
        var hisFile = (await UploadAsync(b, hisDraft, Pdf(), "b.pdf")).Json.GetProperty("id").GetGuid();
        var hisApproved = await SentWorkAsync(b, Body(name: "ब चे मंजूर काम"));
        await ApproveAsync(hisApproved);
        var own = await NewDraftAsync(a, Body(name: "अ चे काम"));

        // Another creator's work is not there for him: read, change, send, remove, its files, its totals.
        foreach (var (method, path) in new[]
                 {
                     (HttpMethod.Get, $"/creator/submissions/{hisDraft}"),
                     (HttpMethod.Get, $"/creator/submissions/{hisSent}"),
                     (HttpMethod.Put, $"/creator/submissions/{hisDraft}"),
                     (HttpMethod.Delete, $"/creator/submissions/{hisDraft}"),
                     (HttpMethod.Post, $"/creator/submissions/{hisDraft}/submit"),
                     (HttpMethod.Get, $"/creator/submissions/{hisDraft}/files"),
                     (HttpMethod.Get, $"/creator/files/{hisFile}"),
                     (HttpMethod.Delete, $"/creator/files/{hisFile}"),
                     (HttpMethod.Get, $"/creator/submissions/{hisApproved}/totals"),
                 })
        {
            var reply = await DoorAsync(method, path, method == HttpMethod.Put ? Body(name: "चोरलेले") : null, bearer: a.Token);
            reply.Status.Should().Be(HttpStatusCode.NotFound, $"{method} {path} as the other creator");
        }

        (await UploadAsync(a, hisDraft, Pdf(), "planted.pdf")).Status.Should().Be(HttpStatusCode.NotFound);
        var mine = (await DoorAsync(HttpMethod.Get, "/creator/submissions", bearer: a.Token)).Json.EnumerateArray().ToList();
        mine.Should().ContainSingle().Which.GetProperty("id").GetGuid().Should().Be(own);
        (await ScalarAsync("SELECT count(*) FROM ssf.creator_submissions WHERE creator_id = @b", ("b", b.Id))).Should().Be("3", "nothing of his was changed or removed");
        (await ScalarAsync("SELECT count(*) FROM ssf.creator_files WHERE creator_id = @b AND state = 1", ("b", b.Id))).Should().Be("1");

        // His token opens no farm, sync, AI, admin, library-writing or staff route. (In this host the farmer side uses the lane's test sign-in; the proof with the production
        // token wiring on both sides, over every route of the host, is CreatorDoorCrossedTokensRealPostgresTests.)
        foreach (var path in new[]
                 {
                     "/shramsafal/farms/mine", $"/shramsafal/farms/{FarmA}", "/sync/pull", "/shramsafal/reference/schedule-templates",
                     "/shramsafal/admin/ops/health", "/shramsafal/ai/config", "/shramsafal/creator-door/creators", "/shramsafal/creator-door/submissions",
                     "/shramsafal/schedule-templates/checks/waiting", $"/shramsafal/schedule-templates/{hisApproved}/totals",
                 })
        {
            (await DoorAsync(HttpMethod.Get, path, bearer: a.Token)).Status.Should().Be(HttpStatusCode.Unauthorized, $"GET {path} with a creator token");
        }

        // And a farmer or staff sign-in opens nothing at the creator door.
        foreach (var user in new[] { Owner, PlatformOwner })
        {
            var (status, _) = await SendJsonAsync(HttpMethod.Get, "/creator/submissions", user, null);
            status.Should().Be(HttpStatusCode.Unauthorized, "the creator door takes only a creator token");
        }

        // Revoked by staff: his very next request is refused, though his token has not expired; so is his refresh.
        var (revoke, revokeBody) = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/creator-door/creators/{a.Id}/revoke", PlatformOwner, null);
        revoke.Should().Be(HttpStatusCode.OK, revokeBody);
        (await DoorAsync(HttpMethod.Get, "/creator/submissions", bearer: a.Token)).Status.Should().Be(HttpStatusCode.Unauthorized);
        (await DoorAsync(HttpMethod.Post, "/creator/auth/refresh", cookie: a.Cookie, deviceId: a.DeviceId)).Status.Should().Be(HttpStatusCode.Unauthorized);
        (await DoorAsync(HttpMethod.Get, "/creator/submissions", bearer: b.Token)).Status.Should().Be(HttpStatusCode.OK, "the other creator is untouched");
    }
}

using System.Text.Json;
using System.Text.Json.Nodes;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Domain.Inputs;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.InputLibrary;

namespace AgriSync.Bootstrapper.Infrastructure;

/// <summary>
/// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Task 3; founder D-108 3) - the intake of a new input-library
/// source, run by a human exactly like <c>--reseed-purvesh-demo</c>: a console command on this binary, not an HTTP route (there
/// is no public write route to secure; the app role is denied writes by row-level security).
/// <code>
///   dotnet AgriSync.Bootstrapper.dll --input-library-intake status
///   dotnet AgriSync.Bootstrapper.dll --input-library-intake load    &lt;source-file.json&gt; [--dry-run]
///   dotnet AgriSync.Bootstrapper.dll --input-library-intake decide  &lt;conflict-id&gt; real_difference|error &lt;your name&gt; [--dry-run]
///   dotnet AgriSync.Bootstrapper.dll --input-library-intake publish [--dry-run]
///   dotnet AgriSync.Bootstrapper.dll --input-library-intake discard [--dry-run]
/// </code>
/// </summary>
/// <remarks>
/// <para><b>The flow.</b> <c>load</c> reads a prepared source file (<c>{ "source": {...}, "products": [...] }</c>, products in the
/// library shape) as a DRAFT and checks it against the library: every field where it differs from a product already in becomes
/// an open conflict. A draft is invisible to every farm. <c>decide</c> settles each conflict: <c>real_difference</c> keeps BOTH
/// values (a farmer sees both uses), <c>error</c> drops the incoming one. <c>publish</c> is refused while any conflict is open;
/// when it goes through it bumps the published version, and phones download the new copy on their next poll.
/// <c>discard</c> throws the draft away. Reading a company PDF is not done here: a source arrives as a prepared file.</para>
/// <para><b>The file rule: silence is not a statement.</b> A key the file does NOT carry for a product is not compared at all (a
/// file that leaves out <c>stages</c> opens no <c>stages</c> conflict). A key it DOES carry, even as <c>[]</c> or <c>null</c>, IS a
/// statement and conflicts with every matched product that holds other values for it. So prepare a file that carries only what
/// its source states. <c>load</c> prints which keys it did not compare. A product key the library does not know (a typo, a
/// sentence of the source's prose) refuses the whole file. <c>publish</c> builds the exact library it would make live and refuses
/// it, changing nothing, if the server's or the phone's reader would refuse it.</para>
/// <para><b>Which database role writes.</b> It opens the ADMIN context (<see cref="IAdminDbContextFactory{TContext}"/>, the
/// migration connection <c>ConnectionStrings:ShramSafalDb_Migration</c>), never the app role: the library tables deny
/// <c>agrisync_app</c> every write. That role must be able to write past row-level security (a superuser or <c>BYPASSRLS</c>); the
/// command checks first and REFUSES, writing nothing, when it cannot. It applies no migration and starts no hosted service.</para>
/// <para><b>Exit codes:</b> 0 = done (or a dry run done); 2 = refused (a precondition, a malformed file, an open conflict), nothing
/// written; 1 = failed and rolled back.</para>
/// </remarks>
public static class InputLibraryIntakeCommand
{
    public const string Flag = "--input-library-intake";
    public const string DryRunFlag = "--dry-run";

    public const int ExitOk = 0;
    public const int ExitFailed = 1;
    public const int ExitRefused = 2;

    public static async Task<int> RunAsync(
        IServiceProvider services,
        IReadOnlyCollection<string> args,
        TextWriter output,
        DateTime utcNow,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(args);
        ArgumentNullException.ThrowIfNull(output);

        var dryRun = args.Contains(DryRunFlag, StringComparer.Ordinal);
        var words = args.SkipWhile(a => a != Flag).Skip(1).Where(a => a != DryRunFlag).ToList();
        var verb = words.Count > 0 ? words[0] : "status";
        var rest = words.Skip(1).ToList();
        var writes = verb is "load" or "decide" or "publish" or "discard";

        await output.WriteLineAsync($"{Flag} {verb}: {(writes && dryRun ? "DRY RUN - every change will be rolled back" : writes ? "COMMIT" : "read only")}. No migration, no hosted service.");

        try
        {
            await using var scope = services.CreateAsyncScope();
            var factory = scope.ServiceProvider.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
            await using var db = await factory.CreateAsync($"{Flag} {verb}", SystemActor.Worker, cancellationToken);

            if (writes && !await CanWriteAsync(db, cancellationToken))
            {
                throw new InputLibraryIntakeException(
                    "This connection cannot write the library tables: row-level security denies the app role every write, and this role is "
                    + "neither a superuser nor BYPASSRLS. Run the command with ConnectionStrings:ShramSafalDb_Migration (environment variable "
                    + "ConnectionStrings__ShramSafalDb_Migration) set to the role that owns the tables and can bypass row-level security.");
            }

            var workspace = await InputLibraryRows.LoadAllAsync(db, cancellationToken)
                ?? throw new InputLibraryIntakeException("The input library has no rows in this database: the migration AddInputLibrary has not run.");

            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            var changed = await ExecuteAsync(verb, rest, workspace, output, utcNow, cancellationToken);
            if (changed)
            {
                await InputLibraryRows.SaveAsync(db, workspace, cancellationToken);
            }

            if (dryRun)
            {
                await transaction.RollbackAsync(cancellationToken);
                await output.WriteLineAsync($"{Flag} {verb}: dry run complete - rolled back, the database is unchanged.");
            }
            else
            {
                await transaction.CommitAsync(cancellationToken);
                await output.WriteLineAsync($"{Flag} {verb}: {(changed ? "committed." : "nothing to write.")}");
            }

            return ExitOk;
        }
        catch (InputLibraryIntakeException refused)
        {
            await output.WriteLineAsync($"{Flag} {verb}: REFUSED - {refused.Message}");
            return ExitRefused;
        }
        catch (Exception ex)
        {
            await output.WriteLineAsync($"{Flag} {verb}: FAILED and rolled back - {ex.GetType().Name}: {ex.Message}");
            if (ex.InnerException is { } inner)
            {
                await output.WriteLineAsync($"  caused by {inner.GetType().Name}: {inner.Message}");
            }

            return ExitFailed;
        }
    }

    /// <summary>Runs one verb against the loaded library. True when it changed the library (so it must be saved).</summary>
    private static async Task<bool> ExecuteAsync(
        string verb, List<string> rest, InputLibraryWorkspace workspace, TextWriter output, DateTime utcNow, CancellationToken ct)
    {
        switch (verb)
        {
            case "status":
                await WriteStatusAsync(workspace, output);
                return false;

            case "load":
                {
                    var path = rest.Count == 1 ? rest[0] : throw new InputLibraryIntakeException("Usage: load <source-file.json>");
                    if (!File.Exists(path))
                    {
                        throw new InputLibraryIntakeException($"File not found: {path}");
                    }

                    JsonNode file;
                    try
                    {
                        file = JsonNode.Parse(await File.ReadAllTextAsync(path, ct)) ?? throw new InputLibraryIntakeException("The file is empty.");
                    }
                    catch (JsonException ex)
                    {
                        throw new InputLibraryIntakeException("The file is not valid JSON: " + ex.Message);
                    }

                    var report = InputLibraryIntake.Load(workspace, file);
                    await output.WriteLineAsync($"Loaded source '{report.SourceId}' as a DRAFT: {report.ProductsInFile} product(s) in the file, "
                        + $"{report.MatchedToExisting} matched to the library, {report.NewDraftProducts} new, {report.Conflicts.Count} conflict(s). "
                        + "Nothing of it is visible to a farm.");
                    foreach (var note in report.Notes)
                    {
                        await output.WriteLineAsync("  note: " + note);
                    }

                    // The rule, and what it meant for this file: a key not carried was NOT compared; a key carried (even [] or null) was.
                    await output.WriteLineAsync("  Rule: a key the file does not carry is silence and was not compared; a key it carries, even [] or null, is a "
                        + "statement and conflicts with every matched product that has values for it.");
                    if (report.NotCompared.Count > 0)
                    {
                        await output.WriteLineAsync($"  Not compared (the file did not carry the key), out of {report.MatchedToExisting} matched product(s):");
                        foreach (var (key, count) in report.NotCompared.OrderBy(k => k.Key, StringComparer.Ordinal))
                        {
                            await output.WriteLineAsync($"    {key}: {count} product(s)");
                        }
                    }
                    else if (report.MatchedToExisting > 0)
                    {
                        await output.WriteLineAsync("  Every compared key was carried by every matched product.");
                    }

                    await WriteConflictsAsync(report.Conflicts, output);
                    await output.WriteLineAsync(report.Conflicts.Count == 0
                        ? "No conflicts: run 'publish' when you are satisfied."
                        : "Next: settle each conflict with 'decide <id> real_difference|error <your name>', then 'publish'.");
                    return true;
                }

            case "decide":
                {
                    if (rest.Count < 3 || !Guid.TryParse(rest[0], out var id))
                    {
                        throw new InputLibraryIntakeException("Usage: decide <conflict-id> real_difference|error <your name>");
                    }

                    var decision = rest[1].Replace('-', '_');
                    var conflict = InputLibraryIntake.Decide(workspace, id, decision, string.Join(' ', rest.Skip(2)), utcNow);
                    await output.WriteLineAsync($"Conflict {conflict.Id} ({conflict.ProductId}, {conflict.Field}) settled as {conflict.Status} by {conflict.DecidedBy}.");
                    return true;
                }

            case "publish":
                {
                    var outcome = InputLibraryIntake.Publish(workspace);
                    await output.WriteLineAsync(outcome.Message);
                    if (!outcome.Published)
                    {
                        await WriteConflictsAsync(workspace.Conflicts.Where(c => c.Status == InputLibraryConflictStatus.Open).ToList(), output);
                        throw new InputLibraryIntakeException(outcome.Message);
                    }

                    return true;
                }

            case "discard":
                {
                    var source = workspace.DraftSource?.Id;
                    var gone = InputLibraryIntake.Discard(workspace);
                    await output.WriteLineAsync($"Discarded draft source '{source}' ({gone} draft row(s)); the published library is untouched.");
                    return true;
                }

            default:
                throw new InputLibraryIntakeException($"Unknown verb '{verb}'. Use status, load, decide, publish or discard.");
        }
    }

    private static async Task WriteStatusAsync(InputLibraryWorkspace workspace, TextWriter output)
    {
        var published = workspace.Sources.Count(s => s.Status == InputLibraryStatus.Published);
        await output.WriteLineAsync($"Published library: version {workspace.PublishedVersion}, {published} source(s), "
            + $"{workspace.Products.Count(p => p.Status == InputLibraryStatus.Published)} product(s).");
        if (workspace.DraftSource is not { } draft)
        {
            await output.WriteLineAsync("No draft waiting.");
            return;
        }

        var mine = workspace.Conflicts.Where(c => c.IncomingSourceId == draft.Id).ToList();
        await output.WriteLineAsync($"Draft source '{draft.Id}' ({draft.Kind}, received {draft.ReceivedOn:yyyy-MM-dd}): "
            + $"{workspace.Products.Count(p => p.Status == InputLibraryStatus.Draft)} new draft product(s), "
            + $"{mine.Count(c => c.Status == InputLibraryConflictStatus.Open)} open, "
            + $"{mine.Count(c => c.Status == InputLibraryConflictStatus.RealDifference)} real difference, "
            + $"{mine.Count(c => c.Status == InputLibraryConflictStatus.Error)} error.");
        await WriteConflictsAsync(mine, output);
    }

    private static async Task WriteConflictsAsync(IReadOnlyList<InputLibraryConflict> conflicts, TextWriter output)
    {
        foreach (var c in conflicts)
        {
            await output.WriteLineAsync($"  {c.Id}  [{c.Status}]  {c.ProductId}  {c.Field}");
            await output.WriteLineAsync($"      library : {c.ExistingValue}");
            await output.WriteLineAsync($"      incoming: {c.IncomingValue}  ({c.IncomingSourceId}, {c.IncomingRef})");
            if (c.DecidedBy is not null)
            {
                await output.WriteLineAsync($"      decided by {c.DecidedBy} on {c.DecidedOn:yyyy-MM-dd}");
            }
        }
    }

    /// <summary>Whether the connection's role can write past row-level security (superuser or BYPASSRLS).</summary>
    private static async Task<bool> CanWriteAsync(ShramSafalDbContext db, CancellationToken ct) =>
        (await db.Database
            .SqlQueryRaw<bool>("SELECT (rolsuper OR rolbypassrls) AS \"Value\" FROM pg_roles WHERE rolname = current_user")
            .ToListAsync(ct))
        .FirstOrDefault();
}

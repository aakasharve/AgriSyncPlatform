// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S2) - load the government village list into its tables, once per version.
using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;

namespace User.Infrastructure.Places;

/// <summary>
/// Loads one version of <see cref="LgdPlaceList"/> into <c>public.lgd_districts</c>, <c>lgd_talukas</c>, <c>lgd_villages</c> and records it in
/// <c>lgd_list_versions</c>. The migration <c>AddLgdPlaceList</c> runs these same statements (as the migration role, inside its transaction),
/// and the boot check (<see cref="EnsureLoadedAsync(DbContext, CancellationToken)"/>) runs after every migration pass:
/// <list type="bullet">
/// <item>the version is already recorded → the table counts of that version are checked against the record and the file; a mismatch THROWS
/// (doctrine F3: a boot must never swallow it); nothing is written;</item>
/// <item>the version is not recorded (a database made without the migration, e.g. by EnsureCreated in Development) → it is loaded in one
/// transaction and then checked the same way;</item>
/// <item>the tables are not there at all (a database that was never migrated) → nothing is done and the answer says so.</item>
/// </list>
/// The statements upsert by LGD code, so a later version replaces a village's names and version tag; rows a later version no longer lists keep
/// their old tag and are never read as the current list (<see cref="LgdPlaceListReader"/> reads only the current version).
/// </summary>
public static class LgdPlaceListLoader
{
    private const int RowsPerStatement = 2000;

    /// <summary>The statements that load <paramref name="list"/> and then refuse (raise) unless the tables hold exactly its counts.</summary>
    public static IReadOnlyList<string> Statements(LgdPlaceList list)
    {
        ArgumentNullException.ThrowIfNull(list);
        var version = Literal(list.Version);
        var statements = new List<string>
        {
            Insert(
                "public.lgd_districts (code, name_en, name_mr, list_version)",
                list.Districts.Select(d => $"({d.Code.ToString(CultureInfo.InvariantCulture)}, {Literal(d.NameEn)}, {Literal(d.NameMr)}, {version})"),
                "ON CONFLICT (code) DO UPDATE SET name_en = EXCLUDED.name_en, name_mr = EXCLUDED.name_mr, list_version = EXCLUDED.list_version"),
            Insert(
                "public.lgd_talukas (code, district_code, name_en, name_mr, list_version)",
                list.Talukas.Select(t => $"({t.Code.ToString(CultureInfo.InvariantCulture)}, {t.DistrictCode.ToString(CultureInfo.InvariantCulture)}, {Literal(t.NameEn)}, NULL, {version})"),
                "ON CONFLICT (code) DO UPDATE SET district_code = EXCLUDED.district_code, name_en = EXCLUDED.name_en, name_mr = EXCLUDED.name_mr, list_version = EXCLUDED.list_version"),
        };

        foreach (var chunk in list.Villages.Chunk(RowsPerStatement))
        {
            statements.Add(Insert(
                "public.lgd_villages (code, taluka_code, name_en, name_mr, pin, status, list_version)",
                chunk.Select(v =>
                    $"({v.Code.ToString(CultureInfo.InvariantCulture)}, {v.TalukaCode.ToString(CultureInfo.InvariantCulture)}, {Literal(v.NameEn)}, {Literal(v.NameMr)}, {Literal(v.Pin)}, {((short)v.Status).ToString(CultureInfo.InvariantCulture)}, {version})"),
                "ON CONFLICT (code) DO UPDATE SET taluka_code = EXCLUDED.taluka_code, name_en = EXCLUDED.name_en, name_mr = EXCLUDED.name_mr, pin = EXCLUDED.pin, status = EXCLUDED.status, list_version = EXCLUDED.list_version"));
        }

        statements.Add(CountCheck(list));
        statements.Add(
            "INSERT INTO public.lgd_list_versions (version, loaded_at_utc, village_count, taluka_count, district_count, source, provenance) VALUES ("
            + $"{version}, now(), {list.DeclaredVillageCount.ToString(CultureInfo.InvariantCulture)}, {list.DeclaredTalukaCount.ToString(CultureInfo.InvariantCulture)}, "
            + $"{list.DeclaredDistrictCount.ToString(CultureInfo.InvariantCulture)}, {Literal(list.Source)}, {Literal(list.Provenance)}) ON CONFLICT (version) DO NOTHING");
        return statements;
    }

    /// <summary>The boot check for the list this server embeds (<see cref="LgdPlaceList.Current"/>).</summary>
    public static Task<string> EnsureLoadedAsync(DbContext db, CancellationToken ct) => EnsureLoadedAsync(db, LgdPlaceList.Current, ct);

    /// <summary>Loads <paramref name="list"/> unless it is recorded, then checks its counts. Returns one line for the boot log.</summary>
    public static async Task<string> EnsureLoadedAsync(DbContext db, LgdPlaceList list, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(list);
        var connection = db.Database.GetDbConnection();
        var opened = connection.State != ConnectionState.Open;
        if (opened)
        {
            await connection.OpenAsync(ct);
        }

        try
        {
            var tables = await ScalarIntAsync(connection, null,
                "SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public' "
                + "AND table_name IN ('lgd_districts', 'lgd_talukas', 'lgd_villages', 'lgd_list_versions')", ct);
            if (tables != 4)
            {
                return $"Place list {list.Version}: its tables are not in this database (it was not migrated); nothing was loaded.";
            }

            var recorded = await ScalarIntAsync(connection, null,
                $"SELECT count(*)::int FROM public.lgd_list_versions WHERE version = {Literal(list.Version)}", ct);
            if (recorded == 1)
            {
                await CheckAsync(connection, null, list, ct);
                return $"Place list {list.Version} is loaded: {list.DeclaredVillageCount} villages, {list.DeclaredTalukaCount} talukas, "
                    + $"{list.DeclaredDistrictCount} districts ({list.Provenance}). Nothing was written.";
            }

            await using (var tx = await connection.BeginTransactionAsync(ct))
            {
                foreach (var statement in Statements(list))
                {
                    await using var command = connection.CreateCommand();
                    command.Transaction = tx;
                    command.CommandText = statement;
                    command.CommandTimeout = 300;
                    await command.ExecuteNonQueryAsync(ct);
                }

                await CheckAsync(connection, tx, list, ct);
                await tx.CommitAsync(ct);
            }

            return $"Place list {list.Version} loaded now: {list.DeclaredVillageCount} villages, {list.DeclaredTalukaCount} talukas, "
                + $"{list.DeclaredDistrictCount} districts ({list.Provenance}).";
        }
        finally
        {
            if (opened)
            {
                await connection.CloseAsync();
            }
        }
    }

    /// <summary>Throws unless the record and the tables both hold exactly the file's counts.</summary>
    private static async Task CheckAsync(DbConnection connection, DbTransaction? tx, LgdPlaceList list, CancellationToken ct)
    {
        var version = Literal(list.Version);
        var villages = await ScalarIntAsync(connection, tx, $"SELECT count(*)::int FROM public.lgd_villages WHERE list_version = {version}", ct);
        var talukas = await ScalarIntAsync(connection, tx, $"SELECT count(*)::int FROM public.lgd_talukas WHERE list_version = {version}", ct);
        var districts = await ScalarIntAsync(connection, tx, $"SELECT count(*)::int FROM public.lgd_districts WHERE list_version = {version}", ct);
        var record = await ScalarStringAsync(connection, tx,
            $"SELECT village_count || ',' || taluka_count || ',' || district_count FROM public.lgd_list_versions WHERE version = {version}", ct);
        var expected = $"{list.DeclaredVillageCount},{list.DeclaredTalukaCount},{list.DeclaredDistrictCount}";
        if ($"{villages},{talukas},{districts}" != expected || record != expected)
        {
            throw new InvalidOperationException(
                $"Place list {list.Version}: the database holds {villages} villages, {talukas} talukas and {districts} districts "
                + $"(recorded: {record ?? "none"}); the list holds {list.DeclaredVillageCount}, {list.DeclaredTalukaCount} and "
                + $"{list.DeclaredDistrictCount}. Refusing to start on a list that does not match.");
        }
    }

    /// <summary>A DO block that raises (and so rolls the load back) unless the tables hold exactly the file's counts for its version.</summary>
    private static string CountCheck(LgdPlaceList list)
    {
        var version = Literal(list.Version);
        var v = list.DeclaredVillageCount.ToString(CultureInfo.InvariantCulture);
        var t = list.DeclaredTalukaCount.ToString(CultureInfo.InvariantCulture);
        var d = list.DeclaredDistrictCount.ToString(CultureInfo.InvariantCulture);
        return $"""
            DO $lgd$
            DECLARE villages int; talukas int; districts int;
            BEGIN
                SELECT count(*) INTO villages FROM public.lgd_villages WHERE list_version = {version};
                SELECT count(*) INTO talukas FROM public.lgd_talukas WHERE list_version = {version};
                SELECT count(*) INTO districts FROM public.lgd_districts WHERE list_version = {version};
                IF villages <> {v} OR talukas <> {t} OR districts <> {d} THEN
                    RAISE EXCEPTION 'Place list %: the tables hold % villages, % talukas and % districts; the list holds {v}, {t} and {d}. Nothing was loaded.',
                        {version}, villages, talukas, districts;
                END IF;
            END $lgd$;
            """;
    }

    private static string Insert(string target, IEnumerable<string> rows, string onConflict)
    {
        var sql = new StringBuilder("INSERT INTO ").Append(target).Append(" VALUES ");
        sql.AppendJoin(", ", rows);
        return sql.Append(' ').Append(onConflict).ToString();
    }

    /// <summary>A SQL string literal (standard_conforming_strings: only the quote is doubled), or NULL.</summary>
    private static string Literal(string? value) => value is null ? "NULL" : "'" + value.Replace("'", "''", StringComparison.Ordinal) + "'";

    private static async Task<int> ScalarIntAsync(DbConnection connection, DbTransaction? tx, string sql, CancellationToken ct) =>
        Convert.ToInt32(await ScalarAsync(connection, tx, sql, ct), CultureInfo.InvariantCulture);

    private static async Task<string?> ScalarStringAsync(DbConnection connection, DbTransaction? tx, string sql, CancellationToken ct) =>
        await ScalarAsync(connection, tx, sql, ct) as string;

    private static async Task<object?> ScalarAsync(DbConnection connection, DbTransaction? tx, string sql, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = tx;
        command.CommandText = sql;
        var value = await command.ExecuteScalarAsync(ct);
        return value is DBNull ? null : value;
    }
}

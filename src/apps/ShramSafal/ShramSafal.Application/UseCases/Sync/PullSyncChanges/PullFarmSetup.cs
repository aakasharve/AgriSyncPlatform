using System.Text.Json;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Sync.PullSyncChanges;

/// <summary>
/// spec: plr-d10 repair D-9 - one farm's setup as the pull sends it (the <c>farmSetup</c> key): ACTIVE rows only, each row trusted only under the farm it names
/// (E4: the database is not the whole defence), a plot's water only where the reader's seat covers the plot. A farm with nothing yet is still an entry, with
/// empty lists and no timetable, so the phone tells "empty" from "not sent".
/// </summary>
internal static class PullFarmSetup
{
    internal static FarmSetupDto Of(Guid farmId, FarmSetupRows rows, FarmReadScope scope)
    {
        var times = rows.PowerTimes.FirstOrDefault(p => p.Id == farmId);
        return new FarmSetupDto(
            farmId,
            rows.WaterSources
                .Where(s => (Guid)s.FarmId == farmId && s.State == FarmSetupState.Active)
                .Select(s => new FarmWaterSourceDto(
                    s.Id, s.Revision, s.Name, s.SourceType, s.IsAvailable, s.Notes,
                    s.Motors
                        .Where(m => m.State == FarmSetupState.Active)
                        .Select(m => new FarmMotorDto(
                            m.Id, m.Name, m.Hp, m.Phase, m.PowerSource, m.PowerSourceName,
                            m.HasDrip ? new FarmMotorDripDto(m.DripPipeSize, m.DripHasFilter ?? false, m.DripFlowLph) : null))
                        .ToList(),
                    s.UpdatedAtUtc))
                .ToList(),
            times is null ? null : new FarmPowerTimesDto(times.Revision, times.UpdatedAtUtc, Timetable(times)),
            rows.Machines
                .Where(m => (Guid)m.FarmId == farmId && m.State == FarmSetupState.Active)
                .Select(m => new FarmMachineDto(
                    m.Id, m.Revision, m.Name, m.MachineType, m.Ownership, m.Company, m.Model, m.Hp, m.NozzleCount, m.TankLitres, m.DetailLine, m.UpdatedAtUtc))
                .ToList(),
            rows.PlotWater
                .Where(p => (Guid)p.FarmId == farmId && scope.CoversPlot(p.Id))
                .Select(p => new PlotWaterDto(
                    p.Id, p.Revision, p.Method,
                    p.Links
                        .Where(l => l.State == FarmSetupState.Active)
                        .OrderBy(l => l.WaterSourceId).ThenBy(l => l.MotorId)
                        .Select(l => new PlotWaterLinkDto(l.WaterSourceId, l.MotorId))
                        .ToList(),
                    p.UpdatedAtUtc))
                .ToList());
    }

    /// <summary>
    /// The stored timetable in its one canonical form (the database keeps jsonb in its own key order). A stored document that no longer reads is a broken
    /// row, never an empty timetable: it fails the pull (the phone retries) rather than tell the phone something nobody saved.
    /// </summary>
    private static JsonElement Timetable(FarmPowerTimes times)
    {
        if (!PowerTimetable.TryParse(times.Content, out var timetable, out var problem))
        {
            throw new InvalidOperationException($"The stored power timetable of farm {times.Id} cannot be read ({problem?.Code}).");
        }

        using var document = JsonDocument.Parse(timetable!.CanonicalJson);
        return document.RootElement.Clone();
    }
}

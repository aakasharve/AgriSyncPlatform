using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// D-H8, R1 read-path scope: ONE REGISTER, THREE VIEWS. "An attendance
/// register is safe to show anyone on the farm. A wage book is not." The
/// projection below is what stops stated money reaching a non-owner as a
/// roster; the ATTENDANCE grid stays shareable. It resolves on the exact
/// boundary Phase 0 documented (the caller's membership role) and redesigns
/// no farm privacy.
/// </summary>
public sealed class LabourRegisterViewTests
{
    private static LabourDataDto FullDto() => new(
        TopLevelIds: ["p1"],
        People:
        [
            new LabourPersonDto(
                Id: "p1", Name: "गणेश", Initial: "ग", Tone: "or", Role: "worker",
                Verified: true, Temporary: false, TaskScope: null, AppointedById: null,
                RecordedWages: 4200m, Paid: 2000m, Advance: 500m,
                TodayStatus: null, DaysThisWeek: null, MemberIds: null, Trust: null,
                Access: "review", DaysActive: 10, CleanRecord: null),
        ],
        Dashboard: new LabourDashboardDto(
            WeekLabel: "", WindowFrom: "", WindowTo: "", Insight: "",
            ManDays: 3m, ManDaysTrend: 0, Wages: 1200m, Advances: 0m, Owed: 2200m,
            Logs: 2, Pending: 1, Plots: [],
            Money: new LabourMoneyDto(4200m, 2000m, 0m, 2200m)),
        Ledger: new LabourLedgerDto(
            WeekLabel: "",
            Days: ["2026-08-24"],
            Rows:
            [
                new LabourLedgerRowDto("op:x", Guid.NewGuid(), "गणेश", "ग", "or",
                    [new LabourLedgerCellDto("full", null, null, null, false, null)]),
            ],
            CrewRows: []),
        Review:
        [
            new LabourReviewItemDto(
                "r1", "गणेश", "ग", "or", "आज", "Draft",
                new LabourPointsDto(4, null, null, 850m, []),
                Plot: null, PlotScope: "Farm"),
        ],
        Attendance: new LabourAttendanceDraftDto("", null, [], ""),
        View: "owner");

    [Fact]
    public void RolesResolveToTheThreeViews()
    {
        Assert.Equal(LabourRegisterView.OwnerBook, GetLabourDataHandler.ResolveRegisterView(AppRole.PrimaryOwner));
        Assert.Equal(LabourRegisterView.OwnerBook, GetLabourDataHandler.ResolveRegisterView(AppRole.SecondaryOwner));
        Assert.Equal(LabourRegisterView.CrewAttendance, GetLabourDataHandler.ResolveRegisterView(AppRole.Mukadam));
        Assert.Equal(LabourRegisterView.OwnRow, GetLabourDataHandler.ResolveRegisterView(AppRole.Worker));
        Assert.Equal(LabourRegisterView.OwnRow, GetLabourDataHandler.ResolveRegisterView(AppRole.Agronomist));
    }

    /// <summary>The owner's book is untouched — his record, every rupee.</summary>
    [Fact]
    public void OwnerBookPassesThroughWhole()
    {
        var dto = GetLabourDataHandler.ApplyRegisterView(FullDto(), LabourRegisterView.OwnerBook);

        Assert.Equal("owner", dto.View);
        Assert.Equal(2000m, dto.People[0].Paid);
        Assert.NotNull(dto.Dashboard.Money);
        Assert.Equal(850m, dto.Review[0].Points.Amount);
        Assert.Single(dto.Ledger.Rows);
    }

    /// <summary>
    /// D-H8 + the Task 4.1 constraint verbatim: a मुकादम reading the register
    /// receives his crew's attendance and NO other worker's money. Money is
    /// ABSENT (null), never a fabricated ₹0 — blank is not zero.
    /// </summary>
    [Fact]
    public void CrewAttendanceViewCarriesAttendanceAndZeroMoneyMembers()
    {
        var dto = GetLabourDataHandler.ApplyRegisterView(FullDto(), LabourRegisterView.CrewAttendance);

        Assert.Equal("crew", dto.View);
        Assert.Single(dto.Ledger.Rows);                       // attendance stays
        Assert.Null(dto.People[0].RecordedWages);             // the money roster does not
        Assert.Null(dto.People[0].Paid);
        Assert.Null(dto.People[0].Advance);
        Assert.Null(dto.Dashboard.Wages);
        Assert.Null(dto.Dashboard.Advances);
        Assert.Null(dto.Dashboard.Owed);
        Assert.Null(dto.Dashboard.Money);
        Assert.Null(dto.Review[0].Points.Amount);
    }

    /// <summary>
    /// The worker view: no identity link exists yet (FieldOperator carries no
    /// user id), so "his own row" is honestly EMPTY rows — never everyone's
    /// rows, and never any money. The view discriminator is on the wire so the
    /// narrowing lands later as data, not as a contract change.
    /// </summary>
    [Fact]
    public void OwnRowViewCarriesNoOtherRowsAndNoMoney()
    {
        var dto = GetLabourDataHandler.ApplyRegisterView(FullDto(), LabourRegisterView.OwnRow);

        Assert.Equal("own", dto.View);
        Assert.Empty(dto.Ledger.Rows);
        Assert.Empty(dto.Ledger.CrewRows);
        Assert.Single(dto.Ledger.Days);                       // the page itself is still drawn
        Assert.Null(dto.People[0].Paid);
        Assert.Null(dto.Dashboard.Money);
    }
}

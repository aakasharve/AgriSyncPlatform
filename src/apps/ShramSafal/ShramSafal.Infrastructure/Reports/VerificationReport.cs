using System;
using System.Collections.Generic;
using System.Linq;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Infrastructure.Reports;

public class VerificationReport : IDocument
{
    private readonly Farm _farm;
    private readonly DateOnly _fromDate;
    private readonly DateOnly _toDate;
    private readonly List<DayLedger> _ledgers;

    public VerificationReport(Farm farm, DateOnly fromDate, DateOnly toDate, List<DayLedger> ledgers)
    {
        _farm = farm;
        _fromDate = fromDate;
        _toDate = toDate;
        _ledgers = ledgers;
    }

    public void Compose(IDocumentContainer container)
    {
        container
            .Page(page =>
            {
                page.Margin(50);
                page.Size(PageSizes.A4);
                page.PageColor(Colors.White);
                page.DefaultTextStyle(x => x.FontSize(11).FontFamily(Fonts.Arial));

                page.Header().Element(ComposeHeader);
                page.Content().Element(ComposeContent);
                page.Footer().Element(ComposeFooter);
            });
    }

    private void ComposeHeader(IContainer container)
    {
        container.Row(row =>
        {
            row.RelativeItem().Column(column =>
            {
                column.Item().Text($"Verification Report: {_farm.Name}").FontSize(20).SemiBold().FontColor(Colors.Blue.Darken2);
                column.Item().Text($"Period: {_fromDate:yyyy-MM-dd} to {_toDate:yyyy-MM-dd}").FontSize(14);
            });
        });
    }

    private void ComposeContent(IContainer container)
    {
        container.PaddingVertical(1, Unit.Centimetre).Column(column =>
        {
            if (!_ledgers.Any())
            {
                column.Item().Text("No verification records for this period.").Italic();
                return;
            }

            var totalEntries = _ledgers.Count;
            var multiAllocationEntries = _ledgers.Count(l => l.Allocations.Count > 1);
            var totalAllocatedAmount = _ledgers.Sum(l => l.Allocations.Sum(a => a.AllocatedAmount));

            column.Item().PaddingBottom(10).Text("Summary").FontSize(14).SemiBold();
            column.Item().Text($"Total Entries: {totalEntries}");
            column.Item().Text($"Entries With Split Allocations: {multiAllocationEntries}");
            column.Item().Text($"Total Allocated Amount: INR {totalAllocatedAmount:N2}");

            column.Item().PaddingTop(20).PaddingBottom(10).Text("Verification Details").FontSize(14).SemiBold();

            column.Item().Table(table =>
            {
                table.ColumnsDefinition(columns =>
                {
                    columns.RelativeColumn(2);
                    columns.RelativeColumn(3);
                    columns.RelativeColumn(2);
                    columns.RelativeColumn(2);
                    columns.RelativeColumn(2);
                });

                table.Header(header =>
                {
                    header.Cell().Text("Date").SemiBold();
                    header.Cell().Text("Source Entry").SemiBold();
                    header.Cell().Text("Allocation Basis").SemiBold();
                    header.Cell().Text("Status").SemiBold();
                    header.Cell().AlignRight().Text("Amount").SemiBold();
                    header.Cell().ColumnSpan(5).PaddingTop(5).BorderBottom(1).BorderColor(Colors.Black);
                });

                foreach (var ledger in _ledgers.OrderBy(l => l.LedgerDate))
                {
                    var amount = ledger.Allocations.Sum(a => a.AllocatedAmount);
                    var status = ledger.Allocations.Count > 0 ? "Allocated" : "Missing";
                    var statusColor = ledger.Allocations.Count > 0 ? Colors.Green.Darken2 : Colors.Red.Darken2;

                    table.Cell().PaddingBottom(3).Text(ledger.LedgerDate.ToString("yyyy-MM-dd"));
                    table.Cell().PaddingBottom(3).Text(ledger.SourceCostEntryId.ToString("N")[..8]);
                    table.Cell().PaddingBottom(3).Text(ledger.AllocationBasis);
                    table.Cell().PaddingBottom(3).Text(status).FontColor(statusColor);
                    table.Cell().PaddingBottom(3).AlignRight().Text($"INR {amount:N2}");
                }
            });
        });
    }

    private void ComposeFooter(IContainer container)
    {
        container.AlignCenter().Text(x =>
        {
            x.Span("Page ");
            x.CurrentPageNumber();
            x.Span(" of ");
            x.TotalPages();
        });
    }

    public DocumentMetadata GetMetadata() => DocumentMetadata.Default;
}

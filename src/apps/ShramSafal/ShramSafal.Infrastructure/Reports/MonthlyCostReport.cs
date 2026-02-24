using System;
using System.Collections.Generic;
using System.Linq;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Infrastructure.Reports;

public class MonthlyCostReport : IDocument
{
    private readonly Farm _farm;
    private readonly DateOnly _fromDate;
    private readonly DateOnly _toDate;
    private readonly List<DayLedger> _ledgers;

    public MonthlyCostReport(Farm farm, DateOnly fromDate, DateOnly toDate, List<DayLedger> ledgers)
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
                column.Item().Text($"Monthly Cost Report: {_farm.Name}").FontSize(20).SemiBold().FontColor(Colors.Blue.Darken2);
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
                column.Item().Text("No costs recorded for this month.").Italic();
                return;
            }

            var costByBasis = _ledgers
                .GroupBy(l => string.IsNullOrWhiteSpace(l.AllocationBasis) ? "Unspecified" : l.AllocationBasis)
                .Select(g => new
                {
                    Basis = g.Key,
                    Total = g.Sum(l => l.Allocations.Sum(a => a.AllocatedAmount))
                })
                .OrderByDescending(x => x.Total)
                .ToList();

            column.Item().PaddingBottom(10).Text("Cost by Allocation Basis").FontSize(14).SemiBold();

            column.Item().Table(table =>
            {
                table.ColumnsDefinition(columns =>
                {
                    columns.RelativeColumn(3);
                    columns.RelativeColumn(2);
                });

                table.Header(header =>
                {
                    header.Cell().Text("Allocation Basis").SemiBold();
                    header.Cell().AlignRight().Text("Total Flow").SemiBold();
                    header.Cell().ColumnSpan(2).PaddingTop(5).BorderBottom(1).BorderColor(Colors.Black);
                });

                var grandTotal = 0m;

                foreach (var item in costByBasis)
                {
                    grandTotal += item.Total;
                    table.Cell().PaddingBottom(5).Text(item.Basis);
                    table.Cell().PaddingBottom(5).AlignRight().Text($"INR {item.Total:N2}");
                }

                table.Cell().ColumnSpan(2).PaddingTop(5).BorderBottom(1).BorderColor(Colors.Grey.Lighten2);

                table.Cell().AlignRight().Text("Grand Total:").SemiBold();
                table.Cell().AlignRight().Text($"INR {grandTotal:N2}").SemiBold();
            });

            column.Item().PaddingTop(20).PaddingBottom(10).Text("Detailed Transactions").FontSize(14).SemiBold();

            column.Item().Table(table =>
            {
                table.ColumnsDefinition(columns =>
                {
                    columns.RelativeColumn(2);
                    columns.RelativeColumn(4);
                    columns.RelativeColumn(2);
                });

                table.Header(header =>
                {
                    header.Cell().Text("Date").SemiBold();
                    header.Cell().Text("Description").SemiBold();
                    header.Cell().AlignRight().Text("Amount").SemiBold();
                    header.Cell().ColumnSpan(3).PaddingTop(5).BorderBottom(1).BorderColor(Colors.Black);
                });

                foreach (var ledger in _ledgers.OrderBy(l => l.LedgerDate))
                {
                    var amount = ledger.Allocations.Sum(a => a.AllocatedAmount);
                    var description = $"{ledger.AllocationBasis} - Source {ledger.SourceCostEntryId.ToString("N")[..8]}";

                    table.Cell().PaddingBottom(3).Text(ledger.LedgerDate.ToString("yyyy-MM-dd"));
                    table.Cell().PaddingBottom(3).Text(description);
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

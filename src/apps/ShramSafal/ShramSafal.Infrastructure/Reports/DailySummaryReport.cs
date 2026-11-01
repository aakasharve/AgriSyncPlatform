using System;
using System.Collections.Generic;
using System.Linq;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Infrastructure.Reports;

public class DailySummaryReport : IDocument
{
    private readonly Farm _farm;
    private readonly DateOnly _date;
    private readonly List<DayLedger> _ledgers;
    private readonly string? _ruleNote;

    public DailySummaryReport(Farm farm, DateOnly date, List<DayLedger> ledgers, string? ruleNote = null)
    {
        _farm = farm;
        _date = date;
        _ledgers = ledgers;
        _ruleNote = ruleNote;
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
                column.Item().Text($"Daily Summary: {_farm.Name}").FontSize(20).SemiBold().FontColor(Colors.Blue.Darken2);
                column.Item().Text($"Date: {_date:yyyy-MM-dd}").FontSize(14);
            });
        });
    }

    private void ComposeContent(IContainer container)
    {
        container.PaddingVertical(1, Unit.Centimetre).Column(column =>
        {
            // spec: plr-d10 lane PRV fix pass 1 (M5) — W4, when a record of this period is kept from the reader.
            if (_ruleNote is not null)
            {
                column.Item().PaddingBottom(10).Text(_ruleNote).Italic();
            }

            if (!_ledgers.Any())
            {
                column.Item().Text("No activities recorded for this date.").Italic();
                return;
            }

            column.Item().Table(table =>
            {
                table.ColumnsDefinition(columns =>
                {
                    columns.RelativeColumn(2);
                    columns.RelativeColumn(3);
                    columns.RelativeColumn(3);
                    columns.RelativeColumn(2);
                    columns.RelativeColumn(2);
                });

                table.Header(header =>
                {
                    header.Cell().Text("Date").SemiBold();
                    header.Cell().Text("Allocation Basis").SemiBold();
                    header.Cell().Text("Source Entry").SemiBold();
                    header.Cell().Text("Allocations").SemiBold();
                    header.Cell().Text("Cost").SemiBold();

                    header.Cell().ColumnSpan(5).PaddingTop(5).BorderBottom(1).BorderColor(Colors.Black);
                });

                var totalCost = 0m;

                foreach (var ledger in _ledgers)
                {
                    var cost = ledger.Allocations.Sum(allocation => allocation.AllocatedAmount);
                    totalCost += cost;

                    table.Cell().Text(ledger.LedgerDate.ToString("yyyy-MM-dd"));
                    table.Cell().Text(ledger.AllocationBasis);
                    table.Cell().Text(ledger.SourceCostEntryId.ToString("N")[..8]);
                    table.Cell().Text(ledger.Allocations.Count.ToString());
                    table.Cell().Text($"INR {cost:N2}");
                }

                table.Cell().ColumnSpan(5).PaddingTop(5).BorderBottom(1).BorderColor(Colors.Grey.Lighten2);

                table.Cell().ColumnSpan(4).AlignRight().Text("Total:").SemiBold();
                table.Cell().Text($"INR {totalCost:N2}").SemiBold();
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

    /// <summary>The W4 line this document carries, or null when it leaves nothing out.</summary>
    public string? RuleNote => _ruleNote;

    public DocumentMetadata GetMetadata() => DocumentMetadata.Default;
}

using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace ShramSafal.Infrastructure.Reports;

internal static class MonthlyCostReport
{
    public sealed record Data(
        string FarmName,
        int Year,
        int Month,
        IReadOnlyList<PlotCostRow> PlotCosts,
        IReadOnlyList<CategoryCostRow> CategoryCosts,
        IReadOnlyList<DailyCostRow> DailyCosts,
        IReadOnlyList<FlaggedEntryRow> FlaggedEntries,
        decimal GrandTotal,
        DateTime GeneratedAtUtc);

    public sealed record PlotCostRow(
        string PlotName,
        decimal DirectCost,
        decimal AllocatedCost,
        decimal TotalCost);

    public sealed record CategoryCostRow(
        string Category,
        decimal TotalCost);

    public sealed record DailyCostRow(
        DateOnly Date,
        decimal TotalCost);

    public sealed record FlaggedEntryRow(
        DateOnly EntryDate,
        string PlotName,
        string Category,
        decimal Amount,
        string Reason);

    public static byte[] Generate(Data data)
    {
        return Document
            .Create(container =>
            {
                container.Page(page =>
                {
                    page.Size(PageSizes.A4);
                    page.Margin(24);
                    page.DefaultTextStyle(x => x.FontSize(10));

                    page.Header().Column(column =>
                    {
                        column.Spacing(2);
                        column.Item().Text("Monthly Cost Report").SemiBold().FontSize(18);
                        column.Item().Text($"{data.FarmName} | {data.Year}-{data.Month:D2}");
                    });

                    page.Content().Column(column =>
                    {
                        column.Spacing(12);

                        column.Item().Text("Per-Plot Summary").SemiBold().FontSize(12);
                        column.Item().Element(container => ComposePlotTable(container, data.PlotCosts));

                        column.Item().Text("Category Breakdown").SemiBold().FontSize(12);
                        column.Item().Element(container => ComposeCategoryTable(container, data.CategoryCosts));

                        column.Item().Text("Daily Cost Data").SemiBold().FontSize(12);
                        column.Item().Element(container => ComposeDailyTable(container, data.DailyCosts));

                        column.Item().Text("Flagged Entries").SemiBold().FontSize(12);
                        column.Item().Element(container => ComposeFlaggedTable(container, data.FlaggedEntries));

                        column.Item().AlignRight().Text(text =>
                        {
                            text.Span("Grand Total: ").SemiBold();
                            text.Span(data.GrandTotal.ToString("0.00"));
                        });
                    });

                    page.Footer()
                        .AlignRight()
                        .Text($"Generated at {data.GeneratedAtUtc:yyyy-MM-dd HH:mm:ss} UTC");
                });
            })
            .GeneratePdf();
    }

    private static void ComposePlotTable(IContainer container, IReadOnlyList<PlotCostRow> rows)
    {
        if (rows.Count == 0)
        {
            container.Text("No costs recorded for this month.");
            return;
        }

        container.Table(table =>
        {
            table.ColumnsDefinition(columns =>
            {
                columns.RelativeColumn(3);
                columns.RelativeColumn(2);
                columns.RelativeColumn(2);
                columns.RelativeColumn(2);
            });

            table.Header(header =>
            {
                header.Cell().Element(HeaderCell).Text("Plot");
                header.Cell().Element(HeaderCell).AlignRight().Text("Direct");
                header.Cell().Element(HeaderCell).AlignRight().Text("Allocated");
                header.Cell().Element(HeaderCell).AlignRight().Text("Total");
            });

            foreach (var row in rows)
            {
                table.Cell().Element(ValueCell).Text(row.PlotName);
                table.Cell().Element(ValueCell).AlignRight().Text(row.DirectCost.ToString("0.00"));
                table.Cell().Element(ValueCell).AlignRight().Text(row.AllocatedCost.ToString("0.00"));
                table.Cell().Element(ValueCell).AlignRight().Text(row.TotalCost.ToString("0.00"));
            }
        });
    }

    private static void ComposeCategoryTable(IContainer container, IReadOnlyList<CategoryCostRow> rows)
    {
        if (rows.Count == 0)
        {
            container.Text("No category totals available.");
            return;
        }

        container.Table(table =>
        {
            table.ColumnsDefinition(columns =>
            {
                columns.RelativeColumn(3);
                columns.RelativeColumn(2);
            });

            table.Header(header =>
            {
                header.Cell().Element(HeaderCell).Text("Category");
                header.Cell().Element(HeaderCell).AlignRight().Text("Total");
            });

            foreach (var row in rows)
            {
                table.Cell().Element(ValueCell).Text(row.Category);
                table.Cell().Element(ValueCell).AlignRight().Text(row.TotalCost.ToString("0.00"));
            }
        });
    }

    private static void ComposeDailyTable(IContainer container, IReadOnlyList<DailyCostRow> rows)
    {
        if (rows.Count == 0)
        {
            container.Text("No daily costs to chart for this month.");
            return;
        }

        container.Table(table =>
        {
            table.ColumnsDefinition(columns =>
            {
                columns.RelativeColumn(2);
                columns.RelativeColumn(2);
            });

            table.Header(header =>
            {
                header.Cell().Element(HeaderCell).Text("Date");
                header.Cell().Element(HeaderCell).AlignRight().Text("Total");
            });

            foreach (var row in rows)
            {
                table.Cell().Element(ValueCell).Text(row.Date.ToString("yyyy-MM-dd"));
                table.Cell().Element(ValueCell).AlignRight().Text(row.TotalCost.ToString("0.00"));
            }
        });
    }

    private static void ComposeFlaggedTable(IContainer container, IReadOnlyList<FlaggedEntryRow> rows)
    {
        if (rows.Count == 0)
        {
            container.Text("No flagged entries this month.");
            return;
        }

        container.Table(table =>
        {
            table.ColumnsDefinition(columns =>
            {
                columns.RelativeColumn(2);
                columns.RelativeColumn(2);
                columns.RelativeColumn(2);
                columns.RelativeColumn(2);
                columns.RelativeColumn(3);
            });

            table.Header(header =>
            {
                header.Cell().Element(HeaderCell).Text("Date");
                header.Cell().Element(HeaderCell).Text("Plot");
                header.Cell().Element(HeaderCell).Text("Category");
                header.Cell().Element(HeaderCell).AlignRight().Text("Amount");
                header.Cell().Element(HeaderCell).Text("Reason");
            });

            foreach (var row in rows)
            {
                table.Cell().Element(ValueCell).Text(row.EntryDate.ToString("yyyy-MM-dd"));
                table.Cell().Element(ValueCell).Text(row.PlotName);
                table.Cell().Element(ValueCell).Text(row.Category);
                table.Cell().Element(ValueCell).AlignRight().Text(row.Amount.ToString("0.00"));
                table.Cell().Element(ValueCell).Text(row.Reason);
            }
        });
    }

    private static IContainer HeaderCell(IContainer container)
    {
        return container
            .BorderBottom(1)
            .BorderColor(Colors.Grey.Lighten2)
            .PaddingVertical(4)
            .DefaultTextStyle(x => x.SemiBold());
    }

    private static IContainer ValueCell(IContainer container)
    {
        return container
            .BorderBottom(1)
            .BorderColor(Colors.Grey.Lighten4)
            .PaddingVertical(4);
    }
}

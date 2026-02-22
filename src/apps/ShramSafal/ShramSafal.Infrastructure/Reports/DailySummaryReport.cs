using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace ShramSafal.Infrastructure.Reports;

internal static class DailySummaryReport
{
    public sealed record Data(
        string FarmName,
        DateOnly Date,
        string WeatherSummary,
        int AttachedReceiptCount,
        IReadOnlyList<ActivityRow> ActivityRows,
        IReadOnlyList<CostRow> CostRows,
        IReadOnlyList<VerificationRow> VerificationRows,
        DateTime GeneratedAtUtc);

    public sealed record ActivityRow(
        string PlotName,
        string TaskType,
        string Description,
        string Workers);

    public sealed record CostRow(
        string Category,
        decimal Amount);

    public sealed record VerificationRow(
        string PlotName,
        string Status,
        string LastUpdatedUtc);

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
                        column.Item().Text("Daily Summary Report").SemiBold().FontSize(18);
                        column.Item().Text($"{data.FarmName} | {data.Date:yyyy-MM-dd}");
                    });

                    page.Content().Column(column =>
                    {
                        column.Spacing(12);

                        column.Item().Text(text =>
                        {
                            text.Span("Weather: ").SemiBold();
                            text.Span(data.WeatherSummary);
                        });

                        column.Item().Text(text =>
                        {
                            text.Span("Attached Receipts: ").SemiBold();
                            text.Span(data.AttachedReceiptCount.ToString());
                        });

                        column.Item().Text("Activities Logged").SemiBold().FontSize(12);
                        column.Item().Element(container => ComposeActivitiesTable(container, data.ActivityRows));

                        column.Item().Text("Cost Breakdown").SemiBold().FontSize(12);
                        column.Item().Element(container => ComposeCostTable(container, data.CostRows));

                        column.Item().Text("Verification Status").SemiBold().FontSize(12);
                        column.Item().Element(container => ComposeVerificationTable(container, data.VerificationRows));
                    });

                    page.Footer()
                        .AlignRight()
                        .Text($"Generated at {data.GeneratedAtUtc:yyyy-MM-dd HH:mm:ss} UTC");
                });
            })
            .GeneratePdf();
    }

    private static void ComposeActivitiesTable(IContainer container, IReadOnlyList<ActivityRow> rows)
    {
        if (rows.Count == 0)
        {
            container.Text("No activities logged for this date.");
            return;
        }

        container.Table(table =>
        {
            table.ColumnsDefinition(columns =>
            {
                columns.RelativeColumn(2);
                columns.RelativeColumn(2);
                columns.RelativeColumn(4);
                columns.RelativeColumn(2);
            });

            table.Header(header =>
            {
                header.Cell().Element(HeaderCell).Text("Plot");
                header.Cell().Element(HeaderCell).Text("Task");
                header.Cell().Element(HeaderCell).Text("Description");
                header.Cell().Element(HeaderCell).Text("Workers");
            });

            foreach (var row in rows)
            {
                table.Cell().Element(ValueCell).Text(row.PlotName);
                table.Cell().Element(ValueCell).Text(row.TaskType);
                table.Cell().Element(ValueCell).Text(row.Description);
                table.Cell().Element(ValueCell).Text(row.Workers);
            }
        });
    }

    private static void ComposeCostTable(IContainer container, IReadOnlyList<CostRow> rows)
    {
        if (rows.Count == 0)
        {
            container.Text("No costs logged for this date.");
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
                header.Cell().Element(HeaderCell).AlignRight().Text("Amount");
            });

            foreach (var row in rows)
            {
                table.Cell().Element(ValueCell).Text(row.Category);
                table.Cell().Element(ValueCell).AlignRight().Text(row.Amount.ToString("0.00"));
            }
        });
    }

    private static void ComposeVerificationTable(IContainer container, IReadOnlyList<VerificationRow> rows)
    {
        if (rows.Count == 0)
        {
            container.Text("No logs available for verification summary.");
            return;
        }

        container.Table(table =>
        {
            table.ColumnsDefinition(columns =>
            {
                columns.RelativeColumn(2);
                columns.RelativeColumn(2);
                columns.RelativeColumn(3);
            });

            table.Header(header =>
            {
                header.Cell().Element(HeaderCell).Text("Plot");
                header.Cell().Element(HeaderCell).Text("Status");
                header.Cell().Element(HeaderCell).Text("Last Updated (UTC)");
            });

            foreach (var row in rows)
            {
                table.Cell().Element(ValueCell).Text(row.PlotName);
                table.Cell().Element(ValueCell).Text(row.Status);
                table.Cell().Element(ValueCell).Text(row.LastUpdatedUtc);
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

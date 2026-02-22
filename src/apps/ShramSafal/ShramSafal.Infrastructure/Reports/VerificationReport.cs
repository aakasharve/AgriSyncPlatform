using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace ShramSafal.Infrastructure.Reports;

internal static class VerificationReport
{
    public sealed record Data(
        string FarmName,
        DateOnly FromDate,
        DateOnly ToDate,
        IReadOnlyList<LogRow> Logs,
        SummaryRow Summary,
        IReadOnlyList<CorrectionRow> Corrections,
        DateTime GeneratedAtUtc);

    public sealed record LogRow(
        DateOnly Date,
        string PlotName,
        string Tasks,
        string Status,
        string Verifier,
        string TimestampUtc);

    public sealed record SummaryRow(
        int TotalLogs,
        int VerifiedCount,
        int DisputedCount,
        int PendingCount);

    public sealed record CorrectionRow(
        DateOnly Date,
        string PlotName,
        string BeforeStatus,
        string AfterStatus,
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
                        column.Item().Text("Verification Report").SemiBold().FontSize(18);
                        column.Item().Text($"{data.FarmName} | {data.FromDate:yyyy-MM-dd} to {data.ToDate:yyyy-MM-dd}");
                    });

                    page.Content().Column(column =>
                    {
                        column.Spacing(12);

                        column.Item().Text("Verification by Log").SemiBold().FontSize(12);
                        column.Item().Element(container => ComposeLogTable(container, data.Logs));

                        column.Item().Text("Summary").SemiBold().FontSize(12);
                        column.Item().Element(container => ComposeSummaryTable(container, data.Summary));

                        column.Item().Text("Corrections").SemiBold().FontSize(12);
                        column.Item().Element(container => ComposeCorrectionTable(container, data.Corrections));
                    });

                    page.Footer()
                        .AlignRight()
                        .Text($"Generated at {data.GeneratedAtUtc:yyyy-MM-dd HH:mm:ss} UTC");
                });
            })
            .GeneratePdf();
    }

    private static void ComposeLogTable(IContainer container, IReadOnlyList<LogRow> rows)
    {
        if (rows.Count == 0)
        {
            container.Text("No logs found in the selected date range.");
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
                columns.RelativeColumn(3);
                columns.RelativeColumn(3);
            });

            table.Header(header =>
            {
                header.Cell().Element(HeaderCell).Text("Date");
                header.Cell().Element(HeaderCell).Text("Plot");
                header.Cell().Element(HeaderCell).Text("Tasks");
                header.Cell().Element(HeaderCell).Text("Status");
                header.Cell().Element(HeaderCell).Text("Verifier");
                header.Cell().Element(HeaderCell).Text("Timestamp (UTC)");
            });

            foreach (var row in rows)
            {
                table.Cell().Element(ValueCell).Text(row.Date.ToString("yyyy-MM-dd"));
                table.Cell().Element(ValueCell).Text(row.PlotName);
                table.Cell().Element(ValueCell).Text(row.Tasks);
                table.Cell().Element(ValueCell).Text(row.Status);
                table.Cell().Element(ValueCell).Text(row.Verifier);
                table.Cell().Element(ValueCell).Text(row.TimestampUtc);
            }
        });
    }

    private static void ComposeSummaryTable(IContainer container, SummaryRow summary)
    {
        container.Table(table =>
        {
            table.ColumnsDefinition(columns =>
            {
                columns.RelativeColumn(2);
                columns.RelativeColumn(2);
            });

            table.Cell().Element(HeaderCell).Text("Metric");
            table.Cell().Element(HeaderCell).Text("Count");

            table.Cell().Element(ValueCell).Text("Total Logs");
            table.Cell().Element(ValueCell).Text(summary.TotalLogs.ToString());

            table.Cell().Element(ValueCell).Text("Verified");
            table.Cell().Element(ValueCell).Text(summary.VerifiedCount.ToString());

            table.Cell().Element(ValueCell).Text("Disputed");
            table.Cell().Element(ValueCell).Text(summary.DisputedCount.ToString());

            table.Cell().Element(ValueCell).Text("Pending");
            table.Cell().Element(ValueCell).Text(summary.PendingCount.ToString());
        });
    }

    private static void ComposeCorrectionTable(IContainer container, IReadOnlyList<CorrectionRow> rows)
    {
        if (rows.Count == 0)
        {
            container.Text("No corrections recorded in this range.");
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
                columns.RelativeColumn(4);
            });

            table.Header(header =>
            {
                header.Cell().Element(HeaderCell).Text("Date");
                header.Cell().Element(HeaderCell).Text("Plot");
                header.Cell().Element(HeaderCell).Text("Before");
                header.Cell().Element(HeaderCell).Text("After");
                header.Cell().Element(HeaderCell).Text("Reason");
            });

            foreach (var row in rows)
            {
                table.Cell().Element(ValueCell).Text(row.Date.ToString("yyyy-MM-dd"));
                table.Cell().Element(ValueCell).Text(row.PlotName);
                table.Cell().Element(ValueCell).Text(row.BeforeStatus);
                table.Cell().Element(ValueCell).Text(row.AfterStatus);
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

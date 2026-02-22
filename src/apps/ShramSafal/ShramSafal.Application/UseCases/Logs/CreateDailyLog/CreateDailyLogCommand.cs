using ShramSafal.Domain.Location;

namespace ShramSafal.Application.UseCases.Logs.CreateDailyLog;

public sealed record CreateDailyLogCommand(
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    Guid RequestedByUserId,
    Guid OperatorUserId,
    DateOnly LogDate,
    string? DeviceId,
    string? ClientRequestId,
    Guid? DailyLogId = null,
    LocationSnapshot? Location = null)
{
    public string? IdempotencyKey
    {
        get
        {
            if (string.IsNullOrWhiteSpace(ClientRequestId))
            {
                return null;
            }

            if (string.IsNullOrWhiteSpace(DeviceId))
            {
                return ClientRequestId.Trim();
            }

            return $"{DeviceId.Trim()}:{ClientRequestId.Trim()}";
        }
    }
}

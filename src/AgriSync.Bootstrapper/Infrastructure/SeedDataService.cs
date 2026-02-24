using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure.Persistence;
using User.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AgriSync.Bootstrapper.Infrastructure;

public class SeedDataService
{
    private readonly ShramSafalDbContext _SSFContext;
    private readonly UserDbContext _userContext;

    public SeedDataService(ShramSafalDbContext ssfContext, UserDbContext userContext)
    {
        _SSFContext = ssfContext;
        _userContext = userContext;
    }

    public async Task<string> SeedDemoDataAsync()
    {
        // 1. Ensure User Exists
        var userId = new UserId(Guid.Parse("00000000-0000-0000-0000-000000000001")); // Fixed ID for demo user
        var phone = "9999999999";
        
        var user = await _userContext.Users.FirstOrDefaultAsync(u => u.Phone.Value == phone);
        if (user == null)
        {
            // We can't easily create a user here without accessing the internal User constructor or factory
            // which might be internal or require specific domain logic.
            // For now, we assume the /test/login endpoint created the user, or we try to find THAT user.
            // Let's try to find ANY user or the one created by the test endpoint.
            user = await _userContext.Users.FirstOrDefaultAsync();
            if (user == null) return "No user found. Please login/register via app or /test/login first.";
            userId = user.Id;
        }
        else 
        {
            userId = user.Id;
        }

        // 2. Check if Farm exists
        var existingFarm = await _SSFContext.Farms.FirstOrDefaultAsync(f => f.OwnerUserId == userId);
        if (existingFarm != null)
        {
             // Cleanup for fresh seed? Or just return?
             // Let's return for now to avoid duplicates.
             return "Farm already exists for this user. tailored seeding skipped.";
        }

        // 3. Create Ramus Farm
        var farmId = new FarmId(Guid.NewGuid());
        var farm = Farm.Create(farmId, "Ramus Farm", userId, DateTime.UtcNow);
        _SSFContext.Farms.Add(farm);

        // 4. Create Plots & Crops
        // Grapes
        await CreatePlotAndCrop(farmId, "Export Plot (A)", 2.0m, "Grapes", "Pruning", userId);
        await CreatePlotAndCrop(farmId, "Local Plot (B)", 1.5m, "Grapes", "Pruning", userId);
        
        // Pomegranate
        await CreatePlotAndCrop(farmId, "Bhagwa #1", 2.0m, "Pomegranate", "Bahar Treatment", userId);
        await CreatePlotAndCrop(farmId, "Bhagwa #2", 2.0m, "Pomegranate", "Fertigation", userId);

        // Sugarcane
        await CreatePlotAndCrop(farmId, "River Bank", 4.0m, "Sugarcane", "Planting", userId);

        // Onion
        await CreatePlotAndCrop(farmId, "Summer Crop", 1.0m, "Onion", "Sowing", userId);

        await _SSFContext.SaveChangesAsync();

        return "Demo Data Seeded Successfully! (Ramus Farm + 6 Plots + Logs)";
    }

    private async Task CreatePlotAndCrop(FarmId farmId, string plotName, decimal area, string cropName, string stage, UserId userId)
    {
        // Plot
        var plotId = Guid.NewGuid();
        var plot = Plot.Create(plotId, farmId, plotName, area, DateTime.UtcNow);
        _SSFContext.Plots.Add(plot);

        // CropCycle
        var cropCycleId = Guid.NewGuid();
        var cropCycle = CropCycle.Create(cropCycleId, farmId, plotId, cropName, stage, 
            DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-30)), null, DateTime.UtcNow);
        _SSFContext.CropCycles.Add(cropCycle);

        // Logs (Simulate random activity)
        var log = DailyLog.Create(Guid.NewGuid(), farmId, plotId, cropCycleId, userId, 
            DateOnly.FromDateTime(DateTime.UtcNow), 
            Guid.NewGuid().ToString(), 
            null,
            DateTime.UtcNow);
        
        log.AddTask(Guid.NewGuid(), "Irrigation", "Drip irrigation for 2 hours", DateTime.UtcNow);
        log.AddTask(Guid.NewGuid(), "Observation", "Crop looks healthy", DateTime.UtcNow);
        
        _SSFContext.DailyLogs.Add(log);
    }
}

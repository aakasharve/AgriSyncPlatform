using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure.Persistence;
using User.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using User.Domain.Identity;
using User.Domain.Membership;
using User.Application.Ports;

namespace AgriSync.Bootstrapper.Infrastructure;

public class DatabaseSeeder
{
    private readonly ShramSafalDbContext _SSFContext;
    private readonly UserDbContext _userContext;
    private readonly IPasswordHasher _passwordHasher;

    public DatabaseSeeder(ShramSafalDbContext ssfContext, UserDbContext userContext, IPasswordHasher passwordHasher)
    {
        _SSFContext = ssfContext;
        _userContext = userContext;
        _passwordHasher = passwordHasher;
    }

    public async Task<string> SeedDemoDataAsync()
    {
        // 1. Ensure User Ramu Exists
        var phone = "9999999999";
        var user = await _userContext.Users.FirstOrDefaultAsync(u => u.Phone.Value == phone);
        UserId userId;

        if (user == null)
        {
            var hashedPassword = _passwordHasher.Hash("ramu123");
            
            // Use User.Register factory method
            userId = new UserId(Guid.Parse("00000000-0000-0000-0000-000000000001"));
            user = User.Domain.Identity.User.Register(
                userId,
                User.Domain.Identity.PhoneNumber.Create(phone),
                "Ramu Patil",
                hashedPassword,
                DateTime.UtcNow
            );

            // Add default membership for ShramSafal app
            user.AddMembership(Guid.NewGuid(), "shramsafal", User.Domain.Membership.AppRole.PrimaryOwner, DateTime.UtcNow);

            _userContext.Users.Add(user);
            await _userContext.SaveChangesAsync();
        }
        else 
        {
            userId = user.Id;
        }

        // 2. Check if Farm exists
        var existingFarm = await _SSFContext.Farms.FirstOrDefaultAsync(f => f.OwnerUserId == userId);
        if (existingFarm != null)
        {
             return "Farm already exists for Ramu. Seeding skipped.";
        }

        // 3. Create Ramu's Farm
        var farmId = new FarmId(Guid.NewGuid());
        var farm = Farm.Create(farmId, "Ramu's Farm", userId, DateTime.UtcNow);
        _SSFContext.Farms.Add(farm);

        // 4. Create Plots & Crops (Reflecting RAMUS_FARM from frontend)
        
        // --- Crop 1: Grapes ---
        // Plot A: Export Plot (A)
        await CreatePlotAndCycle(farmId, "Export Plot (A)", 2.0m, "Grapes", "Pruning", userId, -29);
        // Plot B: Local Plot (B)
        await CreatePlotAndCycle(farmId, "Local Plot (B)", 1.5m, "Grapes", "Pruning", userId, -29);

        // --- Crop 2: Pomegranate ---
        // Plot #1: Bhagwa #1
        await CreatePlotAndCycle(farmId, "Bhagwa #1", 2.0m, "Pomegranate", "Bahar Treatment", userId, -29);
        // Plot #2: Bhagwa #2
        await CreatePlotAndCycle(farmId, "Bhagwa #2", 2.0m, "Pomegranate", "Fertigation", userId, -29);

        // --- Crop 3: Sugarcane ---
        // River Bank
        await CreatePlotAndCycle(farmId, "River Bank", 4.0m, "Sugarcane", "Planting", userId, -60);

        // --- Crop 4: Onion ---
        // Summer Crop
        await CreatePlotAndCycle(farmId, "Summer Crop", 1.0m, "Onion", "Sowing", userId, -10);

        await _SSFContext.SaveChangesAsync();

        return "Demo Data Seeded Successfully! (Ramu's Farm + 6 Plots + Logs)";
    }

    private async Task CreatePlotAndCycle(FarmId farmId, string plotName, decimal area, string cropName, string stage, UserId userId, int daysAgoStart)
    {
        // Plot
        var plotId = Guid.NewGuid();
        var plot = Plot.Create(plotId, farmId, plotName, area, DateTime.UtcNow);
        _SSFContext.Plots.Add(plot);

        // CropCycle
        var cropCycleId = Guid.NewGuid();
        var startDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(daysAgoStart));
        var cropCycle = CropCycle.Create(cropCycleId, farmId, plotId, cropName, stage, 
            startDate, null, DateTime.UtcNow);
        _SSFContext.CropCycles.Add(cropCycle);

        // Logs (Simulate random activity for last 30 days)
        var random = new Random();
        for (int i = 0; i < 30; i++)
        {
            if (random.NextDouble() > 0.7) continue; // Skip some days

            var date = DateTime.UtcNow.AddDays(-i);
            var log = DailyLog.Create(Guid.NewGuid(), farmId, plotId, cropCycleId, userId, 
                DateOnly.FromDateTime(date), 
                Guid.NewGuid().ToString(), 
                DateTime.UtcNow);
            
            if (cropName == "Grapes")
            {
                log.AddTask(Guid.NewGuid(), "Spraying", "Preventive spray", date);
            }
            else if (cropName == "Sugarcane")
            {
               log.AddTask(Guid.NewGuid(), "Irrigation", "Flood irrigation", date);
            }
            else 
            {
               log.AddTask(Guid.NewGuid(), "Observation", "General checkup", date);
            }
            
            _SSFContext.DailyLogs.Add(log);
        }
    }
}

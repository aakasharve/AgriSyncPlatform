# Domain Types Layer Rules

## Purpose

This directory contains **pure domain types** - the core business concepts that define what AgriLog is at its heart. These types have no dependencies on UI, infrastructure, or feature-specific code.

## Import Rules

### What domain/types/ CAN import:
- Other files within domain/types/
- Feature types that are standalone (e.g., scheduler.types.ts) when they don't create cycles

### What domain/types/ CANNOT import:
- React components or hooks
- UI-specific code (components/, pages/, features/ UI)
- Infrastructure code (localStorage, API clients)
- Zustand stores or state management

## Directory Structure

```
src/domain/types/
  index.ts           - Main export file
  weather.types.ts   - Weather domain types
  log.types.ts       - Execution ledger types (DailyLog, events, observations)
  farm.types.ts      - Farm structure types (Plot, Crop, Profile, Operators)
  summary.types.ts   - Derived/computed types (summaries, comparisons)
```

## Backward Compatibility

For existing code that imports from `src/types.ts` or feature type files:
- These files now re-export from domain/types/
- All existing imports continue to work
- New code should import directly from `src/domain/types/`

## Type Categories

### Truth Types (Immutable Records)
- `DailyLog` - The execution record for a day
- `WeatherStamp` - Point-in-time weather observation
- `ObservationNote` - Farmer observation (fact, not mutable)

### Entity Types (Mutable Configuration)
- `FarmerProfile` - Farm owner configuration
- `CropProfile` - Crop setup and plots
- `Plot` - Land unit with schedule

### Event Types (Log Components)
- `CropActivityEvent`, `IrrigationEvent`, `LabourEvent`, etc.
- These are immutable once recorded

### Reference Types (IDs and Links)
- `FarmContext` - Selected crop/plot context
- `LogScope` - What plots a log applies to

## Migration Notes

Types were consolidated here from:
- `src/types.ts` (638 lines, scattered concerns)
- `src/features/logs/logs.types.ts`
- `src/features/weather/weather.types.ts`

The old files now serve as backward-compatible re-exports.

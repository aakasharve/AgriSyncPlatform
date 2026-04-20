import React, { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { CropProfile, DailyLog } from '../../../types';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { formatCurrencyINR } from '../../../shared/utils/dayState';
import { getHarvestSessions, getOtherIncomeEntries } from '../../../services/harvestService';
import { CropSymbol } from '../../context/components/CropSelector';

type CalendarMode = 'week' | 'month';
type GraphMode = 'total' | 'crop' | 'plot';
type GraphType = 'bar' | 'pie';
type TimelineBucket = 'daily' | 'weekly';

interface CostAnalysisSectionProps {
    logs: DailyLog[];
    crops: CropProfile[];
    selectedCropIds: string[];
    selectedPlotsByCrop: Record<string, string[]>;
    selectedDate: Date;
    calendarMode: CalendarMode;
}

interface AnalysisRange {
    startDateKey: string;
    endDateKey: string;
    bucket: TimelineBucket;
    label: string;
}

interface SpendPoint {
    key: string;
    label: string;
    value: number;
}

interface ScopedPlotRef {
    cropId: string;
    cropName: string;
    cropIconName: string;
    plotId: string;
    plotName: string;
}

interface PointVisual {
    iconName: string;
}

const FARM_GLOBAL_ID = 'FARM_GLOBAL';
const CHART_COLORS = ['#0EA5E9', '#22C55E', '#F59E0B', '#8B5CF6', '#EF4444', '#14B8A6', '#F97316', '#6366F1'];
const BAR_GRADIENTS: Array<[string, string]> = [
    ['#67E8F9', '#0284C7'],
    ['#86EFAC', '#16A34A'],
    ['#FDE68A', '#D97706'],
    ['#C4B5FD', '#7C3AED'],
    ['#FDA4AF', '#DC2626'],
    ['#5EEAD4', '#0F766E'],
    ['#FDBA74', '#C2410C'],
    ['#A5B4FC', '#4338CA']
];

const getPaletteColor = (index: number): string => CHART_COLORS[index % CHART_COLORS.length];
const getBarGradient = (index: number): [string, string] => BAR_GRADIENTS[index % BAR_GRADIENTS.length];

const darkenHex = (hex: string, factor: number = 0.68): string => {
    const raw = hex.replace('#', '');
    if (raw.length !== 6) return hex;
    const r = Math.max(0, Math.floor(parseInt(raw.slice(0, 2), 16) * factor));
    const g = Math.max(0, Math.floor(parseInt(raw.slice(2, 4), 16) * factor));
    const b = Math.max(0, Math.floor(parseInt(raw.slice(4, 6), 16) * factor));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
    const angle = toRadians(angleDeg - 90);
    return {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle)
    };
};

const buildSectorPath = (cx: number, cy: number, r: number, startAngle: number, endAngle: number): string => {
    const start = polarToCartesian(cx, cy, r, startAngle);
    const end = polarToCartesian(cx, cy, r, endAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
};

const safePercent = (value: number): number => {
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.round(value * 10) / 10;
};

const normalizeDateKey = (value: string): string => {
    if (!value) return '';
    return value.includes('T') ? value.split('T')[0] : value;
};

const toNoonDate = (dateKey: string): Date => new Date(`${dateKey}T12:00:00`);

const isWithinRange = (dateKey: string, startDateKey: string, endDateKey: string): boolean => {
    return dateKey >= startDateKey && dateKey <= endDateKey;
};

const getWeekStartKey = (dateKey: string): string => {
    const date = toNoonDate(dateKey);
    const day = date.getDay();
    const shift = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + shift);
    return getDateKey(date);
};

const formatShortDate = (dateKey: string): string => {
    return toNoonDate(dateKey).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short'
    });
};

const truncateLabel = (label: string, maxLength: number = 12): string => {
    if (label.length <= maxLength) return label;
    return `${label.slice(0, maxLength - 1)}...`;
};

const getLogCost = (log: DailyLog): number => log.financialSummary?.grandTotal || 0;

interface ScopeSelection {
    cropId: string;
    plotIds: string[];
}

const getNonGlobalSelections = (log: DailyLog): ScopeSelection[] => {
    return (log.context?.selection || [])
        .filter(selection => selection.cropId && selection.cropId !== FARM_GLOBAL_ID)
        .map(selection => ({
            cropId: selection.cropId,
            plotIds: Array.from(new Set(selection.selectedPlotIds || []))
        }));
};

const getUniquePlotIds = (selections: ScopeSelection[]): string[] => {
    return Array.from(new Set(selections.flatMap(selection => selection.plotIds)));
};

const getScopedLogCost = (
    log: DailyLog,
    allowedCropIds: Set<string>,
    allowedPlotIds: Set<string>
): number => {
    const baseCost = getLogCost(log);
    if (baseCost <= 0) return 0;

    const allSelections = getNonGlobalSelections(log);
    if (allSelections.length === 0) return 0;

    const cropScopedSelections = allowedCropIds.size > 0
        ? allSelections.filter(selection => allowedCropIds.has(selection.cropId))
        : allSelections;
    if (cropScopedSelections.length === 0) return 0;

    const allPlotIds = getUniquePlotIds(allSelections);
    const hasPlotFilter = allowedPlotIds.size > 0;
    const hasPlotGranularity = allPlotIds.length > 0 && cropScopedSelections.some(selection => selection.plotIds.length > 0);

    if (hasPlotGranularity) {
        const scopedPlotIds = Array.from(new Set(
            cropScopedSelections.flatMap(selection => selection.plotIds)
        )).filter(plotId => !hasPlotFilter || allowedPlotIds.has(plotId));

        if (scopedPlotIds.length === 0) return 0;
        return baseCost * (scopedPlotIds.length / allPlotIds.length);
    }

    if (hasPlotFilter) return 0;
    return baseCost * (cropScopedSelections.length / allSelections.length);
};

const buildTimelinePoints = (
    logs: DailyLog[],
    range: AnalysisRange,
    costResolver: (log: DailyLog) => number = getLogCost
): SpendPoint[] => {
    if (range.bucket === 'daily') {
        const totalsByDate = new Map<string, number>();
        logs.forEach(log => {
            const key = normalizeDateKey(log.date);
            totalsByDate.set(key, (totalsByDate.get(key) || 0) + costResolver(log));
        });

        const points: SpendPoint[] = [];
        const cursor = toNoonDate(range.startDateKey);
        const end = toNoonDate(range.endDateKey);
        while (cursor <= end) {
            const key = getDateKey(cursor);
            points.push({
                key,
                label: formatShortDate(key),
                value: Math.round(totalsByDate.get(key) || 0)
            });
            cursor.setDate(cursor.getDate() + 1);
        }
        return points;
    }

    const totalsByWeek = new Map<string, number>();
    logs.forEach(log => {
        const dateKey = normalizeDateKey(log.date);
        const weekKey = getWeekStartKey(dateKey);
        totalsByWeek.set(weekKey, (totalsByWeek.get(weekKey) || 0) + costResolver(log));
    });

    const points: SpendPoint[] = [];
    const startWeekKey = getWeekStartKey(range.startDateKey);
    const endWeekKey = getWeekStartKey(range.endDateKey);
    const cursor = toNoonDate(startWeekKey);
    const end = toNoonDate(endWeekKey);

    while (cursor <= end) {
        const weekKey = getDateKey(cursor);
        points.push({
            key: weekKey,
            label: `Wk ${formatShortDate(weekKey)}`,
            value: Math.round(totalsByWeek.get(weekKey) || 0)
        });
        cursor.setDate(cursor.getDate() + 7);
    }

    return points;
};

const buildCropComparisonPoints = (
    logs: DailyLog[],
    cropIds: string[],
    cropsById: Map<string, CropProfile>,
    allowedPlotIds: Set<string>
): SpendPoint[] => {
    const selectedSet = new Set(cropIds);
    const hasPlotFilter = allowedPlotIds.size > 0;
    const totals = new Map<string, number>();

    cropIds.forEach(cropId => totals.set(cropId, 0));

    logs.forEach(log => {
        const baseCost = getLogCost(log);
        if (baseCost <= 0) return;

        const allSelections = getNonGlobalSelections(log);
        if (allSelections.length === 0) return;

        const selectedSelections = allSelections.filter(selection => selectedSet.has(selection.cropId));
        if (selectedSelections.length === 0) return;

        const allPlotIds = getUniquePlotIds(allSelections);
        const hasPlotGranularity = allPlotIds.length > 0 && selectedSelections.some(selection => selection.plotIds.length > 0);

        if (hasPlotGranularity) {
            selectedSelections.forEach(selection => {
                const matchingPlotCount = selection.plotIds.filter(plotId => !hasPlotFilter || allowedPlotIds.has(plotId)).length;
                if (matchingPlotCount <= 0) return;

                const contribution = baseCost * (matchingPlotCount / allPlotIds.length);
                totals.set(selection.cropId, (totals.get(selection.cropId) || 0) + contribution);
            });
            return;
        }

        if (hasPlotFilter) return;

        const perSelection = baseCost / allSelections.length;
        selectedSelections.forEach(selection => {
            totals.set(selection.cropId, (totals.get(selection.cropId) || 0) + perSelection);
        });
    });

    return cropIds.map(cropId => ({
        key: cropId,
        label: cropsById.get(cropId)?.name || cropId,
        value: Math.round(totals.get(cropId) || 0)
    })).sort((a, b) => b.value - a.value);
};

const buildPlotComparisonPoints = (
    logs: DailyLog[],
    plotRefs: ScopedPlotRef[]
): SpendPoint[] => {
    const allowedPlotIds = new Set(plotRefs.map(ref => ref.plotId));
    const totals = new Map<string, number>();
    plotRefs.forEach(ref => totals.set(ref.plotId, 0));

    logs.forEach(log => {
        const baseCost = getLogCost(log);
        if (baseCost <= 0) return;

        const allPlotIds = getUniquePlotIds(getNonGlobalSelections(log));
        if (allPlotIds.length === 0) return;

        const perPlotCost = baseCost / allPlotIds.length;
        allPlotIds.forEach(plotId => {
            if (!allowedPlotIds.has(plotId)) return;
            totals.set(plotId, (totals.get(plotId) || 0) + perPlotCost);
        });
    });

    return plotRefs.map(ref => ({
        key: ref.plotId,
        label: ref.plotName,
        value: Math.round(totals.get(ref.plotId) || 0)
    })).sort((a, b) => b.value - a.value);
};

const BarSpendChart: React.FC<{ points: SpendPoint[]; maxValue: number; visualsByKey: Record<string, PointVisual>; }> = ({
    points,
    maxValue,
    visualsByKey
}) => {
    const chartWidth = Math.max(360, points.length * 90);
    const showValueLabels = points.length <= 8;

    return (
        <div className="overflow-x-auto pb-1">
            <div style={{ width: `${chartWidth}px` }} className="pt-2 rounded-2xl bg-gradient-to-b from-white via-sky-50/40 to-emerald-50/30 px-3 pb-3">
                <div className="h-44 flex items-end gap-3">
                    {points.map((point, index) => {
                        const ratio = maxValue > 0 ? point.value / maxValue : 0;
                        const height = Math.max(10, Math.round(ratio * 150));
                        const [topColor, bottomColor] = getBarGradient(index);
                        const visual = visualsByKey[point.key];
                        return (
                            <div key={point.key} className="flex-1 min-w-[68px] flex flex-col items-center">
                                {showValueLabels && (
                                    <p className="text-[11px] font-black mb-1" style={{ color: bottomColor }}>
                                        Rs {formatCurrencyINR(point.value)}
                                    </p>
                                )}
                                <div
                                    className="w-full rounded-t-xl shadow-md border border-white/50"
                                    style={{
                                        height: `${height}px`,
                                        background: `linear-gradient(180deg, ${topColor} 0%, ${bottomColor} 100%)`,
                                        boxShadow: `0 8px 18px -10px ${bottomColor}`
                                    }}
                                    title={`Rs ${formatCurrencyINR(point.value)}`}
                                />
                                <div className="mt-2 flex flex-col items-center gap-1">
                                    <div className="h-6 w-6 rounded-full ring-2 ring-white shadow-sm overflow-hidden bg-white">
                                        <CropSymbol name={visual?.iconName || 'Sprout'} size="sm" />
                                    </div>
                                    <p className="text-xs font-bold text-slate-700 text-center leading-tight">{truncateLabel(point.label)}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const PieSpendChart: React.FC<{ points: SpendPoint[]; visualsByKey: Record<string, PointVisual>; }> = ({
    points,
    visualsByKey
}) => {
    const sourcePoints = points.filter(point => point.value > 0);
    const total = sourcePoints.reduce((sum, point) => sum + point.value, 0);
    const width = 720;
    const height = 360;
    const centerX = 260;
    const centerY = 174;
    const radius = 102;
    const depth = 16;

    const slices = useMemo(() => {
        if (sourcePoints.length === 0 || total <= 0) return [];

        let angleCursor = 0;
        return sourcePoints.map((point, index) => {
            const isLast = index === sourcePoints.length - 1;
            const rawSweep = isLast ? (360 - angleCursor) : ((point.value / total) * 360);
            const sweep = Math.max(3, rawSweep);
            const startAngle = angleCursor;
            const endAngle = Math.min(360, angleCursor + sweep);
            angleCursor = endAngle;

            const midAngle = (startAngle + endAngle) / 2;
            const midRad = toRadians(midAngle - 90);
            const explode = index % 3 === 0 ? 14 : 10;
            const shiftX = Math.cos(midRad) * explode;
            const shiftY = Math.sin(midRad) * explode;
            const color = getPaletteColor(index);

            const outerPoint = polarToCartesian(centerX + shiftX, centerY + shiftY, radius, midAngle);
            const calloutX = centerX + shiftX + Math.cos(midRad) * (radius + 84);
            const calloutY = centerY + shiftY + Math.sin(midRad) * (radius + 44);
            const isRight = Math.cos(midRad) >= 0;
            const percentage = safePercent((point.value / total) * 100);

            return {
                point,
                startAngle,
                endAngle,
                color,
                bottomColor: darkenHex(color, 0.64),
                shiftX,
                shiftY,
                outerPoint,
                calloutX,
                calloutY,
                isRight,
                percentage
            };
        });
    }, [sourcePoints, total]);

    return (
        <div className="overflow-x-auto pb-2">
            <div style={{ width: `${width}px`, height: `${height}px` }} className="relative rounded-2xl bg-gradient-to-b from-white via-amber-50/20 to-sky-50/20">
                <svg width={width} height={height} role="img" aria-label="3D spend pie chart with percentage breakdown">
                    <defs>
                        <filter id="pie-soft-shadow" x="-20%" y="-20%" width="140%" height="150%">
                            <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#0f172a" floodOpacity="0.18" />
                        </filter>
                    </defs>

                    {slices.map(slice => (
                        <path
                            key={`${slice.point.key}-bottom`}
                            d={buildSectorPath(centerX + slice.shiftX, centerY + slice.shiftY + depth, radius, slice.startAngle, slice.endAngle)}
                            fill={slice.bottomColor}
                            opacity="0.92"
                        />
                    ))}

                    {slices.map(slice => (
                        <path
                            key={`${slice.point.key}-top`}
                            d={buildSectorPath(centerX + slice.shiftX, centerY + slice.shiftY, radius, slice.startAngle, slice.endAngle)}
                            fill={slice.color}
                            stroke="#ffffff"
                            strokeWidth="2"
                            filter="url(#pie-soft-shadow)"
                        />
                    ))}

                    {slices.map(slice => (
                        <g key={`${slice.point.key}-connector`}>
                            <line
                                x1={slice.outerPoint.x}
                                y1={slice.outerPoint.y}
                                x2={slice.calloutX}
                                y2={slice.calloutY}
                                stroke="#475569"
                                strokeWidth="1.4"
                            />
                            <line
                                x1={slice.calloutX}
                                y1={slice.calloutY}
                                x2={slice.calloutX + (slice.isRight ? 24 : -24)}
                                y2={slice.calloutY}
                                stroke="#475569"
                                strokeWidth="1.4"
                            />
                        </g>
                    ))}
                </svg>

                {slices.map(slice => {
                    const visual = visualsByKey[slice.point.key];
                    const cardWidth = 176;
                    const left = slice.isRight
                        ? Math.min(width - cardWidth - 8, slice.calloutX + 26)
                        : Math.max(8, slice.calloutX - cardWidth - 26);
                    const top = Math.max(10, Math.min(height - 74, slice.calloutY - 34));

                    return (
                        <div
                            key={`${slice.point.key}-label`}
                            className="absolute rounded-xl border border-white/70 bg-white/95 shadow-md px-2.5 py-2 flex items-center gap-2"
                            style={{ left: `${left}px`, top: `${top}px` }}
                        >
                            <div className="h-9 w-9 rounded-full overflow-hidden ring-2 ring-white shadow-sm bg-white shrink-0">
                                <CropSymbol name={visual?.iconName || 'Sprout'} size="md" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[11px] font-black text-slate-700 truncate">{slice.point.label}</p>
                                <p
                                    className="text-xs font-black inline-block mt-0.5 px-2 py-0.5 rounded-md text-white"
                                    style={{ backgroundColor: slice.color }}
                                >
                                    {slice.percentage.toFixed(1)}%
                                </p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const CostAnalysisSection: React.FC<CostAnalysisSectionProps> = ({
    logs,
    crops,
    selectedCropIds,
    selectedPlotsByCrop,
    selectedDate,
    calendarMode
}) => {
    const [graphMode, setGraphMode] = useState<GraphMode>('total');
    const [graphType, setGraphType] = useState<GraphType>('bar');

    const analysisRange = useMemo<AnalysisRange>(() => {
        const anchor = new Date(selectedDate);

        if (calendarMode === 'week') {
            const end = new Date(anchor);
            const start = new Date(anchor);
            start.setDate(anchor.getDate() - 6);

            return {
                startDateKey: getDateKey(start),
                endDateKey: getDateKey(end),
                bucket: 'daily',
                label: `${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} - ${end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
            };
        }

        const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
        const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);

        return {
            startDateKey: getDateKey(start),
            endDateKey: getDateKey(end),
            bucket: 'weekly',
            label: anchor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
        };
    }, [selectedDate, calendarMode]);

    const cropIdList = useMemo(() => {
        const requested = selectedCropIds.length > 0
            ? selectedCropIds
            : crops.map(crop => crop.id);
        return requested.filter(cropId => cropId !== FARM_GLOBAL_ID);
    }, [selectedCropIds, crops]);

    const cropMap = useMemo(() => {
        const map = new Map<string, CropProfile>();
        crops.forEach(crop => map.set(crop.id, crop));
        return map;
    }, [crops]);

    const scopedPlotRefs = useMemo<ScopedPlotRef[]>(() => {
        const refs: ScopedPlotRef[] = [];

        cropIdList.forEach(cropId => {
            const crop = cropMap.get(cropId);
            if (!crop || !crop.plots || crop.plots.length === 0) return;

            const selectedPlotIds = selectedPlotsByCrop[cropId];
            const plotIdsToUse = selectedPlotIds && selectedPlotIds.length > 0
                ? selectedPlotIds
                : crop.plots.map(plot => plot.id);

            plotIdsToUse.forEach(plotId => {
                const plot = crop.plots.find(item => item.id === plotId);
                if (!plot) return;
                refs.push({
                    cropId,
                    cropName: crop.name,
                    cropIconName: crop.iconName,
                    plotId: plot.id,
                    plotName: plot.name
                });
            });
        });

        return refs;
    }, [cropIdList, cropMap, selectedPlotsByCrop]);

    const scopedCropIds = useMemo(() => new Set(cropIdList), [cropIdList]);
    const scopedPlotIds = useMemo(() => new Set(scopedPlotRefs.map(ref => ref.plotId)), [scopedPlotRefs]);

    const periodLogs = useMemo(() => {
        return logs.filter(log => {
            const dateKey = normalizeDateKey(log.date);
            return isWithinRange(dateKey, analysisRange.startDateKey, analysisRange.endDateKey);
        });
    }, [logs, analysisRange]);

    const totalSpendPoints = useMemo(() => {
        return buildTimelinePoints(
            periodLogs,
            analysisRange,
            log => getScopedLogCost(log, scopedCropIds, scopedPlotIds)
        );
    }, [periodLogs, analysisRange, scopedCropIds, scopedPlotIds]);

    const cropSpendPoints = useMemo(() => {
        if (cropIdList.length <= 1) {
            const cropId = cropIdList[0];
            if (!cropId) return [];

            const cropScopedPlotIds = new Set(
                scopedPlotRefs
                    .filter(ref => ref.cropId === cropId)
                    .map(ref => ref.plotId)
            );

            return buildTimelinePoints(
                periodLogs,
                analysisRange,
                log => getScopedLogCost(log, new Set([cropId]), cropScopedPlotIds)
            );
        }

        return buildCropComparisonPoints(periodLogs, cropIdList, cropMap, scopedPlotIds);
    }, [periodLogs, cropIdList, cropMap, analysisRange, scopedPlotIds, scopedPlotRefs]);

    const plotSpendPoints = useMemo(() => {
        return buildPlotComparisonPoints(periodLogs, scopedPlotRefs);
    }, [periodLogs, scopedPlotRefs]);

    const activePoints = useMemo(() => {
        if (graphMode === 'total') return totalSpendPoints;
        if (graphMode === 'crop') return cropSpendPoints;
        return plotSpendPoints;
    }, [graphMode, totalSpendPoints, cropSpendPoints, plotSpendPoints]);

    const snapshot = useMemo(() => {
        const totalCost = periodLogs.reduce(
            (sum, log) => sum + getScopedLogCost(log, scopedCropIds, scopedPlotIds),
            0
        );

        let harvestIncome = 0;
        let harvestEntryCount = 0;
        const seenSessions = new Set<string>();

        scopedPlotRefs.forEach(ref => {
            const sessions = getHarvestSessions(ref.plotId, ref.cropId);
            sessions.forEach(session => {
                if (seenSessions.has(session.id)) return;
                seenSessions.add(session.id);

                const saleIncome = (session.saleEntries || [])
                    .filter(entry => isWithinRange(
                        normalizeDateKey(entry.date),
                        analysisRange.startDateKey,
                        analysisRange.endDateKey
                    ))
                    .reduce((sum, entry) => sum + (entry.netAmount ?? entry.totalAmount ?? 0), 0);
                harvestIncome += saleIncome;

                const entries = (session.harvestEntries || []).filter(entry =>
                    isWithinRange(
                        normalizeDateKey(entry.date),
                        analysisRange.startDateKey,
                        analysisRange.endDateKey
                    )
                );
                harvestEntryCount += entries.length;
            });
        });

        const otherIncome = getOtherIncomeEntries()
            .filter(entry => {
                const dateKey = normalizeDateKey(entry.date);
                if (!isWithinRange(dateKey, analysisRange.startDateKey, analysisRange.endDateKey)) return false;
                if (entry.cropId && !scopedCropIds.has(entry.cropId)) return false;
                if (entry.plotId && scopedPlotIds.size > 0 && !scopedPlotIds.has(entry.plotId)) return false;
                return true;
            })
            .reduce((sum, entry) => sum + entry.amount, 0);

        const totalIncome = harvestIncome + otherIncome;
        const net = totalIncome - totalCost;

        return {
            totalCost,
            totalIncome,
            net,
            harvestEntryCount
        };
    }, [periodLogs, scopedPlotRefs, analysisRange, scopedCropIds, scopedPlotIds]);

    const maxValue = useMemo(() => {
        return activePoints.reduce((max, point) => Math.max(max, point.value), 0);
    }, [activePoints]);

    const topPoint = useMemo(() => {
        if (activePoints.length === 0) return null;
        return activePoints.reduce((best, point) => (point.value > best.value ? point : best), activePoints[0]);
    }, [activePoints]);

    const graphSubtitle = useMemo(() => {
        if (graphMode === 'total') return `Total spend trend for ${analysisRange.label}`;
        if (graphMode === 'crop') {
            if (cropIdList.length <= 1) return `Selected crop spend trend for ${analysisRange.label}`;
            return `Crop-wise spend comparison for ${analysisRange.label}`;
        }
        if (scopedPlotRefs.length <= 1) return `Selected plot spend view for ${analysisRange.label}`;
        return `Plot-wise spend comparison for ${analysisRange.label}`;
    }, [graphMode, analysisRange.label, cropIdList.length, scopedPlotRefs.length]);

    const xAxisLabel = useMemo(() => {
        if (graphMode === 'total') return 'Date';
        if (graphMode === 'crop') return cropIdList.length <= 1 ? 'Date' : 'Crop Names';
        return 'Plot Names';
    }, [graphMode, cropIdList.length]);

    const visualsByKey = useMemo<Record<string, PointVisual>>(() => {
        const map: Record<string, PointVisual> = {};
        const singleCropIcon = cropIdList.length === 1
            ? (cropMap.get(cropIdList[0])?.iconName || 'Sprout')
            : 'Warehouse';
        const plotRefById = new Map(scopedPlotRefs.map(ref => [ref.plotId, ref]));

        activePoints.forEach(point => {
            if (graphMode === 'crop' && cropIdList.length > 1) {
                const iconName = cropMap.get(point.key)?.iconName || 'Sprout';
                map[point.key] = { iconName };
                return;
            }

            if (graphMode === 'plot') {
                const plotRef = plotRefById.get(point.key);
                map[point.key] = { iconName: plotRef?.cropIconName || 'Sprout' };
                return;
            }

            map[point.key] = { iconName: singleCropIcon };
        });

        return map;
    }, [activePoints, graphMode, cropIdList, cropMap, scopedPlotRefs]);

    const graphTotal = useMemo(() => {
        return activePoints.reduce((sum, point) => sum + point.value, 0);
    }, [activePoints]);

    const graphEmptyState = activePoints.length === 0 || graphTotal === 0;
    const modeAccent = graphMode === 'total'
        ? { ring: 'ring-sky-200/80', text: 'text-sky-700', iconBg: 'bg-sky-100/80', iconText: 'text-sky-700' }
        : graphMode === 'crop'
            ? { ring: 'ring-amber-200/80', text: 'text-amber-700', iconBg: 'bg-amber-100/80', iconText: 'text-amber-700' }
            : { ring: 'ring-violet-200/80', text: 'text-violet-700', iconBg: 'bg-violet-100/80', iconText: 'text-violet-700' };

    return (
        <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-emerald-50/30 to-sky-50/20 p-4">
                <p className="text-xs font-black uppercase tracking-wide text-slate-600 mb-3">Yield & Cost Snapshot</p>
                <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-sky-100 bg-white/90 p-3 shadow-sm">
                        <p className="text-xs font-bold text-slate-500">Total Cost So Far</p>
                        <p className="text-lg font-black text-slate-900 mt-1">Rs {formatCurrencyINR(snapshot.totalCost)}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-100 bg-white/90 p-3 shadow-sm">
                        <p className="text-xs font-bold text-slate-500">Total Income So Far</p>
                        <p className="text-lg font-black text-slate-900 mt-1">Rs {formatCurrencyINR(snapshot.totalIncome)}</p>
                    </div>
                    <div className="rounded-xl border border-violet-100 bg-white/90 p-3 shadow-sm">
                        <p className="text-xs font-bold text-slate-500">Net</p>
                        <p className={`text-lg font-black mt-1 ${snapshot.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            Rs {formatCurrencyINR(snapshot.net)}
                        </p>
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-white/90 p-3 shadow-sm">
                        <p className="text-xs font-bold text-slate-500">Yield Entry Status</p>
                        <p className={`text-sm font-black mt-2 ${snapshot.harvestEntryCount > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {snapshot.harvestEntryCount > 0
                                ? `${snapshot.harvestEntryCount} entries logged`
                                : 'No yield entry logged'}
                        </p>
                    </div>
                </div>
            </div>

            <div className={`relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-[#f8fbff] via-white to-[#f4fbf6] p-4 ring-1 shadow-[0_16px_40px_-26px_rgba(15,23,42,0.5)] ${modeAccent.ring}`}>
                <div className="pointer-events-none absolute -top-10 -right-8 h-32 w-32 rounded-full bg-sky-200/20 blur-2xl" />
                <div className="pointer-events-none absolute -bottom-14 -left-10 h-36 w-36 rounded-full bg-violet-200/20 blur-2xl" />

                <div className="relative flex items-center justify-between gap-3 mb-3">
                    <div>
                        <h4 className="text-lg font-black text-slate-900">Cost & Analysis</h4>
                        <p className={`text-sm font-semibold ${modeAccent.text}`}>{graphSubtitle}</p>
                    </div>
                    <div className={`rounded-full p-2.5 shadow-sm ring-1 ring-white/70 ${modeAccent.iconBg} ${modeAccent.iconText}`}>
                        <BarChart3 size={18} />
                    </div>
                </div>

                <div className="relative rounded-2xl border border-white/70 bg-white/80 p-1.5 grid grid-cols-3 gap-1.5 mb-3 shadow-inner">
                    <button
                        onClick={() => setGraphMode('total')}
                        className={`rounded-xl px-3 py-2 text-xs font-black transition-all active:scale-[0.98] ${graphMode === 'total' ? 'bg-gradient-to-r from-sky-100 to-cyan-50 text-sky-700 ring-1 ring-sky-200 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        Total Spend
                    </button>
                    <button
                        onClick={() => setGraphMode('crop')}
                        className={`rounded-xl px-3 py-2 text-xs font-black transition-all active:scale-[0.98] ${graphMode === 'crop' ? 'bg-gradient-to-r from-amber-100 to-orange-50 text-amber-700 ring-1 ring-amber-200 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        Crop-wise Spend
                    </button>
                    <button
                        onClick={() => setGraphMode('plot')}
                        className={`rounded-xl px-3 py-2 text-xs font-black transition-all active:scale-[0.98] ${graphMode === 'plot' ? 'bg-gradient-to-r from-violet-100 to-indigo-50 text-violet-700 ring-1 ring-violet-200 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        Plot-wise Spend
                    </button>
                </div>

                <div className="relative flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="bg-slate-100/90 rounded-xl p-1 inline-flex ring-1 ring-white/70">
                        <button
                            onClick={() => setGraphType('bar')}
                            className={`rounded-lg px-3 py-1.5 text-xs font-black transition-all active:scale-[0.98] ${graphType === 'bar' ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-800'}`}
                        >
                            Bar
                        </button>
                        <button
                            onClick={() => setGraphType('pie')}
                            className={`rounded-lg px-3 py-1.5 text-xs font-black transition-all active:scale-[0.98] ${graphType === 'pie' ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-800'}`}
                        >
                            3D Pie
                        </button>
                    </div>
                    <p className="text-xs font-black uppercase tracking-wide text-slate-500">{analysisRange.label}</p>
                </div>

                <div className="relative grid grid-cols-2 gap-2 mb-3">
                    <div className="rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2">
                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Y-axis</p>
                        <p className="text-xs font-bold text-slate-700 mt-0.5">{graphType === 'bar' ? 'Rs Amount' : 'Expense Share %'}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2">
                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">X-axis</p>
                        <p className="text-xs font-bold text-slate-700 mt-0.5">{graphType === 'bar' ? xAxisLabel : 'Category Mix'}</p>
                    </div>
                </div>

                {graphEmptyState ? (
                    <div className="relative rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                        <p className="text-sm font-bold text-slate-600">No spending records for this selection.</p>
                        <p className="text-xs text-slate-500 mt-1">Change crop, plot, or date filter to view analysis.</p>
                    </div>
                ) : graphType === 'bar' ? (
                    <BarSpendChart points={activePoints} maxValue={maxValue} visualsByKey={visualsByKey} />
                ) : (
                    <PieSpendChart points={activePoints} visualsByKey={visualsByKey} />
                )}

                <div className="relative mt-4 rounded-xl border border-sky-100/80 bg-gradient-to-r from-sky-50 via-cyan-50/70 to-violet-50 px-3 py-2.5 shadow-sm">
                    <p className="text-sm font-bold text-slate-800">
                        {topPoint
                            ? `Highest spend: ${topPoint.label} (Rs ${formatCurrencyINR(topPoint.value)})`
                            : 'Highest spend insight will appear when data is available.'}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default CostAnalysisSection;

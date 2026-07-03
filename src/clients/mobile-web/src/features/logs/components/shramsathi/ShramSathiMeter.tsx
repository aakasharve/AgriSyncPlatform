import React, { useMemo } from 'react';
import ShramSathiFace, { ShramSathiBand } from './ShramSathiFace';

interface MeterScore {
    value: number;
}

export interface ShramSathiGap {
    id: string;
    question: string;
}

interface ShramSathiMeterProps {
    arrived: boolean;
    arrivingProgress: number;
    score?: MeterScore;
    gaps?: ShramSathiGap[];
    className?: string;
}

const marathiDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

const bandLines: Record<ShramSathiBand, string> = {
    'still-learning': 'मी आजचं समजून घेतोय. थोडं सांगाल का?',
    concerned: 'आजचं थोडं कळलं. अजून थोडं हवं.',
    neutral: 'बरंचसं कळलं. अजून थोडं सांगितलंत तर पक्कं होईल.',
    content: 'आजचं बरंचसं कळलं. एक छोटी गोष्ट विचारू का?',
    delighted: 'आजचं सगळं नीट कळलं. छान सांगितलंत!',
};

const bandLabel: Record<ShramSathiBand, string> = {
    'still-learning': 'मी शिकतोय',
    concerned: 'थोडं कळलं',
    neutral: 'बरंचसं कळलं',
    content: 'छान कळलं',
    delighted: 'सगळं नीट कळलं',
};

function clampScore(value: number | undefined): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return 0;
    }
    return Math.min(10, Math.max(0, value));
}

export function getShramSathiBand(score: number): ShramSathiBand {
    if (score <= 2) return 'still-learning';
    if (score <= 4) return 'concerned';
    if (score <= 6) return 'neutral';
    if (score <= 8) return 'content';
    return 'delighted';
}

function toMarathiNumber(value: number): string {
    return String(value)
        .split('')
        .map(char => (/\d/.test(char) ? marathiDigits[Number(char)] : char))
        .join('');
}

const ArrivingTicks: React.FC<{ progress: number }> = ({ progress }) => {
    const filled = Math.min(20, Math.max(0, Math.floor(progress)));
    return (
        <div className="grid grid-cols-10 gap-1.5" aria-label={`${filled} of 20 rich logs`}>
            {Array.from({ length: 20 }, (_, index) => (
                <span
                    key={index}
                    data-testid="shramsathi-arriving-tick"
                    className={`h-2.5 rounded-full transition-colors duration-300 ${index < filled ? 'bg-[#3DA35D]' : 'bg-[#E8E2D8]'}`}
                />
            ))}
        </div>
    );
};

const ShramSathiMeter: React.FC<ShramSathiMeterProps> = ({
    arrived,
    arrivingProgress,
    score,
    gaps = [],
    className = '',
}) => {
    const safeScore = clampScore(score?.value);
    const roundedScore = Math.round(safeScore);
    const band = getShramSathiBand(safeScore);
    const topGaps = useMemo(() => gaps.slice(0, 3), [gaps]);
    const fillPercent = `${safeScore * 10}%`;

    return (
        <section
            data-testid="shramsathi-meter"
            className={`rounded-3xl border border-[#BFE7CF] bg-[#ECFDF5] p-4 text-left shadow-sm ${className}`}
            aria-label="Shram Sathi understanding meter"
        >
            <div className="flex items-start gap-4">
                <div className="relative">
                    <div
                        className="rounded-full p-1"
                        style={{
                            background: arrived
                                ? `conic-gradient(#2E7D52 ${safeScore * 36}deg, #E8E2D8 0deg)`
                                : `conic-gradient(#3DA35D ${Math.min(20, arrivingProgress) * 18}deg, #E8E2D8 0deg)`,
                        }}
                    >
                        <ShramSathiFace band={band} arrived={arrived} arrivingProgress={arrivingProgress} />
                    </div>
                </div>

                <div className="min-w-0 flex-1 space-y-3">
                    <div className="rounded-[1.25rem] border border-[#BFE7CF] bg-white px-4 py-3 shadow-sm">
                        <p className="font-['Noto_Serif_Devanagari'] text-sm font-black text-[#2E7D52]">
                            {arrived ? bandLabel[band] : 'मी तुमची शेती समजून घेतोय'}
                        </p>
                        <p className="mt-1 font-['Noto_Sans_Devanagari'] text-sm font-semibold leading-relaxed text-[#5A3B22]">
                            {arrived ? bandLines[band] : 'रोज थोडं थोडं शिकतोय. चांगल्या नोंदींनी मी जवळ येतो.'}
                        </p>
                    </div>

                    {arrived ? (
                        <>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                    <span
                                        data-testid="shramsathi-score"
                                        className="font-['Noto_Sans_Devanagari'] text-lg font-black text-[#2E7D52]"
                                    >
                                        १० पैकी {toMarathiNumber(roundedScore)}
                                    </span>
                                    <span className="rounded-full bg-[#F5EFE3] px-2.5 py-1 text-[11px] font-black text-[#8A817C]">
                                        Shram Sathi
                                    </span>
                                </div>
                                <div className="h-3 overflow-hidden rounded-full bg-[#E8E2D8]">
                                    <div
                                        className="h-full rounded-full bg-gradient-to-r from-[#F4A93C] to-[#2E7D52] transition-[width] duration-500 ease-out"
                                        style={{ width: fillPercent }}
                                    />
                                </div>
                            </div>

                            {topGaps.length > 0 && (
                                <div className="rounded-2xl border border-[#F6C66B]/60 bg-white/75 p-3">
                                    <p className="mb-2 font-['Noto_Sans_Devanagari'] text-xs font-black text-[#8A817C]">
                                        मला अजून थोडं कळायचं आहे:
                                    </p>
                                    <div className="space-y-2">
                                        {topGaps.map(gap => (
                                            <div
                                                key={gap.id}
                                                data-testid="shramsathi-gap-question"
                                                className="rounded-xl bg-[#F5EFE3]/55 px-3 py-2 font-['Noto_Sans_Devanagari'] text-sm font-bold text-[#5A3B22]"
                                            >
                                                {gap.question}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="space-y-2">
                            <ArrivingTicks progress={arrivingProgress} />
                            <p className="font-['DM_Sans'] text-[11px] font-bold uppercase tracking-[0.16em] text-[#8A817C]">
                                {Math.min(20, Math.floor(arrivingProgress))}/20 rich logs
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
};

export default ShramSathiMeter;

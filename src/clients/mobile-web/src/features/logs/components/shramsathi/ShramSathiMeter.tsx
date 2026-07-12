import React, { useMemo } from 'react';
import { DFES_TUNING } from '../../services/dfesTuning';

/**
 * ShramSathiMeter — the Understanding Meter, re-skinned to the locked Shram Sathi
 * look: the video-A character in a cream orb with green→blue glints (matched to
 * ShramSathiUnderstanding), a green→blue arrival grid + comprehension bar, and
 * warm Devanagari copy. The older hand-drawn face is gone.
 *
 * Character note: one shared video character is used across all bands; the band
 * (still-learning → delighted) reads through colour + the Marathi line, not a
 * different face. Per-emotion clips are a later idea.
 */

export type ShramSathiBand =
    | 'still-learning'
    | 'concerned'
    | 'neutral'
    | 'content'
    | 'delighted';

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
    /** Phase 5: makes the gap/question card tappable (e.g. the combined D8 question). */
    onGapClick?: (id: string) => void;
    className?: string;
}

const CHARACTER_VIDEO = '/assets/shramsathi/shramsathi-a.mp4';

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

// green→blue system (matched to ShramSathiUnderstanding waveform).
const GREEN: [number, number, number] = [23, 163, 74];
const BLUE: [number, number, number] = [30, 86, 230];
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
const mixGB = (t: number) =>
    `rgb(${lerp(GREEN[0], BLUE[0], t)}, ${lerp(GREEN[1], BLUE[1], t)}, ${lerp(GREEN[2], BLUE[2], t)})`;

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

/**
 * MeterCharacter — the video-A character in a cream orb with green/blue glints.
 * Arriving = a "still forming" treatment (dimmed + emerald wash, progress ring);
 * arrived = full colour with the ring reflecting the day's score.
 */
const MeterCharacter: React.FC<{ arrived: boolean; progress: number; score: number }> = ({
    arrived,
    progress,
    score,
}) => {
    const ringDeg = arrived ? score * 36 : Math.min(DFES_TUNING.richDayThreshold, progress) * 18;
    const ring = arrived
        ? `conic-gradient(from -90deg, ${mixGB(0)} 0deg, ${mixGB(1)} ${ringDeg}deg, #E6EAE8 ${ringDeg}deg)`
        : `conic-gradient(from -90deg, ${mixGB(0.35)} ${ringDeg}deg, #E6EAE8 ${ringDeg}deg)`;

    return (
        <div className="sm-figure" data-testid="shramsathi-figure" data-arrived={arrived ? '1' : '0'}>
            <span className="sm-glint g1" />
            <span className="sm-glint g2" />
            <span className="sm-glint g3" />
            <span className="sm-ring" style={{ background: ring }}>
                <span className="sm-orb">
                    <video autoPlay loop muted playsInline preload="auto">
                        <source src={CHARACTER_VIDEO} type="video/mp4" />
                    </video>
                    {!arrived && <span className="sm-veil" />}
                </span>
            </span>
        </div>
    );
};

const ArrivingTicks: React.FC<{ progress: number }> = ({ progress }) => {
    const total = DFES_TUNING.richDayThreshold;
    const filled = Math.min(total, Math.max(0, Math.floor(progress)));
    return (
        <div className="grid grid-cols-10 gap-1.5" aria-label={`${filled} of ${total} rich days`}>
            {Array.from({ length: total }, (_, index) => (
                <span
                    key={index}
                    data-testid="shramsathi-arriving-tick"
                    className="h-2.5 rounded-full transition-colors duration-300"
                    style={{ background: index < filled ? mixGB(index / Math.max(1, total - 1)) : '#E6EAE8' }}
                />
            ))}
        </div>
    );
};

const METER_CSS = `
.sm-meter{ position:relative; overflow:hidden; border-radius:1.5rem; padding:1rem;
    border:1px solid #DCEAE1; text-align:left;
    background:
        radial-gradient(at 6% -8%, hsla(145,58%,96%,.85) 0, transparent 46%),
        radial-gradient(at 96% -6%, hsla(212,70%,97%,.8) 0, transparent 44%),
        #FFFFFF;
    box-shadow:0 10px 30px -18px rgba(16,74,52,.28); }

.sm-figure{ position:relative; width:96px; height:96px; flex:none;
    display:flex; align-items:center; justify-content:center; }
.sm-glint{ position:absolute; aspect-ratio:1; border-radius:9999px; pointer-events:none;
    filter:blur(9px); transform:translate(-50%,-50%); }
.sm-figure[data-arrived="1"] .sm-glint{ opacity:1; }
.sm-figure[data-arrived="0"] .sm-glint{ opacity:.35; }
.sm-glint.g1{ left:22%; top:12%; width:46%; background:radial-gradient(circle, rgba(22,178,78,.8), transparent 66%); animation:smPulseA 3.6s ease-in-out infinite; }
.sm-glint.g2{ left:86%; top:40%; width:44%; background:radial-gradient(circle, rgba(28,108,240,.78), transparent 65%); animation:smPulseB 4.6s ease-in-out .6s infinite; }
.sm-glint.g3{ left:30%; top:90%; width:42%; background:radial-gradient(circle, rgba(40,200,92,.72), transparent 64%); animation:smPulseA 4.1s ease-in-out 1.2s infinite; }

.sm-ring{ position:relative; width:92px; height:92px; border-radius:9999px; padding:3px;
    box-sizing:border-box; box-shadow:0 6px 18px -8px rgba(16,74,52,.35); }
.sm-orb{ position:relative; display:block; width:100%; height:100%; border-radius:9999px; overflow:hidden;
    background:rgb(255,246,198); box-shadow:inset 0 0 0 2px #fff, 0 0 22px rgba(16,185,129,.24);
    animation:smBreathe 5.5s ease-in-out infinite; }
.sm-orb > video{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover;
    transform:translateY(5%) scale(.96); transform-origin:center;
    -webkit-mask-image:radial-gradient(circle at 50% 45%, #000 60%, transparent 84%);
    mask-image:radial-gradient(circle at 50% 45%, #000 60%, transparent 84%); }
.sm-veil{ position:absolute; inset:0; border-radius:9999px; pointer-events:none;
    background:radial-gradient(circle at 50% 45%, rgba(23,163,74,.10), rgba(23,163,74,.34) 84%);
    mix-blend-mode:multiply; }
.sm-figure[data-arrived="0"] .sm-orb > video{ filter:grayscale(.4) brightness(.86); }

@keyframes smBreathe{ 0%,100%{ transform:scale(1) translateY(0);} 50%{ transform:scale(1.02) translateY(-2px);} }
@keyframes smPulseA{ 0%,100%{ opacity:.2; transform:translate(-50%,-50%) scale(.85);} 48%{ opacity:.9; transform:translate(-50%,-50%) scale(1.12);} }
@keyframes smPulseB{ 0%,100%{ opacity:.22; transform:translate(-50%,-50%) scale(.9);} 55%{ opacity:.95; transform:translate(-50%,-50%) scale(1.18);} }

@media (prefers-reduced-motion: reduce){
    .sm-orb,.sm-glint{ animation:none; }
}
`;

const ShramSathiMeter: React.FC<ShramSathiMeterProps> = ({
    arrived,
    arrivingProgress,
    score,
    gaps = [],
    onGapClick,
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
            className={`sm-meter ${className}`}
            aria-label="Shram Sathi understanding meter"
        >
            <style>{METER_CSS}</style>

            <div className="flex items-start gap-4">
                <MeterCharacter arrived={arrived} progress={arrivingProgress} score={safeScore} />

                <div className="min-w-0 flex-1 space-y-3">
                    <div className="rounded-[1.25rem] border border-[#DCEAE1] bg-white/85 px-4 py-3 shadow-sm">
                        <p className="font-['Noto_Serif_Devanagari'] text-sm font-black text-[#065F46]">
                            {arrived ? bandLabel[band] : 'मी तुमची शेती समजून घेतोय'}
                        </p>
                        <p className="mt-1 font-['Noto_Sans_Devanagari'] text-sm font-semibold leading-relaxed text-[#44403C]">
                            {arrived ? bandLines[band] : 'रोज थोडं थोडं शिकतोय. चांगल्या नोंदींनी मी जवळ येतो.'}
                        </p>
                    </div>

                    {arrived ? (
                        <>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                    <span
                                        data-testid="shramsathi-score"
                                        className="font-['Noto_Sans_Devanagari'] text-lg font-black text-[#065F46]"
                                    >
                                        १० पैकी {toMarathiNumber(roundedScore)}
                                    </span>
                                    <span className="rounded-full bg-[#EAF3EE] px-2.5 py-1 font-['DM_Sans'] text-[11px] font-black tracking-wide text-[#2F6B47]">
                                        Shram Sathi
                                    </span>
                                </div>
                                <div className="h-3 overflow-hidden rounded-full bg-[#E6EAE8]">
                                    <div
                                        className="h-full rounded-full transition-[width] duration-500 ease-out"
                                        style={{
                                            width: fillPercent,
                                            background: 'linear-gradient(90deg, rgb(23,163,74), rgb(30,86,230))',
                                        }}
                                    />
                                </div>
                            </div>

                            {topGaps.length > 0 && (
                                <div className="rounded-2xl border border-[#CFE4F1] bg-[#F5FAFD] p-3">
                                    <p className="mb-2 font-['Noto_Sans_Devanagari'] text-xs font-black text-[#2F6B47]">
                                        मला अजून थोडं कळायचं आहे:
                                    </p>
                                    <div className="space-y-2">
                                        {topGaps.map(gap => (
                                            <div
                                                key={gap.id}
                                                data-testid="shramsathi-gap-question"
                                                role={onGapClick ? 'button' : undefined}
                                                tabIndex={onGapClick ? 0 : undefined}
                                                onClick={onGapClick ? () => onGapClick(gap.id) : undefined}
                                                className="rounded-xl bg-white px-3 py-2 font-['Noto_Sans_Devanagari'] text-sm font-bold text-[#334155] shadow-sm ring-1 ring-[#E2ECF3]"
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
                            <p className="font-['DM_Sans'] text-[11px] font-bold uppercase tracking-[0.16em] text-[#2F6B47]">
                                {Math.min(DFES_TUNING.richDayThreshold, Math.floor(arrivingProgress))}/{DFES_TUNING.richDayThreshold} rich days
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
};

export default ShramSathiMeter;

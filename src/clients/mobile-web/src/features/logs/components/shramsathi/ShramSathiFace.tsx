import React, { useEffect, useMemo, useState } from 'react';

export type ShramSathiBand =
    | 'still-learning'
    | 'concerned'
    | 'neutral'
    | 'content'
    | 'delighted';

interface ShramSathiFaceProps {
    band: ShramSathiBand;
    arrived: boolean;
    arrivingProgress: number;
}

const ART_BASE = '/assets/shramsathi';

const bandAccent: Record<ShramSathiBand, string> = {
    'still-learning': '#F6C66B',
    concerned: '#F4A93C',
    neutral: '#9CCBA8',
    content: '#4CAF7D',
    delighted: '#2E7D52',
};

const mouthPath: Record<ShramSathiBand, string> = {
    'still-learning': 'M57 88 Q70 80 83 88',
    concerned: 'M58 89 Q70 91 82 89',
    neutral: 'M58 88 Q70 89 82 88',
    content: 'M56 86 Q70 99 84 86',
    delighted: 'M55 85 Q70 105 85 85',
};

const eyeShape: Record<ShramSathiBand, React.ReactNode> = {
    'still-learning': (
        <>
            <circle cx="55" cy="70" r="4.8" fill="#2F241C" />
            <circle cx="85" cy="70" r="4.8" fill="#2F241C" />
        </>
    ),
    concerned: (
        <>
            <ellipse cx="55" cy="70" rx="5" ry="3.8" fill="#2F241C" />
            <ellipse cx="85" cy="70" rx="5" ry="3.8" fill="#2F241C" />
        </>
    ),
    neutral: (
        <>
            <ellipse cx="55" cy="70" rx="5" ry="4.2" fill="#2F241C" />
            <ellipse cx="85" cy="70" rx="5" ry="4.2" fill="#2F241C" />
        </>
    ),
    content: (
        <>
            <path d="M50 69 Q55 65 60 69" stroke="#2F241C" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M80 69 Q85 65 90 69" stroke="#2F241C" strokeWidth="3" fill="none" strokeLinecap="round" />
        </>
    ),
    delighted: (
        <>
            <path d="M50 68 Q55 63 61 68" stroke="#2F241C" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M79 68 Q85 63 91 68" stroke="#2F241C" strokeWidth="3" fill="none" strokeLinecap="round" />
        </>
    ),
};

function useOptionalRaster(src: string): string | null {
    const [resolved, setResolved] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setResolved(null);

        if (typeof fetch !== 'function') {
            return;
        }

        fetch(src, { method: 'HEAD' })
            .then(response => {
                if (!cancelled && response.ok) {
                    setResolved(src);
                }
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [src]);

    return resolved;
}

const PlaceholderFace: React.FC<ShramSathiFaceProps> = ({ band, arrived, arrivingProgress }) => {
    const accent = arrived ? bandAccent[band] : '#4CAF7D';
    const silhouetteOpacity = Math.min(0.55, 0.22 + arrivingProgress / 60);

    return (
        <svg
            viewBox="0 0 140 140"
            role="img"
            aria-label={arrived ? `Shram Sathi ${band}` : 'Shram Sathi arriving'}
            className="h-full w-full"
        >
            <defs>
                <linearGradient id="shramsathi-turban" x1="20" x2="120" y1="24" y2="68" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#FFF9EE" />
                    <stop offset="1" stopColor="#F5EFE3" />
                </linearGradient>
                <linearGradient id="shramsathi-silhouette" x1="32" x2="108" y1="20" y2="124" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#4CAF7D" stopOpacity="0.38" />
                    <stop offset="1" stopColor="#2E7D52" stopOpacity="0.18" />
                </linearGradient>
            </defs>

            {!arrived && (
                <>
                    <path
                        d="M31 122 C35 98 48 88 70 88 C92 88 105 98 109 122 Z"
                        fill="url(#shramsathi-silhouette)"
                        opacity={silhouetteOpacity}
                    />
                    <path
                        d="M34 61 C35 35 51 20 70 20 C91 20 106 36 106 61 C106 85 91 101 70 101 C49 101 34 85 34 61 Z"
                        fill="url(#shramsathi-silhouette)"
                        stroke="#4CAF7D"
                        strokeWidth="3"
                        opacity={silhouetteOpacity}
                    />
                    <path d="M44 39 C56 21 87 20 99 39 C82 35 63 35 44 39 Z" fill="#F5EFE3" opacity="0.58" />
                    <path d="M70 32 C77 25 86 24 92 30 C86 37 78 39 70 32 Z" fill="#3DA35D" opacity="0.76" />
                    <path d="M22 68 C45 51 95 51 118 68" stroke="#ECFDF5" strokeWidth="7" strokeLinecap="round" opacity="0.7">
                        <animate attributeName="stroke-dasharray" values="0 150;70 150;0 150" dur="2.6s" repeatCount="indefinite" />
                    </path>
                </>
            )}

            {arrived && (
                <>
                    <path d="M30 124 C35 98 48 87 70 87 C92 87 105 98 110 124 Z" fill="#2E7D52" />
                    <path d="M43 102 C50 112 90 112 97 102 L104 124 H36 Z" fill="#4CAF7D" opacity="0.55" />
                    <ellipse cx="70" cy="63" rx="38" ry="43" fill="#C98A5E" />
                    <path d="M35 56 C35 35 50 24 70 24 C91 24 105 36 105 56 C87 50 53 50 35 56 Z" fill="url(#shramsathi-turban)" />
                    <path d="M38 48 C51 39 88 39 102 48" stroke="#E8E2D8" strokeWidth="6" strokeLinecap="round" />
                    <path d="M70 35 C77 27 87 27 94 34 C87 43 77 43 70 35 Z" fill="#3DA35D" />
                    <path d="M42 55 C46 43 55 38 69 38 C83 38 94 43 99 55" stroke="#F5EFE3" strokeWidth="7" fill="none" strokeLinecap="round" />
                    <path d="M47 62 Q55 57 62 61" stroke="#5A3B22" strokeWidth="3" fill="none" strokeLinecap="round" />
                    <path d={band === 'concerned' ? 'M78 60 Q87 54 94 61' : 'M78 61 Q86 57 94 62'} stroke="#5A3B22" strokeWidth="3" fill="none" strokeLinecap="round" />
                    {eyeShape[band]}
                    <path d="M58 80 Q70 76 82 80 Q70 87 58 80 Z" fill="#2F241C" />
                    <path d={mouthPath[band]} stroke="#5A3B22" strokeWidth="3.5" fill={band === 'delighted' ? '#F5EFE3' : 'none'} strokeLinecap="round" />
                    <circle cx="40" cy="80" r="5" fill="#A86A42" opacity="0.2" />
                    <circle cx="100" cy="80" r="5" fill="#A86A42" opacity="0.2" />
                    <circle cx="112" cy="36" r="7" fill={accent} opacity="0.16" />
                    {band === 'delighted' && (
                        <path d="M113 20 L117 31 L128 35 L117 39 L113 50 L109 39 L98 35 L109 31 Z" fill="#F2C14E" />
                    )}
                </>
            )}
        </svg>
    );
};

const ShramSathiFace: React.FC<ShramSathiFaceProps> = (props) => {
    const rasterPath = useMemo(() => {
        if (!props.arrived) {
            return `${ART_BASE}/silhouette@2x.png`;
        }
        return `${ART_BASE}/face-${props.band}@2x.png`;
    }, [props.arrived, props.band]);
    const rasterSrc = useOptionalRaster(rasterPath);

    return (
        <div
            data-testid="shramsathi-face"
            data-band={props.arrived ? props.band : 'silhouette'}
            className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full bg-[#ECFDF5] shadow-sm ring-1 ring-[#E8E2D8]"
        >
            {rasterSrc ? (
                <img src={rasterSrc} alt="" className="h-full w-full object-contain" />
            ) : (
                <PlaceholderFace {...props} />
            )}
        </div>
    );
};

export default ShramSathiFace;

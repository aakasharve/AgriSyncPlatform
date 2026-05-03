import React, { useCallback, useRef, useState, useEffect } from 'react';
import { GoogleMap, useJsApiLoader, DrawingManager, Polygon } from '@react-google-maps/api';
import { PlotGeoData, GeoPoint } from '../../types';
import { Eraser, Navigation, Undo, Check, MousePointerClick, Hand, PenTool, MousePointer2, GripHorizontal, BarChart3 } from 'lucide-react';
import { getGoogleMapsApiKey, GOOGLE_MAPS_LIBRARIES, GOOGLE_MAPS_SCRIPT_ID } from './googleMapsConfig';

interface PlotMapProps {
    existingGeoData?: PlotGeoData;
    onPlotComplete: (geoData: PlotGeoData) => void;
    isReadOnly?: boolean;
    /** When provided, a "Save & finish" button appears in the sticky bottom bar. */
    onDone?: () => void;
}

const containerStyle = {
    width: '100%',
    height: '100%',
    minHeight: '320px',
};

const defaultCenter = {
    lat: 18.5204, // Pune/Generic default
    lng: 73.8567
};

const MapUnavailableState: React.FC<{ existingGeoData?: PlotGeoData }> = ({ existingGeoData }) => (
    <div className="h-96 w-full bg-amber-50 rounded-2xl flex flex-col items-center justify-center p-6 text-center border-2 border-amber-100">
        <span className="text-amber-700 font-bold text-lg mb-2">Map unavailable in this build</span>
        <p className="text-sm text-amber-700 max-w-md">
            Google Maps is disabled until a production maps key is explicitly approved for launch.
            Plot creation still works without boundary mapping.
        </p>
        {existingGeoData?.boundary?.length ? (
            <p className="text-xs text-amber-800 mt-4 bg-white p-2 rounded border border-amber-200 font-medium">
                Existing mapped boundary preserved. Re-enable maps later to edit it.
            </p>
        ) : null}
    </div>
);

const PlotMapWithGoogleMaps: React.FC<PlotMapProps & { mapsApiKey: string }> = ({ existingGeoData, onPlotComplete, isReadOnly = false, onDone, mapsApiKey }) => {
    const { isLoaded, loadError } = useJsApiLoader({
        id: GOOGLE_MAPS_SCRIPT_ID,
        googleMapsApiKey: mapsApiKey,
        libraries: GOOGLE_MAPS_LIBRARIES
    });

    const [map, setMap] = useState<google.maps.Map | null>(null);
    const [polygonPath, setPolygonPath] = useState<GeoPoint[]>(existingGeoData?.boundary || []);

    // UI States
    const [isDrawingActive, setIsDrawingActive] = useState(false);
    const [activeTool, setActiveTool] = useState<'pointer' | 'hand' | 'draw'>('hand'); // Default to hand (pan)
    const [areaInfo, setAreaInfo] = useState<{ acres: number, gunthas: number }>({ acres: 0, gunthas: 0 });

    // Toolbar Drag State
    const [toolbarPos, setToolbarPos] = useState({ x: 0, y: 0 }); // Relative offset
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const initialPosRef = useRef({ x: 0, y: 0 });

    const polygonRef = useRef<google.maps.Polygon | null>(null);
    const drawingManagerRef = useRef<google.maps.drawing.DrawingManager | null>(null);

    // Initial Load
    const onLoad = useCallback((map: google.maps.Map) => {
        setMap(map);
        if (existingGeoData?.center) {
            map.setCenter(existingGeoData.center);
            map.setZoom(19);
        } else {
            locateUser(map);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: `onLoad` is the GoogleMaps `onLoad` callback — invoked once per map mount; including the non-memoized `locateUser` would re-create the callback on every render and force GoogleMaps to re-bind the load handler unnecessarily.
    }, [existingGeoData]);

    const onUnmount = useCallback(() => {
        setMap(null);
    }, []);

    // --- GEOMETRY HELPERS ---

    const calculateArea = (path: GeoPoint[]) => {
        if (!window.google || path.length < 3) return { acres: 0, gunthas: 0 };
        const googlePath = path.map(p => new window.google.maps.LatLng(p.lat, p.lng));
        const areaSqMeters = window.google.maps.geometry.spherical.computeArea(googlePath);

        // 1 Acre = 4046.86 sq meters
        // 1 Acre = 40 Gunthas
        const acres = areaSqMeters / 4046.86;
        const gunthas = acres * 40;

        return { acres, gunthas };
    };

    const computeCenter = (path: GeoPoint[]): GeoPoint => {
        if (path.length === 0) return defaultCenter;
        let latSum = 0;
        let lngSum = 0;
        path.forEach(p => {
            latSum += p.lat;
            lngSum += p.lng;
        });
        return {
            lat: latSum / path.length,
            lng: lngSum / path.length
        };
    };

    // --- ACTIONS ---

    const locateUser = (mapInstance: google.maps.Map | null = map) => {
        if (navigator.geolocation && mapInstance) {
            navigator.geolocation.getCurrentPosition((position) => {
                const pos = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                };
                mapInstance.setCenter(pos);
                mapInstance.setZoom(19);
                new window.google.maps.Marker({
                    position: pos,
                    map: mapInstance,
                    title: "You are here",
                    icon: {
                        path: window.google.maps.SymbolPath.CIRCLE,
                        scale: 8,
                        fillColor: "#3B82F6",
                        fillOpacity: 1,
                        strokeColor: "white",
                        strokeWeight: 2,
                    }
                });
            });
        }
    };

    const handlePolygonComplete = (poly: google.maps.Polygon) => {
        const path = poly.getPath();
        const newPath: GeoPoint[] = [];
        for (let i = 0; i < path.getLength(); i++) {
            const point = path.getAt(i);
            newPath.push({ lat: point.lat(), lng: point.lng() });
        }

        setPolygonPath(newPath);
        poly.setMap(null); // Remove original drawn poly, replace with our controlled one

        // Stop drawing mode but keep 'Draw' tool active conceptually
        if (drawingManagerRef.current) {
            drawingManagerRef.current.setDrawingMode(null);
        }
        setActiveTool('pointer'); // Auto switch to pointer after drawing shape

        const areas = calculateArea(newPath);
        const center = computeCenter(newPath);
        setAreaInfo(areas);

        onPlotComplete({
            boundary: newPath,
            center,
            calculatedAreaAcres: areas.acres,
            drawnAt: new Date().toISOString()
        });
    };

    const clearMap = () => {
        setPolygonPath([]);
        setAreaInfo({ acres: 0, gunthas: 0 });
        if (drawingManagerRef.current) {
            drawingManagerRef.current.setDrawingMode(null);
        }
        setIsDrawingActive(false);
        setActiveTool('hand');

        onPlotComplete({
            boundary: [],
            center: defaultCenter,
            calculatedAreaAcres: 0,
            drawnAt: new Date().toISOString()
        });
    };

    const startDrawingFlow = () => {
        setPolygonPath([]); // Clear existing
        setIsDrawingActive(true);
        setActiveTool('draw'); // Default to draw tool
    };

    // --- DRAG HANDLERS ---
    const handlePointerDown = (e: React.PointerEvent) => {
        setIsDragging(true);
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        initialPosRef.current = { ...toolbarPos };
        // Capture pointer to track even if mouse leaves div
        (e.target as Element).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;

        setToolbarPos({
            x: initialPosRef.current.x + dx,
            y: initialPosRef.current.y + dy
        });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        setIsDragging(false);
        (e.target as Element).releasePointerCapture(e.pointerId);
    };


    // Effect to Sync Active Tool with Google Maps
    useEffect(() => {
        if (!map || !drawingManagerRef.current) return;

        if (activeTool === 'draw') {
            drawingManagerRef.current.setDrawingMode(window.google.maps.drawing.OverlayType.POLYGON);
            map.setOptions({
                draggable: true,
                gestureHandling: 'cooperative',
                draggableCursor: 'crosshair', // Distinct cursor for drawing
            });
        } else if (activeTool === 'hand') {
            drawingManagerRef.current.setDrawingMode(null);
            map.setOptions({
                draggable: true,
                gestureHandling: 'greedy',
                draggableCursor: 'grab',
                draggingCursor: 'grabbing'
            }); // Pan mode
        } else if (activeTool === 'pointer') {
            drawingManagerRef.current.setDrawingMode(null);
            map.setOptions({
                draggable: true,
                gestureHandling: 'cooperative',
                draggableCursor: 'default'
            }); // Select mode
        }

    }, [activeTool, map]);


    // calculate area on mount/change if existing data
    useEffect(() => {
        if (polygonPath.length > 0) {
            setAreaInfo(calculateArea(polygonPath));
            setIsDrawingActive(true); // If data exists, enter "Edit" mode effectively
            setActiveTool('pointer');
        }
    }, [polygonPath]);


    if (loadError) {
        return (
            <div className="h-96 w-full bg-red-50 rounded-2xl flex flex-col items-center justify-center p-6 text-center border-2 border-red-100">
                <span className="text-red-500 font-bold text-lg mb-2">Map Failed to Load</span>
                <p className="text-sm text-red-400">Please check your internet connection or API Key.</p>
                <p className="text-xs text-slate-400 mt-4 bg-white p-2 rounded border border-slate-100 font-mono">
                    {loadError.message}
                </p>
            </div>
        );
    }

    if (!isLoaded) {
        return <div className="h-96 w-full bg-slate-100 animate-pulse rounded-2xl flex items-center justify-center text-slate-400 font-bold">Loading Maps...</div>;
    }

    const hasPolygon = polygonPath.length > 0;

    return (
        <div className="flex flex-col h-full bg-slate-50 relative overflow-hidden">

            {/* Map Canvas — full-bleed, overlays handle all controls */}
            <div className="flex-1 relative min-h-[320px] h-full w-full">
                <GoogleMap
                    mapContainerStyle={containerStyle}
                    center={defaultCenter}
                    zoom={18}
                    onLoad={onLoad}
                    onUnmount={onUnmount}
                    options={{
                        mapTypeId: 'hybrid',
                        disableDefaultUI: true, // We want custom clean UI
                        zoomControl: true,
                        zoomControlOptions: { position: 9 }, // Right Bottom
                        tilt: 0,
                        gestureHandling: 'greedy'
                    }}
                >
                    {polygonPath.length > 0 && (
                        <Polygon
                            paths={polygonPath}
                            options={{
                                fillColor: "#10B981", // Emerald 500
                                fillOpacity: 0.45,    // Increased opacity
                                strokeColor: "#ffffff", // Pure White for High Contrast
                                strokeWeight: 4,      // Thicker stroke
                                clickable: activeTool === 'pointer',
                                editable: !isReadOnly && activeTool === 'pointer', // Only editable in pointer mode
                                draggable: false,
                                zIndex: 10
                            }}
                            onMouseUp={() => {
                                // Re-calc on edit handled by listeners below
                            }}
                            onLoad={(polygon) => {
                                polygonRef.current = polygon;
                                const path = polygon.getPath();
                                ['set_at', 'insert_at', 'remove_at'].forEach(event => {
                                    path.addListener(event, () => {
                                        const newPathArr: GeoPoint[] = [];
                                        for (let i = 0; i < path.getLength(); i++) {
                                            const p = path.getAt(i);
                                            newPathArr.push({ lat: p.lat(), lng: p.lng() });
                                        }
                                        setPolygonPath(newPathArr);
                                        const areas = calculateArea(newPathArr);
                                        const center = computeCenter(newPathArr);
                                        setAreaInfo(areas);
                                        onPlotComplete({
                                            boundary: newPathArr,
                                            center,
                                            calculatedAreaAcres: areas.acres,
                                            drawnAt: new Date().toISOString()
                                        });
                                    });
                                });
                            }}
                        />
                    )}

                    {!isReadOnly && (
                        <DrawingManager
                            onLoad={manager => drawingManagerRef.current = manager}
                            onPolygonComplete={handlePolygonComplete}
                            drawingMode={activeTool === 'draw' ? window.google.maps.drawing.OverlayType.POLYGON : null}
                            options={{
                                drawingControl: false, // Custom toolbar
                                polygonOptions: {
                                    fillColor: "#10B981",
                                    fillOpacity: 0.45,
                                    strokeColor: "#ffffff", // White Stroke
                                    strokeWeight: 4,        // Thicker
                                    clickable: true,
                                    editable: true,
                                    zIndex: 10,
                                },
                            }}
                        />
                    )}
                </GoogleMap>

                {/* --- CUSTOM DRAGGABLE TOOLBAR --- */}
                {isDrawingActive && !isReadOnly && (
                    <div
                        style={{
                            transform: `translate(${toolbarPos.x}px, ${toolbarPos.y}px)`,
                            top: '20px',
                            left: '50%',
                            marginLeft: '-75px', // Approx half width to center initially (approx) - logic handled by relative transform
                            position: 'absolute',
                            touchAction: 'none' // Important for pointer events
                        }}
                        className="flex flex-col items-center z-30"
                    >
                        {/* Draggable Handle */}
                        <div
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerLeave={handlePointerUp} // Safety net
                            className="bg-slate-800 text-slate-400 rounded-t-lg px-6 py-1 cursor-grab active:cursor-grabbing shadow-sm flex items-center justify-center w-full"
                        >
                            <GripHorizontal size={16} />
                        </div>

                        <div className="bg-white rounded-b-xl rounded-t-none shadow-xl border border-slate-200 p-1.5 flex gap-1 z-30 font-sans">
                            <button
                                onClick={() => setActiveTool('pointer')}
                                className={`p-3 rounded-full transition-all flex items-center justify-center ${activeTool === 'pointer' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
                                title="Select / Edit"
                            >
                                <MousePointer2 size={20} />
                            </button>
                            <button
                                onClick={() => setActiveTool('hand')}
                                className={`p-3 rounded-full transition-all flex items-center justify-center ${activeTool === 'hand' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
                                title="Pan Map"
                            >
                                <Hand size={20} />
                            </button>
                            <button
                                onClick={() => {
                                    if (polygonPath.length > 0 && activeTool !== 'draw') {
                                        if (confirm("Start new shape? This will clear current boundary.")) {
                                            setPolygonPath([]);
                                            setActiveTool('draw');
                                        }
                                    } else {
                                        setActiveTool('draw');
                                    }
                                }}
                                className={`p-3 rounded-full transition-all flex items-center justify-center ${activeTool === 'draw' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
                                title="Draw Boundary"
                            >
                                <PenTool size={20} />
                            </button>
                        </div>
                    </div>
                )}

                {/* Floating GPS Button (Top Right of Map Canvas) */}
                {!isReadOnly && (
                    <button
                        onClick={() => locateUser()}
                        className="absolute top-4 right-4 bg-white text-slate-700 p-3 rounded-full shadow-lg border border-slate-200 z-10 active:scale-95 transition-transform"
                        title="Locate Me"
                    >
                        <Navigation size={22} className="fill-blue-500 text-blue-600" />
                    </button>
                )}

                {/* Floating Area Pill (Bottom Left of Map Canvas) — only when polygon is set */}
                {hasPolygon && (
                    <div className="absolute bottom-4 left-4 z-20 bg-white rounded-2xl shadow-xl border border-slate-200 p-2.5 pr-4 flex items-center gap-3">
                        <div className="bg-emerald-50 w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0">
                            <BarChart3 size={20} className="text-emerald-600" />
                        </div>
                        <div className="leading-tight">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Total area</p>
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-xl font-black text-slate-900 tracking-tight">{areaInfo.acres.toFixed(2)}</span>
                                <span className="text-xs font-bold text-slate-500">Acres</span>
                            </div>
                            <p className="text-[11px] text-emerald-600 font-medium">≈ {areaInfo.gunthas.toFixed(1)} Guntha</p>
                        </div>
                    </div>
                )}

                {/* Attribution */}
                <div className="absolute bottom-1 right-2 bg-black/30 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] text-white z-0 pointer-events-none">
                    Map ©2025 Google
                </div>
            </div>

            {/* Sticky Bottom Action Bar — safe-area aware */}
            {!isReadOnly && (
                <div
                    className="flex-shrink-0 bg-white border-t border-slate-100 px-4 pt-3"
                    style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
                >
                    {!hasPolygon ? (
                        <button
                            onClick={startDrawingFlow}
                            className="w-full h-12 bg-slate-900 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg hover:bg-slate-800 active:scale-95 transition-all text-base"
                        >
                            <MousePointerClick size={20} /> {isDrawingActive ? 'Tap map to draw…' : 'Start drawing'}
                        </button>
                    ) : (
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={startDrawingFlow}
                                className="h-12 bg-white border-2 border-slate-200 text-slate-700 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-slate-50 active:scale-95 transition-all text-sm"
                            >
                                <Undo size={18} /> Redraw
                            </button>
                            {onDone ? (
                                <button
                                    onClick={onDone}
                                    className="h-12 bg-emerald-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 hover:bg-emerald-700 active:scale-95 transition-all text-sm"
                                >
                                    <Check size={18} /> Save &amp; finish
                                </button>
                            ) : (
                                <button
                                    onClick={clearMap}
                                    className="h-12 bg-red-50 text-red-600 font-bold rounded-xl flex items-center justify-center gap-2 border border-red-100 hover:bg-red-100 active:scale-95 transition-all text-sm"
                                >
                                    <Eraser size={18} /> Clear
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export const GooglePlotMap: React.FC<PlotMapProps> = (props) => {
    const mapsApiKey = getGoogleMapsApiKey();
    if (!mapsApiKey) {
        return <MapUnavailableState existingGeoData={props.existingGeoData} />;
    }

    return <PlotMapWithGoogleMaps {...props} mapsApiKey={mapsApiKey} />;
};

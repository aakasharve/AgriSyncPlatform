/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OnboardingPermissionsPage — redesigned permission onboarding screen.
 * Soft glass cards, vector farmland landscape, and pointing farmer integrated 
 * with bottom action bar. Custom typography and slide animations on mount.
 */
import React, { useState, useEffect } from 'react';
import { Shield, MapPin, Mic, Camera, HardDrive, CheckCircle2, ChevronRight, Lock } from 'lucide-react';
import { useUiPref } from '../shared/hooks/useUiPref';
import GlassBackdrop from './onboarding/GlassBackdrop';
import FarmerIllustration from './onboarding/FarmerIllustration';

interface OnboardingPermissionsPageProps {
     onComplete: () => void;
}

const OnboardingPermissionsPage: React.FC<OnboardingPermissionsPageProps> = ({ onComplete }) => {
     const [, setPermissionsGranted] = useUiPref<boolean>('shramsafal_permissions_granted', false);
     const [imgFailed, setImgFailed] = useState(false);
     const [mounted, setMounted] = useState(false);

     const [permissions, setPermissions] = useState({
          location: false,
          microphone: false,
          camera: false,
     });

     const checkPermissions = async () => {
          try {
               const loc = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
               const mic = await navigator.permissions.query({ name: 'microphone' as PermissionName });
               const cam = await navigator.permissions.query({ name: 'camera' as PermissionName });
               setPermissions({
                    location: loc.state === 'granted',
                    microphone: mic.state === 'granted',
                    camera: cam.state === 'granted',
               });
          } catch (e) {
               console.warn('Permissions query not fully supported', e);
          }
     };

     useEffect(() => {
          checkPermissions();
          const timer = setTimeout(() => setMounted(true), 50);
          return () => clearTimeout(timer);
     }, []);

     const requestAllPermissions = async () => {
          try {
               try {
                    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    micStream.getTracks().forEach((track) => track.stop());
               } catch (e) {
                    console.warn('Microphone permission denied', e);
               }
               try {
                    const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
                    camStream.getTracks().forEach((track) => track.stop());
               } catch (e) {
                    console.warn('Camera permission denied', e);
               }
               try {
                    if ('geolocation' in navigator) {
                         await new Promise((resolve) => {
                              navigator.geolocation.getCurrentPosition(resolve, resolve);
                         });
                    }
               } catch (e) {
                    console.warn('Location permission denied', e);
               }
               setPermissionsGranted(true);
               onComplete();
          } catch (error) {
               console.error('Error requesting permissions', error);
               setPermissionsGranted(true);
               onComplete();
          }
     };

     const skipOrSave = () => {
          setPermissionsGranted(true);
          onComplete();
     };

     const CARDS = [
          { 
               id: 'location',
               icon: <MapPin size={20} />, 
               tint: 'from-emerald-500/10 to-emerald-600/20 text-emerald-700 border-emerald-500/20', 
               mr: 'स्थान', 
               en: 'Location', 
               desc: 'शेतीची मांडणी नकाशावर दाखवण्यासाठी आणि GPS पुरावा जोडण्यासाठी.', 
               granted: permissions.location 
          },
          { 
               id: 'microphone',
               icon: <Mic size={20} />, 
               tint: 'from-sky-500/10 to-sky-600/20 text-sky-700 border-sky-500/20', 
               mr: 'मायक्रोफोन', 
               en: 'Microphone', 
               desc: 'आवाजातून कामाची नोंद करण्यासाठी आणि बोलून सांगण्यासाठी.', 
               granted: permissions.microphone 
          },
          { 
               id: 'camera',
               icon: <Camera size={20} />, 
               tint: 'from-amber-500/10 to-amber-600/20 text-amber-700 border-amber-500/20', 
               mr: 'कॅमेरा', 
               en: 'Camera', 
               desc: 'पावत्या, खते, कीड-रोग यांचे फोटो घेण्यासाठी.', 
               granted: permissions.camera 
          },
          { 
               id: 'storage',
               icon: <HardDrive size={20} />, 
               tint: 'from-violet-500/10 to-violet-600/20 text-violet-700 border-violet-500/20', 
               mr: 'साठवण', 
               en: 'Storage', 
               desc: 'नोंदी, फोटो आणि माहिती सुरक्षितपणे फोनमध्ये जतन करण्यासाठी.',
               granted: true // Browser offline Dexie storage is always available
          },
     ];

     return (
          <div className="fixed inset-0 z-[100] flex flex-col justify-between overflow-hidden bg-[#FFF9EC] pb-safe-area pt-safe-area select-none">
               <style>{`
                    @keyframes slide-in-left {
                         from { transform: translateX(-20px); opacity: 0; }
                         to { transform: translateX(0); opacity: 1; }
                    }
                    .stagger-card {
                         opacity: 0;
                         animation: slide-in-left 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
                    }
                    @keyframes float-farmer {
                         0%, 100% { transform: translateY(0); }
                         50% { transform: translateY(-5px); }
                    }
                    .animate-float-farmer {
                         animation: float-farmer 4s ease-in-out infinite;
                    }
               `}</style>

               {/* Background vector scene (washed/faded for text legibility) */}
               <GlassBackdrop faded={true} />

               {/* HEADER: Shield Badge & Text */}
               <div className={`relative z-10 px-6 pt-6 transition-all duration-700 transform ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
                    <div className="mx-auto w-full max-w-[440px]">
                         <div className="flex items-center gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/60 bg-emerald-600/10 text-emerald-700 shadow-sm backdrop-blur-md">
                                   <Shield size={20} />
                              </div>
                              <h1 className="text-[21px] font-black leading-tight text-emerald-950" style={{ fontFamily: 'var(--font-serif)' }}>
                                   परवानग्या हव्यात
                              </h1>
                         </div>
                         <p className="mt-2.5 text-[13.5px] font-semibold leading-relaxed text-slate-600" style={{ fontFamily: 'var(--font-sans)' }}>
                              सुरक्षित अनुभवासाठी आणि Shram Safal नीट चालण्यासाठी खालील परवानग्यांची आवश्यकता आहे.
                         </p>
                    </div>
               </div>

               {/* LIST ZONE: Permission Cards (centred to fill the space) */}
               <div className="relative z-10 flex flex-1 flex-col justify-center overflow-y-auto px-6 py-4 scrollbar-hide">
                    <div className="mx-auto w-full max-w-[440px] space-y-3.5">
                         {CARDS.map((c, idx) => (
                              <div
                                   key={c.id}
                                   className="flex items-center gap-3.5 rounded-[20px] border border-white/60 bg-white/45 p-4 shadow-[0_10px_26px_-12px_rgba(6,78,59,0.2)] backdrop-blur-xl ring-1 ring-white/20 stagger-card"
                                   style={{ animationDelay: `${idx * 100 + 100}ms` }}
                              >
                                   <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br border ${c.tint}`}>
                                        {c.icon}
                                   </span>
                                   <div className="min-w-0 flex-1">
                                        <p className="text-[14.5px] font-bold text-slate-800" style={{ fontFamily: 'var(--font-sans)' }}>
                                             {c.mr} <span className="text-[11.5px] font-bold text-slate-400">({c.en})</span>
                                        </p>
                                        <p className="mt-0.5 text-[11.5px] font-semibold leading-snug text-slate-500" style={{ fontFamily: 'var(--font-sans)' }}>
                                             {c.desc}
                                        </p>
                                   </div>
                                   <div className="flex-shrink-0 pl-1">
                                        {c.granted ? (
                                             <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                                                  <CheckCircle2 size={16} />
                                             </div>
                                        ) : (
                                             <ChevronRight size={18} className="text-slate-400" />
                                        )}
                                   </div>
                              </div>
                         ))}
                    </div>
               </div>

               {/* ACTIONS DOCK: Farmer Overlap & CTA Buttons */}
               <div className="relative z-20 px-6 pb-6 pt-2">
                    <div className="mx-auto w-full max-w-[440px] relative">
                         
                         {/* Pointing Farmer overlapping actions dock */}
                         <div className={`absolute -right-2 bottom-[82px] z-10 pointer-events-none transition-all duration-1000 delay-300 transform ${mounted ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'}`}>
                              <div className="animate-float-farmer">
                                   {imgFailed ? (
                                        <FarmerIllustration className="h-36 w-auto drop-shadow-[0_12px_20px_rgba(6,78,59,0.2)]" />
                                   ) : (
                                        <img 
                                             src="/brand/farmer-point.webp" 
                                             alt="Pointing Farmer" 
                                             onError={() => setImgFailed(true)} 
                                             className="h-44 w-auto object-contain drop-shadow-[0_14px_24px_rgba(6,78,59,0.22)]" 
                                        />
                                   )}
                              </div>
                         </div>

                         {/* Actions Frosted Panel */}
                         <div className={`rounded-[28px] border border-white/60 bg-white/35 p-3.5 shadow-[0_14px_36px_-12px_rgba(6,78,59,0.22)] ring-1 ring-white/20 backdrop-blur-xl transition-all duration-700 delay-400 transform ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                              <button
                                   type="button"
                                   onClick={requestAllPermissions}
                                   className="flex w-full items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-500 py-[16px] text-[16px] font-black text-white shadow-[0_12px_28px_-8px_rgba(4,120,87,0.55)] transition-all duration-200 active:scale-[0.97]"
                              >
                                   <Shield size={18} /> सर्व परवानग्या द्या
                              </button>
                              
                              <button
                                   data-testid="onboarding-skip"
                                   onClick={skipOrSave}
                                   className="mt-2 w-full py-2 text-[13px] font-bold text-slate-500 hover:text-slate-700 transition-colors"
                                   style={{ fontFamily: 'var(--font-sans)' }}
                              >
                                   नंतर देईन
                              </button>
                              
                              <p className="mt-1 flex items-center justify-center gap-1.5 text-center text-[10.5px] font-bold leading-normal text-slate-400/90" style={{ fontFamily: 'var(--font-sans)' }}>
                                   <Lock size={10} className="text-slate-400" /> तुमची माहिती सुरक्षित आहे. आम्ही फक्त आवश्यक तेवढाच वापर करतो.
                              </p>
                         </div>
                    </div>
               </div>
          </div>
     );
};

export default OnboardingPermissionsPage;

import React, { useState, useEffect } from 'react';
import { Shield, MapPin, Mic, Camera, HardDrive, CheckCircle2, ChevronRight, Check } from 'lucide-react';
import Button from '../shared/components/ui/Button';

interface OnboardingPermissionsPageProps {
     onComplete: () => void;
}

const OnboardingPermissionsPage: React.FC<OnboardingPermissionsPageProps> = ({ onComplete }) => {
     const [permissions, setPermissions] = useState({
          location: false,
          microphone: false,
          camera: false,
          /* Notification/storage mapping if needed, skipping granular for standard web flow */
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
     }, []);

     const requestAllPermissions = async () => {
          try {
               // Sequential requesting is more reliable in browsers than Promise.all for permissions
               try {
                    await navigator.mediaDevices.getUserMedia({ audio: true });
               } catch (e) {
                    console.warn('Microphone permission denied', e);
               }
               try {
                    await navigator.mediaDevices.getUserMedia({ video: true });
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

               // Regardless of actual browser grant (since we can't force user), we record the flow completion
               localStorage.setItem('shramsafal_permissions_granted', 'true');
               onComplete();
          } catch (error) {
               console.error('Error requesting permissions', error);
               // Default to advance anyway to avoid hard block, since this is web
               localStorage.setItem('shramsafal_permissions_granted', 'true');
               onComplete();
          }
     };

     const skipOrSave = () => {
          localStorage.setItem('shramsafal_permissions_granted', 'true');
          onComplete();
     };

     return (
          <div className="fixed inset-0 z-50 bg-slate-50 flex flex-col items-center justify-center p-6 animate-in fade-in">
               <div className="w-full max-w-sm flex flex-col h-full max-h-[85vh] bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden relative">

                    {/* Header Decoration */}
                    <div className="absolute top-0 left-0 right-0 h-32 bg-emerald-500 rounded-b-[40px] opacity-10 pointer-events-none"></div>

                    <div className="flex-1 flex flex-col items-center p-8 text-center pt-12 relative z-10 overflow-y-auto">
                         <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mb-6 shadow-inner text-emerald-600">
                              <Shield size={40} strokeWidth={2} />
                         </div>

                         <h2 className="text-2xl font-black text-slate-800 tracking-tight leading-tight">
                              App Permissions <br />
                              <span className="text-lg text-slate-500 font-medium">For best experience</span>
                         </h2>

                         <p className="text-sm text-slate-500 mt-4 leading-relaxed px-2">
                              ShramSafal requires access to standard device features to operate smoothly and safely.
                         </p>

                         <div className="mt-8 space-y-4 w-full text-left">
                              {/* Location */}
                              <div className="flex items-start gap-4 p-3 rounded-2xl border border-slate-100 bg-slate-50">
                                   <div className={`p-2 rounded-xl text-white shadow-sm ${permissions.location ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                                        <MapPin size={20} />
                                   </div>
                                   <div className="flex-1">
                                        <p className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                             Location
                                             {permissions.location && <CheckCircle2 size={14} className="text-emerald-500" />}
                                        </p>
                                        <p className="text-[10px] text-slate-500 font-medium leading-snug mt-1">Required to map plot polygons and attach GPS proof to logs.</p>
                                   </div>
                              </div>

                              {/* Microphone */}
                              <div className="flex items-start gap-4 p-3 rounded-2xl border border-slate-100 bg-slate-50">
                                   <div className={`p-2 rounded-xl text-white shadow-sm ${permissions.microphone ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                                        <Mic size={20} />
                                   </div>
                                   <div className="flex-1">
                                        <p className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                             Microphone
                                             {permissions.microphone && <CheckCircle2 size={14} className="text-emerald-500" />}
                                        </p>
                                        <p className="text-[10px] text-slate-500 font-medium leading-snug mt-1">Required for AI Sathi voice logs and voice commands.</p>
                                   </div>
                              </div>

                              {/* Camera */}
                              <div className="flex items-start gap-4 p-3 rounded-2xl border border-slate-100 bg-slate-50">
                                   <div className={`p-2 rounded-xl text-white shadow-sm ${permissions.camera ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                                        <Camera size={20} />
                                   </div>
                                   <div className="flex-1">
                                        <p className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                             Camera
                                             {permissions.camera && <CheckCircle2 size={14} className="text-emerald-500" />}
                                        </p>
                                        <p className="text-[10px] text-slate-500 font-medium leading-snug mt-1">Required to take photos of receipts and pests.</p>
                                   </div>
                              </div>

                              {/* Storage */}
                              <div className="flex items-start gap-4 p-3 rounded-2xl border border-slate-100 bg-slate-50">
                                   <div className="p-2 rounded-xl text-white shadow-sm bg-slate-300">
                                        <HardDrive size={20} />
                                   </div>
                                   <div className="flex-1">
                                        <p className="font-bold text-slate-800 text-sm">Storage</p>
                                        <p className="text-[10px] text-slate-500 font-medium leading-snug mt-1">Required to save offline records safely on device.</p>
                                   </div>
                              </div>
                         </div>
                    </div>

                    <div className="p-5 border-t border-slate-100 bg-white space-y-3 shrink-0">
                         <Button
                              onClick={requestAllPermissions}
                              className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-lg shadow-emerald-600/20 active:scale-[0.98] transition-all"
                         >
                              Allow All Permissions
                         </Button>
                         <button
                              onClick={skipOrSave}
                              className="w-full py-2.5 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
                         >
                              Skip for now
                         </button>
                    </div>
               </div>
          </div>
     );
};

export default OnboardingPermissionsPage;

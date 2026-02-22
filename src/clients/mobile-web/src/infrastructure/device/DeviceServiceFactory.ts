import { Capacitor } from '@capacitor/core';
import type { DeviceCameraService } from './DeviceCameraService';
import type { DeviceFilesService } from './DeviceFilesService';
import type { DeviceLocationService } from './DeviceLocationService';
import type { DeviceShareAndSaveService } from './DeviceShareAndSaveService';
import type { DevicePermissionsService } from './DevicePermissionsService';
import { WebCameraService } from './web/WebCameraService';
import { WebFilesService } from './web/WebFilesService';
import { WebLocationService } from './web/WebLocationService';
import { WebShareAndSaveService } from './web/WebShareAndSaveService';
import { WebPermissionsService } from './web/WebPermissionsService';
import { CapacitorCameraService } from './capacitor/CapacitorCameraService';
import { CapacitorFilesService } from './capacitor/CapacitorFilesService';
import { CapacitorLocationService } from './capacitor/CapacitorLocationService';
import { CapacitorShareAndSaveService } from './capacitor/CapacitorShareAndSaveService';
import { CapacitorPermissionsService } from './capacitor/CapacitorPermissionsService';

export interface DeviceServices {
  camera: DeviceCameraService;
  files: DeviceFilesService;
  location: DeviceLocationService;
  share: DeviceShareAndSaveService;
  permissions: DevicePermissionsService;
}

export function createDeviceServices(): DeviceServices {
  const isNative = Capacitor.isNativePlatform();

  return {
    camera: isNative ? new CapacitorCameraService() : new WebCameraService(),
    files: isNative ? new CapacitorFilesService() : new WebFilesService(),
    location: isNative ? new CapacitorLocationService() : new WebLocationService(),
    share: isNative ? new CapacitorShareAndSaveService() : new WebShareAndSaveService(),
    permissions: isNative ? new CapacitorPermissionsService() : new WebPermissionsService()
  };
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — useProfileData hook.
 *
 * Read-only convenience around the profile + onUpdateProfile pair that the
 * orchestrator receives from AppRouter. Wraps the update callback to
 * preserve referential stability across renders. Future iterations can
 * swap the prop pair for a direct `dataSource.profile` read; the section
 * components consume this hook's return shape, so that swap will be
 * mechanical.
 */

import { useCallback } from 'react';
import { FarmerProfile } from '../../../types';

export interface UseProfileDataReturn {
    profile: FarmerProfile;
    updateProfile: (next: FarmerProfile) => void;
}

export function useProfileData(
    profile: FarmerProfile,
    onUpdateProfile: (p: FarmerProfile) => void,
): UseProfileDataReturn {
    const updateProfile = useCallback(
        (next: FarmerProfile) => onUpdateProfile(next),
        [onUpdateProfile],
    );
    return { profile, updateProfile };
}

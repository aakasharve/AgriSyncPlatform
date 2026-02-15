/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const vibrate = (pattern: number | number[] = 10) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(pattern);
    }
};

export const hapticFeedback = {
    light: () => vibrate(10),
    medium: () => vibrate(40),
    heavy: () => vibrate(70),
    success: () => vibrate([30, 50, 30]),
    error: () => vibrate([50, 30, 50, 30, 50]),
};

export default hapticFeedback;

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-T v4; P10) - whether the device says it has a net, live. The mic of the
 * reason sheet is offered only while this is true (the spoken words need the internet; nothing waits with the sound).
 */
import { useEffect, useState } from 'react';

const isOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false;

export function useOnline(): boolean {
    const [online, setOnline] = useState(isOnline);
    useEffect(() => {
        const on = () => setOnline(true);
        const off = () => setOnline(false);
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        setOnline(isOnline());
        return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
    }, []);
    return online;
}


import { systemClock } from '../../core/domain/services/Clock';
import { getDateKey } from '../../domain/system/DateKeyService';

// Extend NotificationOptions for newer properties
interface ExtendedNotificationOptions extends NotificationOptions {
    actions?: Array<{ action: string; title: string; icon?: string }>;
    image?: string;
}

const DISCIPLINE_MORNING_ENABLED_KEY = 'shramsafal.enable_morning_rhythm_nudge';
const DISCIPLINE_SENT_PREFIX = 'shramsafal.nudge_sent';
const DISCIPLINE_ONE_DAY_MS = 24 * 60 * 60 * 1000;
const disciplineTimers: number[] = [];

const getDelayUntilHour = (hour: number, minute: number = 0): number => {
    const now = new Date();
    const next = new Date();
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= now.getTime()) {
        next.setDate(next.getDate() + 1);
    }
    return next.getTime() - now.getTime();
};

export const NotificationService = {
    // 1. Register Service Worker
    registerSW: async () => {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('/sw.js');
                console.log('Service Worker registered with scope:', registration.scope);
                return registration;
            } catch (error) {
                console.error('Service Worker registration failed:', error);
            }
        }
    },

    // 2. Request Permission
    requestPermission: async () => {
        if (!('Notification' in window)) {
            alert('This browser does not support desktop notification');
            return false;
        }

        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            console.log('Notification permission granted.');
            return true;
        } else {
            console.warn('Notification permission denied.');
            return false;
        }
    },

    // 3. Show Local Notification (Immediate)
    showLocalNotification: async (title: string, options: ExtendedNotificationOptions) => {
        const registration = await navigator.serviceWorker.ready;
        if (!registration) {
            console.error('Service Worker not ready');
            return;
        }

        // "ROBUSTNESS": Check for Video and add action if needed
        if (options.data?.videoUrl && (!options.actions || !options.actions.find(a => a.action === 'video-action'))) {
            const actions = options.actions || [];
            actions.push({
                action: 'video-action',
                title: 'Watch Video',
                // icon: '/icons/video.png' 
            });
            options.actions = actions;
            options.data.url = options.data.videoUrl; // Ensure click opens it
        }

        // Cast to any to bypass standard NotificationOptions strictness if needed, or use Extended
        registration.showNotification(title, options as NotificationOptions);
    },

    // 4. Schedule Notification (Timer)
    // Note: True background scheduling requires backend or 'Notification Triggers' API (experimental).
    // We will simulate this with setTimeout for the active session, 
    // which satisfies "Robustness" for a single-page app session.
    scheduleNotification: (title: string, options: ExtendedNotificationOptions, delayMs: number) => {
        console.log(`Scheduling notification '${title}' in ${delayMs}ms`);
        setTimeout(() => {
            NotificationService.showLocalNotification(title, options);
        }, delayMs);
    },

    scheduleDisciplineNudges: () => {
        if (typeof window === 'undefined') return;
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'granted') return;

        // Avoid duplicate timers if this method gets called more than once.
        disciplineTimers.forEach(timer => window.clearTimeout(timer));
        disciplineTimers.length = 0;

        const scheduleDaily = (
            id: string,
            title: string,
            body: string,
            hour: number,
            options: ExtendedNotificationOptions
        ) => {
            const fire = () => {
                const dayKey = getDateKey();
                const sentKey = `${DISCIPLINE_SENT_PREFIX}.${id}.${dayKey}`;
                if (!window.localStorage.getItem(sentKey)) {
                    void NotificationService.showLocalNotification(title, {
                        ...options,
                        body
                    });
                    window.localStorage.setItem(sentKey, '1');
                }

                const repeatTimer = window.setTimeout(fire, DISCIPLINE_ONE_DAY_MS);
                disciplineTimers.push(repeatTimer);
            };

            const initialDelay = getDelayUntilHour(hour);
            const timer = window.setTimeout(fire, initialDelay);
            disciplineTimers.push(timer);
        };

        scheduleDaily(
            'end_of_day',
            "Today's work captured?",
            'Review summary or close day.',
            19,
            {
                tag: 'discipline-end-of-day',
                data: { url: '/?nudge=close-day' },
                actions: [
                    { action: 'review-summary', title: 'Review summary' },
                    { action: 'close-day', title: 'Close day' }
                ]
            }
        );

        if (window.localStorage.getItem(DISCIPLINE_MORNING_ENABLED_KEY) === 'true') {
            scheduleDaily(
                'morning_rhythm',
                'Today: Stage + Weather + Tasks in 10 seconds',
                'Open Today',
                7,
                {
                    tag: 'discipline-morning-rhythm',
                    data: { url: '/?nudge=open-today' },
                    actions: [
                        { action: 'open-today', title: 'Open Today' }
                    ]
                }
            );
        }
    },

    // Helper for verification
    triggerTest: async (type: 'image' | 'video' | 'timer') => {
        const hasPermission = await NotificationService.requestPermission();
        if (!hasPermission) return;

        const baseOptions: ExtendedNotificationOptions = {
            body: 'This is a robust notification test.',
            icon: '/vite.svg', // Default vite icon
            badge: '/vite.svg',
            data: { url: window.location.href, timestamp: systemClock.nowEpoch() }
        };

        switch (type) {
            case 'image':
                await NotificationService.showLocalNotification('Image Notification', {
                    ...baseOptions,
                    body: 'Check out this beautiful view!',
                    image: 'https://images.unsplash.com/photo-1560493676-04071c5f467b?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80', // Sample large image
                });
                break;
            case 'video':
                await NotificationService.showLocalNotification('New Video Uploaded', {
                    ...baseOptions,
                    body: 'Click to watch the latest ShramSafal tutorial.',
                    data: {
                        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', // Sample video
                        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
                    },
                    actions: [
                        { action: 'video-action', title: '▶ Watch Now' }
                    ]
                });
                break;
            case 'timer':
                NotificationService.scheduleNotification('Timer Complete!', {
                    ...baseOptions,
                    body: 'Your 5-second timer has finished.',
                    requireInteraction: true // Keep it on screen
                }, 5000);
                alert('Timer set for 5 seconds. Wait for it...');
                break;
        }
    }
};

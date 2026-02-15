/// <reference lib="webworker" />

const CACHE_NAME = 'shramsafal-push-v1';

self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing Service Worker ...', event);
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating Service Worker ...', event);
    return self.clients.claim();
});

self.addEventListener('push', (event) => {
    console.log('[Service Worker] Push Received.');
    console.log(`[Service Worker] Push had this data: "${event.data.text()}"`);

    let data = { title: 'ShramSafal Notification', content: 'Something happened!', openUrl: '/', image: null, actions: [] };

    try {
        const payload = event.data.json();
        data = { ...data, ...payload };
    } catch (e) {
        console.error('Error parsing push data', e);
        // Fallback for plain text
        data.content = event.data.text();
    }

    const options = {
        body: data.content,
        icon: '/pwa-192x192.png', // Ensure this exists or use a default
        badge: '/badge-72x72.png', // Ensure this exists or use a default
        data: {
            url: data.openUrl
        }
    };

    // 1. ROBUST: Image Support
    if (data.image) {
        options.image = data.image;
    }

    // 2. ROBUST: Actions (Buttons)
    if (data.actions && Array.isArray(data.actions)) {
        options.actions = data.actions;
    }

    // 3. ROBUST: Video Support (via Action)
    // If the payload indicates a video, we can add a specific action for it if not already present
    // or simply rely on the 'openUrl' to be the video link.

    // Custom timestamp if provided (for "scheduling" simulation display, although notification shows NOW)
    if (data.timestamp) {
        options.timestamp = data.timestamp;
    }

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', (event) => {
    console.log('[Service Worker] Notification click Received.');

    event.notification.close();

    let openUrl = event.notification.data.url || '/';

    if (event.action === 'review-summary') {
        openUrl = '/?nudge=review-summary';
    }
    if (event.action === 'close-day') {
        openUrl = '/?nudge=close-day';
    }
    if (event.action === 'open-today') {
        openUrl = '/?nudge=open-today';
    }

    if (event.action === 'video-action') {
        // Specific handling for video action if we wanted to open a specific video player route
        // For now, we'll generic open URL
    }

    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then((windowClients) => {
            // Check if there is already a window for this url
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url === openUrl && 'focus' in client) {
                    return client.focus();
                }
            }
            // If not, open a new window
            if (self.clients.openWindow) {
                return self.clients.openWindow(openUrl);
            }
        })
    );
});

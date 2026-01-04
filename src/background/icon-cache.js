// Icon caching for notification icons

const ICON_CACHE_NAME = 'pushover-icons';
const ICON_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function getCachedIconUrl(iconName) {
  if (!iconName) return null;

  const iconUrl = `https://api.pushover.net/icons/${iconName}.png`;

  try {
    const cache = await caches.open(ICON_CACHE_NAME);
    const cached = await cache.match(iconUrl);

    if (cached) {
      console.debug('Icon cache hit:', iconName);
      return iconUrl;
    }

    // Fetch and cache the icon
    console.debug('Icon cache miss, fetching:', iconName);
    const response = await fetch(iconUrl);
    if (response.ok) {
      // Clone response and add timestamp header for cache cleanup
      const headers = new Headers(response.headers);
      headers.set('X-Cached-At', Date.now().toString());
      const cachedResponse = new Response(await response.blob(), { headers });
      await cache.put(iconUrl, cachedResponse);
    }
    return iconUrl;
  } catch (error) {
    console.warn('Icon cache error:', error);
    return iconUrl; // Return URL anyway, let notification handle failure
  }
}

export async function cleanupIconCache() {
  try {
    const cache = await caches.open(ICON_CACHE_NAME);
    const keys = await cache.keys();
    const now = Date.now();
    let cleaned = 0;

    for (const request of keys) {
      const response = await cache.match(request);
      const cachedAt = response?.headers.get('X-Cached-At');

      if (cachedAt && (now - parseInt(cachedAt, 10)) > ICON_CACHE_MAX_AGE_MS) {
        await cache.delete(request);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.debug(`Cleaned ${cleaned} expired icons from cache`);
    }
    return cleaned;
  } catch (error) {
    console.warn('Icon cache cleanup error:', error);
    return 0;
  }
}

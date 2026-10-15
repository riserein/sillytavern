// Maintainer-owned, public client configuration. Never put bearer tokens or client secrets here.
export const PLATFORM_CONFIG = Object.freeze({
    openverse: { enabled: true, baseUrl: 'https://api.openverse.org/v1/' },
    audius: { apiKey: '', baseUrl: 'https://api.audius.co/v1/' },
    // Candidate integrations only. Confirm platform permission for this multi-source product before enabling.
    embeds: { spotify: false, soundcloud: false },
});

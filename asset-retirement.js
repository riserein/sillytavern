const SETTINGS_KEY = 'riserein_music_player';
import { designReferences } from './ui/config.js';
export function referencedAssets(settings) {
    if (!settings || !Array.isArray(settings.tracks)) return null;
    const ids = new Set();
    for (const track of settings.tracks) {
        if (track.kind === 'local') ids.add(track.id);
        if (track.coverId) ids.add(track.coverId);
    }
    for (const playlist of settings.playlists || []) if (playlist.coverId) ids.add(playlist.coverId);
    for (const font of settings.fonts || []) ids.add(font.id);
    if (settings.fontId) ids.add(settings.fontId);
    if (settings.backgroundId) { ids.add(settings.backgroundId); ids.add(`${settings.backgroundId}:original`); }
    for (const id of designReferences(settings)) ids.add(id);
    return ids;
}
async function postedSettings(input, init) {
    const request = new Request(input, init);
    let response = new Response(request.body);
    if (request.headers.get('Content-Encoding')?.toLowerCase() === 'gzip')
        response = new Response(response.body.pipeThrough(new DecompressionStream('gzip')));
    return (await response.json()).extension_settings?.[SETTINGS_KEY];
}
/** Retire replaced bytes only after the EXACT posted metadata is acknowledged.
 * Never treats the host's debounced-save call or a generic save event as a commit.
 * A closed page can leave unused bytes behind; retaining them is safer than deleting live data.
 */
export function createAssetRetirement({ store, settings, scheduleSave, onError, onUnconfirmed, journal, protectedReferences, host = window }) {
    const previous = host.fetch;
    const pending = new Set();
    let disposed = false, cleanup = Promise.resolve(), active = 0, generation = 0;
    async function wrapped(input, init) {
        if (disposed) return previous.call(this, input, init);
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, host.location.href);
        const isSave = url.origin === host.location.origin && url.pathname === '/api/settings/save';
        const overlapping = isSave && active > 0;
        const token = isSave ? ++generation : generation;
        if (isSave) active++;
        let snapshot;
        if (isSave && pending.size) {
            // Clone Request bodies before the original fetch takes ownership of their streams.
            snapshot = postedSettings(input instanceof Request ? input.clone() : url.href, init).catch(() => null);
        }
        let response;
        try { response = await previous.call(this, input, init); }
        finally {
            if (isSave) {
                active--;
                if (!disposed && pending.size && !active && (overlapping || token !== generation)) scheduleSave();
            }
        }
        let acknowledged = false;
        if (snapshot && response.ok && !response.redirected) {
            // ST 1.19.0's settings endpoint can send a write error with HTTP 200.
            // An HTTP success or SETTINGS_UPDATED event alone is not a durable save acknowledgement.
            try { acknowledged = (await response.clone().json())?.result === 'ok'; } catch { /* Retain bytes. */ }
        }
        if (snapshot && !acknowledged && !disposed) onUnconfirmed?.();
        if (snapshot && acknowledged && !disposed && !active && !overlapping && token === generation) {
            const saved = referencedAssets(await snapshot);
            if (saved) {
                cleanup = cleanup.catch(() => {}).then(async () => {
                    if (disposed || active || token !== generation) return;
                    const protectedGraph=protectedReferences?await protectedReferences():{refs:new Set(),unknown:false};
                    if(disposed||active||token!==generation||protectedGraph?.unknown)return;
                    const live = referencedAssets(settings);
                    if (!live) return;
                    const acknowledged=[...pending].filter(id=>!saved.has(id)&&!live.has(id));
                    if(journal)for(const id of acknowledged)await journal.put({id,confirmed:true,at:Date.now()},'retired');
                    if(disposed||active||token!==generation)return;
                    const ids = acknowledged.filter(id=>!protectedGraph?.refs?.has(id));
                    if (!ids.length) return;
                    try {
                        await store.deleteMany(ids);
                        for (const id of ids) { pending.delete(id); if(journal)await journal.delete(id,'retired'); }
                    } catch (error) { if (!disposed) onError?.(error); }
                });
                await cleanup.catch(error=>{if(!disposed)onError?.(error);});
            }
        }
        return response;
    }
    host.fetch = wrapped;
    if(journal)void journal.list('retired').then(rows=>{
        if(disposed)return;for(const row of rows)pending.add(row.id);if(pending.size)scheduleSave();
    }).catch(error=>{if(!disposed)onError?.(error);});
    return {
        retire(ids) {
            if (disposed) return;
            for (const id of ids) if (id) pending.add(id);
            if(journal)for(const id of ids)if(id)void journal.put({id,confirmed:false,at:Date.now()},'retired').then(()=>{if(!disposed)scheduleSave();}).catch(error=>{if(!disposed)onError?.(error);});
            if (!disposed && pending.size) scheduleSave();
        },
        get pendingCount() { return pending.size; },
        dispose() {
            disposed = true; pending.clear();
            if (host.fetch === wrapped) host.fetch = previous;
            // Another extension can retain a forwarding wrapper; release references to this player.
            store = settings = scheduleSave = onError = onUnconfirmed = journal = protectedReferences = null;
        },
    };
}

/** A per-page listening queue. Edits never write to a permanent collection. */
export function createPlaybackQueue(getCollection) {
    let sourceId = null, ids = [], removed = new Set(), played = new Set();
    function tracks() {
        const collection = getCollection(sourceId), byId = new Map(collection.map(track => [track.id, track]));
        ids = ids.filter(id => byId.has(id));
        const existing = new Set(ids);
        for (const track of collection) if (!existing.has(track.id) && !removed.has(track.id)) { ids.push(track.id); existing.add(track.id); }
        return ids.map(id => byId.get(id));
    }
    return {
        get sourceId() { return sourceId; },
        tracks,
        reset(id) { sourceId = id; ids = []; removed = new Set(); played = new Set(); return tracks(); },
        remove(id, currentId) {
            tracks();
            if (id === currentId || !ids.includes(id)) return false;
            ids = ids.filter(value => value !== id); removed.add(id); return true;
        },
        move(id, direction) {
            tracks();
            const from = ids.indexOf(id), to = from + direction;
            if (![-1, 1].includes(direction) || from < 0 || to < 0 || to >= ids.length) return false;
            [ids[from], ids[to]] = [ids[to], ids[from]]; return true;
        },
        markPlayed(id) { played.add(id); },
        hasPlayed(id) { return played.has(id); },
    };
}

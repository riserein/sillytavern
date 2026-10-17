/** Separate database: never opens, upgrades or deletes the music library database. */
export class CardProjectStore {
    constructor(indexedDB = globalThis.indexedDB) {
        this.indexedDB = indexedDB;
        this.queue = Promise.resolve();
    }
    async open() {
        if (!this.db)
            this.db = new Promise((resolve, reject) => {
                const request = this.indexedDB.open('riserein-card-player-projects', 1);
                request.onupgradeneeded = () =>
                    request.result.createObjectStore('projects', { keyPath: 'id' });
                request.onsuccess = () => {
                    request.result.onversionchange = () => {
                        request.result.close();
                        this.db = null;
                    };
                    resolve(request.result);
                };
                request.onerror = () => {
                    this.db = null;
                    reject(request.error);
                };
                request.onblocked = () => {
                    this.db = null;
                    reject(new Error('草稿库被另一页面占用，请关闭旧页面后重试。'));
                };
            });
        return this.db;
    }
    run(mode, action) {
        // Reads and writes are ordered; a slow save can never resurrect a deleted project.
        const job = this.queue
            .catch(() => {})
            .then(async () => {
                const db = await this.open();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction('projects', mode);
                    let request;
                    tx.oncomplete = () => resolve(request?.result);
                    tx.onerror = tx.onabort = () =>
                        reject(tx.projectError || tx.error || new Error('草稿保存失败，旧版本仍保留。'));
                    try {
                        request = action(tx.objectStore('projects'));
                    } catch (error) {
                        tx.projectError = error;
                        tx.abort();
                    }
                });
            });
        this.queue = job;
        return job;
    }
    save(project, expectedRevision) {
        const copy = structuredClone({
            ...project,
            format: 1,
            updatedAt: Date.now(),
        });
        return this.run('readwrite', (store) => {
            const request = store.get(copy.id);
            request.onsuccess = () => {
                const previous = request.result?.revision || 0;
                if (expectedRevision !== undefined && expectedRevision !== previous) {
                    store.transaction.projectError = new Error(
                        '此项目已在另一页面更新或删除，请复制当前内容为新项目，避免覆盖',
                    );
                    store.transaction.abort();
                    return;
                }
                copy.revision = previous + 1;
                store.put(copy);
            };
            return request;
        }).then(() => copy);
    }
    get(id) {
        return this.run('readonly', (store) => store.get(id));
    }
    list() {
        return this.run('readonly', (store) => store.getAll()).then((rows) =>
            rows.sort((a, b) => b.updatedAt - a.updatedAt),
        );
    }
    delete(id, expectedRevision) {
        return this.run('readwrite', (store) => {
            if (expectedRevision === undefined) return store.delete(id);
            const request = store.get(id);
            request.onsuccess = () => {
                if (request.result?.revision !== expectedRevision) {
                    store.transaction.projectError = new Error('项目已在另一页面更新或删除，请重新读取后确认删除。');
                    store.transaction.abort();
                } else store.delete(id);
            };
            return request;
        });
    }
    async dispose() {
        await this.queue.catch(() => {});
        if (this.db) (await this.db).close();
        this.db = null;
    }
}
/** Copy referenced library bytes into a draft so later library deletion cannot break it. */
export async function captureProjectResources(tracks, appearance, getBlob) {
    const copies = await Promise.all(
        tracks.map(async (track) => {
            const copy = { ...track };
            if (copy.kind === 'local' && !copy.exportBlob && !copy.exportUrl) {
                copy.exportBlob = await getBlob(copy.id);
                if (!copy.exportBlob) throw new Error(`「${copy.title}」本地音频丢失，未覆盖旧草稿。`);
            }
            if (copy.coverId && !copy.exportCover) {
                copy.exportCover = await getBlob(copy.coverId);
                if (!copy.exportCover) throw new Error(`「${copy.title}」封面丢失，未覆盖旧草稿。`);
            }
            return copy;
        }),
    );
    const theme = { ...appearance };
    if (theme.imageId && !theme.imageBlob) {
        theme.imageBlob = await getBlob(theme.imageId);
        if (!theme.imageBlob) throw new Error('背景丢失，未覆盖旧草稿。');
    }
    if (theme.fontId && !theme.fontBlob) {
        theme.fontBlob = await getBlob(theme.fontId);
        if (!theme.fontBlob) throw new Error('字体丢失，未覆盖旧草稿。');
    }
    return { tracks: copies, appearance: theme };
}

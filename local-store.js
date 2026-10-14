/** Audio stays in this browser; only playlist metadata is saved to SillyTavern. */
export class LocalMusicStore {
    #database;

    async #open() {
        if (!globalThis.indexedDB) throw new Error('浏览器不支持本地音乐存储，请改用音乐直链。');
        this.#database ??= new Promise((resolve, reject) => {
            const request = indexedDB.open('riserein-sillytavern-music', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('tracks');
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => { db.close(); this.#database = undefined; };
                resolve(db);
            };
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('音乐存储暂时被其他页面占用，请关闭其他酒馆页面后重试。'));
        }).catch(error => { this.#database = undefined; throw error; });
        return this.#database;
    }

    async #run(mode, operation) {
        const database = await this.#open();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction('tracks', mode);
            const request = operation(transaction.objectStore('tracks'));
            transaction.oncomplete = () => resolve(request.result);
            transaction.onerror = () => reject(transaction.error || request.error);
            transaction.onabort = () => reject(transaction.error || new Error('音乐存储操作被中断。'));
        });
    }

    put(id, blob) { return this.#run('readwrite', store => store.put(blob, id)); }
    get(id) { return this.#run('readonly', store => store.get(id)); }
    delete(id) { return this.#run('readwrite', store => store.delete(id)); }
}

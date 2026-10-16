/** Own every host resource created by the shared UI. Never replace host globals. */
export function sharedEnvironment(root, assets, win) {
    const doc = win.document,
        stops = [],
        timers = new Map(),
        frames = new Set(),
        urls = new Set(),
        observers = new Set(),
        requests = new Set(),
        faces = new Set();
    let disposed = false;
    function listen(target, type, callback, options) {
        target.addEventListener(type, callback, options);
        stops.push(() => target.removeEventListener(type, callback, options));
    }
    function proxy(target, overrides) {
        return new Proxy(target, {
            get(object, key) {
                if (key in overrides) return overrides[key];
                const value = Reflect.get(object, key, object);
                return typeof value === 'function' ? value.bind(object) : value;
            },
        });
    }
    const time = (repeat, callback, delay, ...args) => {
        if (disposed) return 0;
        const id = win[repeat ? 'setInterval' : 'setTimeout'](() => {
            if (!repeat) timers.delete(id);
            if (!disposed) callback(...args);
        }, delay);
        timers.set(id, repeat);
        return id;
    };
    const clear = (id) => {
        win[timers.get(id) ? 'clearInterval' : 'clearTimeout'](id);
        timers.delete(id);
    };
    const raf = (callback) => {
        if (disposed) return 0;
        const id = win.requestAnimationFrame((now) => {
            frames.delete(id);
            if (!disposed) callback(now);
        });
        frames.add(id);
        return id;
    };
    const cancel = (id) => {
        win.cancelAnimationFrame(id);
        frames.delete(id);
    };
    class ScopedURL extends win.URL {
        constructor(value, base) {
            super(value, base);
            const resource = assets[this.pathname.replace(/^\//, '')];
            if (this.hostname === 'rscp.invalid') {
                if (!resource) throw new Error('这项资源没有随角色卡携带');
                return new win.URL(resource);
            }
        }
        static createObjectURL(blob) {
            if (disposed) throw new DOMException('播放器已关闭', 'AbortError');
            const url = win.URL.createObjectURL(blob);
            urls.add(url);
            return url;
        }
        static revokeObjectURL(url) {
            urls.delete(url);
            win.URL.revokeObjectURL(url);
        }
    }
    const observe = (Type) =>
        class extends Type {
            constructor(callback) {
                super((...args) => {
                    if (!disposed) callback(...args);
                });
                observers.add(this);
            }
            disconnect() {
                super.disconnect();
                observers.delete(this);
            }
        };
    const scopedFetch = async (input, options = {}) => {
        if (disposed) throw new DOMException('播放器已关闭', 'AbortError');
        const control = new win.AbortController();
        requests.add(control);
        try {
            return await win.fetch(input, {
                ...options,
                signal: options.signal
                    ? win.AbortSignal.any([options.signal, control.signal])
                    : control.signal,
            });
        } finally {
            requests.delete(control);
        }
    };
    const scopedWindow = proxy(win, {
        addEventListener: (...args) => listen(win, ...args),
        setTimeout: (...args) => time(false, ...args),
        setInterval: (...args) => time(true, ...args),
        clearTimeout: clear,
        clearInterval: clear,
        requestAnimationFrame: raf,
        cancelAnimationFrame: cancel,
    });
    const scopedDocument = proxy(doc, {
        body: proxy(doc.body, {
            append: (...nodes) => {
                if (!disposed) root.append(...nodes);
            },
        }),
        getElementById: (id) => root.querySelector(`#${CSS.escape(id)}`),
        querySelector: (selector) => root.querySelector(selector),
        querySelectorAll: (selector) => root.querySelectorAll(selector),
        addEventListener: (...args) => listen(doc, ...args),
        fonts: proxy(doc.fonts, {
            add: (face) => {
                if (!disposed) {
                    faces.add(face);
                    doc.fonts.add(face);
                }
            },
            delete: (face) => {
                faces.delete(face);
                return doc.fonts.delete(face);
            },
        }),
    });
    return {
        environment: {
            document: scopedDocument,
            window: scopedWindow,
            globalThis: win,
            URL: ScopedURL,
            ResizeObserver: observe(win.ResizeObserver),
            MutationObserver: observe(win.MutationObserver),
            setTimeout: (...args) => time(false, ...args),
            setInterval: (...args) => time(true, ...args),
            clearTimeout: clear,
            clearInterval: clear,
            requestAnimationFrame: raf,
            cancelAnimationFrame: cancel,
            getComputedStyle: win.getComputedStyle.bind(win),
            matchMedia: win.matchMedia.bind(win),
            Image: win.Image,
            FontFace: win.FontFace,
            fetch: scopedFetch,
            location: win.location,
        },
        get resourceCounts() {
            return {
                timers: timers.size,
                frames: frames.size,
                urls: urls.size,
                observers: observers.size,
                listeners: stops.length,
                requests: requests.size,
                fonts: faces.size,
            };
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const stop of stops.splice(0)) stop();
            for (const id of timers.keys()) clear(id);
            for (const id of frames) cancel(id);
            for (const observer of [...observers]) observer.disconnect();
            for (const request of requests) request.abort();
            requests.clear();
            for (const url of urls) win.URL.revokeObjectURL(url);
            urls.clear();
            for (const face of faces) doc.fonts.delete(face);
            faces.clear();
        },
    };
}

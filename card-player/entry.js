import { mountCardPlayer } from './runtime.js';

export function startCharacterPlayer(config) {
    // These are verified Tavern Helper iframe APIs, not guessed globals on the main page.
    if (
        typeof getScriptId !== 'function' ||
        typeof getCurrentCharacterId !== 'function' ||
        typeof getScriptTrees !== 'function' ||
        typeof eventOn !== 'function' ||
        typeof eventRemoveListener !== 'function'
    ) {
        throw new Error('请把脚本放入支持这些接口的酒馆助手“角色脚本”，不要放进消息或普通网页。');
    }
    const scriptId = getScriptId();
    const contains = (trees) =>
        trees.some((tree) =>
            tree.type === 'folder'
                ? tree.enabled && contains(tree.scripts || [])
                : tree.id === scriptId && tree.enabled,
        );
    if (!contains(getScriptTrees({ type: 'character' })))
        throw new Error('此播放器必须作为当前角色的已启用角色脚本运行。');
    const hostDocument = window.parent.document,
        hostWindow = hostDocument.defaultView;
    const currentRole = () => {
        const context = SillyTavern.getContext();
        return context.groupId || context.characterId === undefined || context.characterId === null
            ? null
            : getCurrentCharacterId();
    };
    const roleId = currentRole();
    if (!roleId) throw new Error('当前没有单人角色，取消创建角色播放器。');
    const scope = {
        hostDocument,
        hostWindow,
        roleId,
        scriptId,
        currentRole,
        onRoleChange(handler) {
            eventOn(tavern_events.CHAT_CHANGED, handler);
            return () => eventRemoveListener(tavern_events.CHAT_CHANGED, handler);
        },
        onScriptExit(handler) {
            window.addEventListener('pagehide', handler);
            window.addEventListener('unload', handler);
            return () => {
                window.removeEventListener('pagehide', handler);
                window.removeEventListener('unload', handler);
            };
        },
        onHostExit(handler) {
            hostWindow.addEventListener('pagehide', handler);
            return () => hostWindow.removeEventListener('pagehide', handler);
        },
        onFrameRemoved(handler) {
            const frame = window.frameElement;
            if (!frame?.parentNode) throw new Error('无法确定角色脚本 iframe 生命周期。');
            const observer = new hostWindow.MutationObserver(() => {
                if (!frame.isConnected) handler();
            });
            observer.observe(frame.parentNode, { childList: true });
            return () => observer.disconnect();
        },
    };
    return mountCardPlayer(config, scope);
}

/** Separate preview entry, never used to claim role-card lifecycle validation. */
export function startPreview(config) {
    const noop = () => () => {};
    const api = mountCardPlayer(config, {
        hostDocument: document,
        hostWindow: window,
        roleId: 'preview',
        scriptId: 'preview',
        observerCount: 0,
        currentRole: () => 'preview',
        onRoleChange: noop,
        onScriptExit: noop,
        onFrameRemoved: noop,
        onHostExit(handler) {
            window.addEventListener('pagehide', handler);
            return () => window.removeEventListener('pagehide', handler);
        },
    });
    const update = (event) => {
        if (event.source === window.parent && event.data?.type === 'rscp-appearance')
            api.updateAppearance(event.data.appearance);
    };
    window.addEventListener('message', update);
    window.addEventListener('pagehide', () => window.removeEventListener('message', update), { once: true });
    return api;
}

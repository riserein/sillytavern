import { mountCardPlayer } from './runtime.js';
import { accountPreferences } from './preferences.js';
import {identifyAccount,createAccountGuard} from '../data/identity.js';

export function createCharacterScope() {
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
    const context=SillyTavern.getContext();let accountSession;
    // Host account identity is independent of the role/script IDs. Failure keeps
    // embedded playback available, but account preferences may not be persisted.
    const authorize=async()=>{const session=accountSession;if(!session)throw new Error('播放器已关闭');await session.ready;session.controller.signal.throwIfAborted();if(!session.guard)throw new Error('账号保护尚未就绪');await session.guard.assert();};
    const scope = {
        hostDocument,
        hostWindow,
        roleId,
        scriptId,
        preferences: accountPreferences(context,authorize),
        currentRole,
        helperRecovery: typeof getButtonEvent === 'function' ? { scriptId, available: () => { const visit = rows => rows.some(row => row.type === 'folder' ? row.enabled && visit(row.scripts || []) : row.id === scriptId && row.enabled && row.button?.enabled && row.button.buttons?.some(button => button.name === '显示/隐藏角色音乐' && button.visible)); return visit(getScriptTrees({type:'character'})); }, subscribe(handler) { const event = getButtonEvent('显示/隐藏角色音乐'); eventOn(event, handler); return () => eventRemoveListener(event, handler); } } : null,
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
            if(!accountSession){
                const session={controller:new AbortController(),callbacks:new Set()};accountSession=session;
                session.ready=identifyAccount({fetcher:hostWindow.fetch.bind(hostWindow),headers:context.getRequestHeaders?.()||{},signal:session.controller.signal}).then(account=>{
                    if(!session.controller.signal.aborted)session.guard=createAccountGuard({account,context,host:hostWindow,onMismatch:()=>{for(const callback of [...session.callbacks])callback();}});
                });void session.ready.catch(()=>{});
            }
            const session=accountSession;session.callbacks.add(handler);
            return () => {
                session.callbacks.delete(handler);hostWindow.removeEventListener('pagehide',handler);
                // Font preparation and the mounted player temporarily hold two leases.
                if(!session.callbacks.size){session.controller.abort();session.guard?.dispose();if(accountSession===session)accountSession=null;}
            };
        },
        onFrameRemoved(handler) {
            const frame = window.frameElement;
            if (!frame?.parentNode) throw new Error('无法确定角色脚本 iframe 生命周期。');
            const observer = new hostWindow.MutationObserver(() => {
                if (!frame.isConnected) handler();
            });
            observer.observe(hostDocument.documentElement, {
                childList: true,
                subtree: true,
            });
            return () => observer.disconnect();
        },
    };
    return scope;
}

export function startCharacterPlayer(config) {
    return mountCardPlayer(config, createCharacterScope());
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

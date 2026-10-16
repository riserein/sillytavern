/** Role identity, not chat/message identity, owns a player's lifetime. */
export function watchRoleLifetime({ roleId, currentRole, onRoleChange, onScriptExit, onHostExit, onFrameRemoved }, onDispose) {
    let disposed = false;
    const stops = [];
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        for (const stop of stops.splice(0).reverse()) {
            try { stop(); } catch { /* Continue releasing the remaining resources. */ }
        }
        onDispose();
    };
    const check = () => {
        try { if (currentRole() !== roleId) dispose(); }
        catch { dispose(); }
    };
    try {
        for (const subscribe of [onScriptExit, onHostExit, onFrameRemoved]) stops.push(subscribe(dispose));
        stops.push(onRoleChange(check));
        check();
    } catch (error) { dispose(); throw error; }
    return { dispose, get disposed() { return disposed; }, get subscriptions() { return stops.length; } };
}

/** Role identity, not chat/message identity, owns a player's lifetime. */
export function watchRoleLifetime(
    { roleId, currentRole, onRoleChange, onScriptExit, onHostExit, onFrameRemoved },
    onDispose,
) {
    let disposed = false;
    const stops = [];
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        for (const stop of stops.splice(0).reverse()) {
            try {
                stop();
            } catch {
                /* Continue releasing the remaining resources. */
            }
        }
        onDispose();
    };
    const check = () => {
        try {
            if (currentRole() !== roleId) dispose();
        } catch {
            dispose();
        }
    };
    try {
        const retain = (stop) => {
            if (disposed) stop();
            else stops.push(stop);
        };
        for (const subscribe of [onScriptExit, onHostExit, onFrameRemoved]) {
            if (disposed) break;
            retain(subscribe(dispose));
        }
        if (!disposed) retain(onRoleChange(check));
        check();
    } catch (error) {
        dispose();
        throw error;
    }
    return {
        dispose,
        get disposed() {
            return disposed;
        },
        get subscriptions() {
            return stops.length;
        },
    };
}

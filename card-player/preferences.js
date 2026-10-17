/** Use official accountStorage; unsupported hosts get session-only preferences. */
export function accountPreferences(context) {
    const storage=context?.accountStorage;
    if(typeof storage?.getItem==='function'&&typeof storage?.setItem==='function')return storage;
    const state=new Map();return {getItem:key=>state.get(key)||null,setItem:(key,value)=>state.set(key,String(value))};
}
export function rolePreferences(scope,namespace,legacyNamespace) {
    const storage=Object.hasOwn(scope,'preferences')?scope.preferences:scope.hostWindow.localStorage;
    let current=null,legacy=null;
    try{
        current=storage?.getItem(namespace);
        // Automatic v1 migration never leaves the account's own store.
        const prior=current?null:storage?.getItem(legacyNamespace);
        if(prior){current=prior;storage?.setItem(namespace,prior);}
        if(Object.hasOwn(scope,'preferences')&&!current)legacy=scope.hostWindow.localStorage.getItem(namespace)||scope.hostWindow.localStorage.getItem(legacyNamespace);
    }catch{/* Preferences must not prevent playback. */}
    return {read(){try{return JSON.parse(current||'{}');}catch{return {};}},write(state){try{storage?.setItem(namespace,JSON.stringify(state));}catch{/* Playback continues. */}},legacy};
}

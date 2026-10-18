/** Use official accountStorage; unsupported hosts get session-only preferences. */
export function accountPreferences(context,authorize) {
    const storage=context?.accountStorage;
    if(typeof storage?.getItem==='function'&&typeof storage?.setItem==='function'){
        if(!authorize)return storage;
        const generations=new Map();
        return {getItem:key=>storage.getItem(key),setItem(key,value){const generation=(generations.get(key)||0)+1;generations.set(key,generation);return Promise.resolve().then(authorize).then(()=>{if(generations.get(key)!==generation)return false;storage.setItem(key,value);return true;}).catch(()=>false);}};
    }
    const state=new Map();return {sessionOnly:true,getItem:key=>state.get(key)||null,setItem:(key,value)=>state.set(key,String(value))};
}
export function rolePreferences(scope,namespace,legacyNamespace) {
    let storage;
    try{storage=Object.hasOwn(scope,'preferences')?scope.preferences:scope.hostWindow.localStorage;}catch{/* Sandboxed maker previews have an opaque origin. */}
    let current=null,legacy=null;
    try{
        current=storage?.getItem(namespace);
        // Automatic v1 migration never leaves the account's own store.
        const prior=current?null:storage?.getItem(legacyNamespace);
        if(prior){current=prior;storage?.setItem(namespace,prior);}
        if(Object.hasOwn(scope,'preferences')&&!current)legacy=scope.hostWindow.localStorage.getItem(namespace)||scope.hostWindow.localStorage.getItem(legacyNamespace);
    }catch{/* Preferences must not prevent playback. */}
    return {sessionOnly:!storage||storage.sessionOnly===true,read(){try{const value=JSON.parse(current||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}},write(state){try{if(!storage)return Promise.resolve(false);return Promise.resolve(storage.setItem(namespace,JSON.stringify(state))).then(value=>value!==false,()=>false);}catch{return Promise.resolve(false);}},legacy};
}

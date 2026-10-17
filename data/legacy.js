import {LocalMusicStore} from '../local-store.js';
import {CardProjectStore} from '../card-player/project-store.js';
import {createBackup,inspectBackup} from './backup.js';
/** Legacy data is read only after ownership confirmation. No legacy delete/rename API. */
export async function legacySummary() {
    const music=new LocalMusicStore({scope:'legacy'}),drafts=new CardProjectStore(globalThis.indexedDB,{scope:'legacy'});
    try{return {resources:await music.count(),projects:await drafts.count()};}
    finally{await music.close();await drafts.dispose();}
}
export async function legacyProjects(){
    const drafts=new CardProjectStore(globalThis.indexedDB,{scope:'legacy'});
    try{return await drafts.list();}finally{await drafts.dispose();}
}
export async function prepareLegacyCopy({settings,store,selectedProjects,signal,onProgress}) {
    const old=new LocalMusicStore({scope:'legacy'});
    try{
        const merged={entries:async()=>[...await old.entries(),...await store.entries()]};
        const archive=await createBackup({settings,store:merged,projects:selectedProjects,signal,onProgress});
        return await inspectBackup(archive.blob,{signal,onProgress});
    } finally{await old.close();}
}

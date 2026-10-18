import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFavorites, toggleFavorite, createSleepTimer, createAudioTransitions } from '../listening.js';
import { normalizeSettings, deleteTrackFromLibrary } from '../core.js';
import { createBackup, inspectBackup } from '../data/backup.js';
import { makeRestorePlan } from '../data/restore.js';
function clock() {
    let now = 1000, id = 0; const tasks = new Map();
    return { now: () => now, schedule: (fn, ms) => { tasks.set(++id, { fn, at: now + ms }); return id; }, unschedule: id => tasks.delete(id),
        advance(ms, throttled = false) { const end = now + ms; if (throttled) now = end; while ([...tasks.values()].some(task => task.at <= end)) { const [id, task] = [...tasks].sort((a,b) => a[1].at - b[1].at)[0]; tasks.delete(id); now = Math.max(now, task.at); task.fn(); } now = end; }, get size() { return tasks.size; } };
}
const tracks = [{ id: 'a', kind: 'url', url: 'https://example.org/a.mp3', title: 'Same' }, { id: 'b', kind: 'url', url: 'https://example.org/b.mp3', title: 'Same' }];
test('favorites normalize stable IDs, ignore invalid dates and preserve same-title recordings', () => {
    const settings = normalizeSettings({ tracks, favorites: [{ trackId:'a',at:8 },{ trackId:'a',at:9 },{trackId:'b',at:7},{trackId:'gone',at:6},{trackId:'b',at:Infinity}] }, 10);
    assert.deepEqual(settings.favorites, [{trackId:'a',at:9},{trackId:'b',at:7}]);
    assert.equal(toggleFavorite(settings, 'a', 10), false); assert.equal(toggleFavorite(settings, 'a', 10), true);
    deleteTrackFromLibrary(settings, 'a'); assert.deepEqual(settings.favorites,[{trackId:'b',at:7}]);
    assert.deepEqual(normalizeFavorites(null, new Set()), []); assert.equal(normalizeSettings({transitionDuration:777}).transitionDuration,300);
});
test('favorites and fades roundtrip in real binary ZIP and map IDs in copy/dedup restores', async () => {
    const settings = normalizeSettings({ tracks, favorites:[{trackId:'a',at:1}], transitionDuration:500 });
    const store={entries:async()=>[],get:async()=>null}, backup=await inspectBackup((await createBackup({settings,store})).blob);
    assert.deepEqual(backup.manifest.settings.favorites,settings.favorites); assert.equal(backup.manifest.settings.transitionDuration,500);
    const plan=await makeRestorePlan({backup,current:settings,store,mode:'copy',restorePreferences:true});
    assert.equal(plan.after.favorites.length,2); assert(plan.after.favorites.some(row=>row.trackId===plan.after.tracks[2].id));
    const merge=await makeRestorePlan({backup,current:settings,store,mode:'merge'}); assert.equal(merge.after.favorites.length,1);
});
test('deadline timer handles background throttling, pause/resume, replace/cancel, and one-shot track end', () => {
    const time=clock(); let expired=0; const timer=createSleepTimer({...time,onExpire:()=>expired++});
    timer.start(15); time.advance(5*60000,true); assert.equal(timer.snapshot().remaining,10*60000);
    timer.pause(); time.advance(60*60000,true); assert.equal(timer.snapshot().remaining,10*60000);
    timer.resume(); time.advance(11*60000,true); assert.equal(expired,1); assert.equal(timer.snapshot().mode,'off'); assert.equal(time.size,0);
    timer.start(1); timer.start(2); time.advance(60000); assert.equal(expired,1); timer.cancel();time.advance(60000);assert.equal(expired,1);
    timer.afterTrack();assert.equal(timer.ended(),true);assert.equal(timer.ended(),false);assert.equal(expired,2);
    // An ended event can run before a heavily throttled timeout callback.
    let lateNow=0;const late=createSleepTimer({now:()=>lateNow,schedule:()=>1,unschedule:()=>{},onExpire:()=>expired++});late.start(1);lateNow=61000;assert.equal(late.ended(),true);assert.equal(late.ended(),false);assert.equal(expired,3);
    timer.start(1);timer.dispose();time.advance(60000,true);assert.equal(expired,3);assert.equal(time.size,0);
    assert.throws(()=>createSleepTimer().start(0),/分钟/);
});
function sound() { return { paused:true,ended:false,volume:.4,muted:false,plays:0,pauses:0,play(){this.paused=false;this.plays++;return Promise.resolve();},pause(){this.paused=true;this.pauses++;} }; }
test('ramps preserve base volume and paused angle-independent audio identity; quick reverse cancels stale pause', async () => {
    const time=clock(), audio=sound();let base=.4;
    const fx=createAudioTransitions(audio,{...time,getVolume:()=>base,getDuration:()=>300});
    const start=fx.play();await Promise.resolve();time.advance(150);assert(audio.volume>0&&audio.volume<.4);time.advance(150);await start;assert.equal(audio.volume,.4);
    const pause=fx.pause();time.advance(100);const resume=fx.play();await Promise.resolve();time.advance(300);assert.equal(await pause,false);await resume;assert.equal(audio.paused,false);assert.equal(audio.volume,.4);
    const pending=fx.pause();time.advance(50);base=.17;fx.refresh();assert.equal(await pending,false);assert.equal(audio.volume,.17);assert.equal(audio.paused,false);
    const stop=fx.pause();time.advance(300);await stop;assert.equal(audio.paused,true);assert.equal(audio.volume,.17);assert.equal(base,.17);assert.equal(time.size,0);
});
test('zero, mute, denied autoplay, disposal and a pending play promise cannot resurrect audio', async () => {
    const time=clock(),audio=sound();let base=0;
    const fx=createAudioTransitions(audio,{...time,getVolume:()=>base,getDuration:()=>300});
    await fx.play();assert.equal(audio.volume,0);await fx.pause();assert.equal(audio.volume,0);
    base=.2;audio.muted=true;await fx.play();assert.equal(audio.muted,true);assert.equal(audio.volume,.2);
    audio.play=()=>Promise.reject(Object.assign(new Error('denied'),{name:'NotAllowedError'}));await assert.rejects(fx.play(),{name:'NotAllowedError'});assert.equal(audio.volume,.2);
    let finish; audio.play=()=>{audio.paused=false;return new Promise(resolve=>{finish=resolve;});};const pending=fx.play();fx.dispose();finish();assert.equal(await pending,false);assert.equal(audio.paused,true);assert.equal(time.size,0);
});

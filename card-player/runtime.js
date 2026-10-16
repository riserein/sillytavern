import { formatTime } from '../core.js';
import { playSymbol } from '../player-components.js';
import { watchRoleLifetime } from './lifecycle.js';
import { clampPosition } from '../floating.js';

/** Standalone phase-one view. One host-owned audio element per role/project. */
export function mountCardPlayer(config, scope) {
    const { hostDocument: doc, hostWindow: win, roleId } = scope;
    if (!roleId || scope.currentRole() !== roleId) throw new Error('角色作用域已改变，取消创建播放器。');
    const existing = [...doc.querySelectorAll('[data-riserein-card-player]')].find(node => node.dataset.risereinCardPlayer === config.id && node.dataset.roleId === roleId);
    if (existing?.__risereinPlayer && !existing.__risereinPlayer.disposed) return existing.__risereinPlayer;
    if (existing) throw new Error('发现未知的同名播放器节点，请刷新后重试。');
    if (!config.tracks?.length || config.tracks.some(track => !/^data:audio\/mpeg;base64,[A-Za-z0-9+/=]+$/.test(track.src))) throw new Error('阶段一只接受随脚本携带的测试音频。');

    const root = doc.createElement('section');
    root.dataset.risereinCardPlayer = config.id; root.dataset.roleId = roleId;
    root.dataset.scriptId = scope.scriptId;
    const shadow = root.attachShadow({mode:'open'});
    shadow.innerHTML = `<style>
        :host{position:fixed;display:block;width:max-content;right:18px;bottom:88px;z-index:3100;color:#e8eee6;font:14px/1.5 system-ui,sans-serif;max-width:calc(100vw - 24px)}
        *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer;border:0;color:inherit;background:transparent}button:focus-visible,input:focus-visible{outline:2px solid #b2c3b1;outline-offset:3px}[hidden]{display:none!important}
        .ball{position:relative;width:48px;height:48px;border:1px solid #879b8b;border-radius:50%;display:grid;place-items:center;padding:0}.ball::before{content:"";position:absolute;inset:0;border-radius:50%;background:repeating-radial-gradient(circle,#151817 0 2px,#343b36 2px 3px);animation:spin 18s linear infinite;animation-play-state:paused;pointer-events:none}.ball span{position:relative;display:grid;place-items:center;width:25px;height:25px;border-radius:50%;background:#b2c3b1;color:#182220;font-size:15px;pointer-events:none}
        :host([data-playing=true]) .ball::before{animation-play-state:running}.panel{width:320px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 120px);overflow:auto;padding:18px;border:1px solid #758878;border-radius:14px;background:#182220;box-shadow:0 8px 24px #0003}.head{display:flex;align-items:center;justify-content:space-between;gap:8px}.head strong{font-size:14px}.head button{width:40px;height:40px;font-size:22px}p{margin:10px 0;color:#b4bfb4;font-size:12px}.title{display:block;font-size:19px;overflow-wrap:anywhere;margin:12px 0}input{accent-color:#b2c3b1}.seek{width:100%}.time{display:flex;justify-content:space-between;font-size:11px;color:#b4bfb4}.play{display:grid;place-items:center;width:50px;height:50px;border-radius:50%;background:#b2c3b1;color:#182220;margin:12px auto}.play svg{width:23px;height:23px;fill:currentColor}.volume{display:flex;align-items:center;gap:12px;font-size:12px}.volume input{min-width:0;flex:1}ol{list-style:none;margin:16px 0 0;padding:0}li button{width:100%;text-align:left;min-height:44px;padding:10px 6px;border-top:1px solid #b2c3b133}li button[aria-current=true]{color:#b2c3b1;background:#b2c3b112}.status{min-height:18px;color:#e5c597}.hint{font-size:11px;color:#b4bfb4}
        @keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.ball::before{animation:none}}
    </style><button class="ball" aria-label="展开角色音乐播放器" aria-expanded="true"><span>♪</span></button><section class="panel" role="region" aria-label="角色专属音乐播放器"><header class="head"><strong>角色播放器 · 生命周期测试</strong><button aria-label="收起角色播放器">×</button></header><p>三首原创合成测试音，不是正式曲库。</p><strong class="title"></strong><label class="hint" for="rscp-seek">播放进度</label><input id="rscp-seek" class="seek" type="range" min="0" max="0" step="0.1" value="0" disabled><div class="time"><span data-time="elapsed">0:00</span><span data-time="duration">0:00</span></div><button class="play" aria-label="播放角色音乐"></button><label class="volume">音量<input type="range" min="0" max="100" value="20" aria-label="角色音乐音量"></label><ol aria-label="角色测试歌单"></ol><p class="status" role="status"></p></section>`;
    const audio = doc.createElement('audio'); audio.preload = 'metadata'; shadow.append(audio);
    const query = selector => shadow.querySelector(selector);
    const abort = new win.AbortController();
    const namespace = `riserein:card-player:v1:${encodeURIComponent(config.id)}:${encodeURIComponent(roleId)}`;
    let selected = 0, disposed = false, live = false, listeners = 0, lifetime;
    try { const stored = JSON.parse(win.localStorage.getItem(namespace) || '{}'); if (Number.isFinite(stored.volume)) audio.volume = Math.min(1,Math.max(0,stored.volume)); else audio.volume = .2; } catch { audio.volume = .2; }
    query('.volume input').value = String(Math.round(audio.volume * 100));
    const listen = (target, name, handler) => { target.addEventListener(name,handler,{signal:abort.signal}); listeners++; };
    const render = () => {
        if (disposed) return;
        const playing = !audio.paused && !audio.ended;
        query('.play').innerHTML = playSymbol(playing);
        query('.play').setAttribute('aria-label',playing ? '暂停角色音乐' : '播放角色音乐');
        root.dataset.playing = String(live && playing);
        for (const [i,button] of [...query('ol').querySelectorAll('button')].entries()) button.setAttribute('aria-current',String(i === selected));
    };
    async function play() {
        if (disposed || scope.currentRole() !== roleId) { lifetime?.dispose(); return; }
        try { await audio.play(); if (!disposed) query('.status').textContent = ''; }
        catch (error) { if (!disposed && error.name !== 'AbortError') query('.status').textContent = error.name === 'NotAllowedError' ? '浏览器需要你亲自点击播放。' : '测试音频无法播放，请检查浏览器的音频支持。'; }
    }
    function select(index, shouldPlay = false) {
        if (disposed) return;
        selected = index; live = false; audio.pause(); audio.src = config.tracks[index].src; audio.load();
        query('.title').textContent = config.tracks[index].title; query('.status').textContent = ''; render();
        if (shouldPlay) void play();
    }
    config.tracks.forEach((track,index) => {
        const row = doc.createElement('li'),button = doc.createElement('button');
        button.type = 'button'; button.textContent = track.title; button.setAttribute('aria-label',`选择测试曲：${track.title}`);
        listen(button,'click',() => { if (index === selected) { if (audio.paused) void play(); else audio.pause(); } else select(index,true); });
        row.append(button); query('ol').append(row);
    });
    listen(query('.play'),'click',() => { if (audio.paused) void play(); else audio.pause(); });
    const progress = () => {
        if (disposed) return;
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        query('.seek').max = String(duration); query('.seek').disabled = duration <= 0; query('.seek').value = String(audio.currentTime || 0);
        query('[data-time=elapsed]').textContent = formatTime(audio.currentTime); query('[data-time=duration]').textContent = formatTime(duration);
    };
    for (const name of ['timeupdate','loadedmetadata','durationchange','emptied']) listen(audio,name,progress);
    for (const name of ['play','playing','pause','waiting','ended','error']) listen(audio,name,() => {
        if (name === 'playing') live = true;
        else if (['pause','waiting','ended','error'].includes(name)) live = false;
        render();
    });
    listen(audio,'error',() => { if (!disposed) query('.status').textContent = '测试音频加载失败，请检查浏览器支持。'; });
    listen(query('.seek'),'input',event => { if (Number.isFinite(audio.duration)) audio.currentTime = Number(event.target.value); });
    listen(query('.volume input'),'input',event => {
        audio.volume = Number(event.target.value)/100;
        try { win.localStorage.setItem(namespace,JSON.stringify({volume:audio.volume})); } catch { /* Optional preferences never prevent playback. */ }
    });
    function place() {
        if (disposed) return;
        const size = root.getBoundingClientRect();
        const position = clampPosition({x:win.innerWidth-size.width-18,y:win.innerHeight-size.height-88},size,{width:win.innerWidth,height:win.innerHeight});
        // ST's mobile body can have zero height: a bottom offset can put the whole player above the screen.
        Object.assign(root.style,{left:`${position.x}px`,top:`${position.y}px`,right:'auto',bottom:'auto'});
    }
    function setExpanded(expanded) { query('.panel').hidden = !expanded; query('.ball').hidden = expanded; query('.ball').setAttribute('aria-expanded',String(expanded)); place(); }
    listen(win,'resize',place);
    listen(query('.head button'),'click',() => setExpanded(false)); listen(query('.ball'),'click',() => setExpanded(true));
    const api = {
        audio, roleId, scriptId:scope.scriptId, root,
        get disposed() { return disposed; },
        get resourceCounts() { return {listeners,subscriptions:lifetime?.subscriptions || 0,timers:0,observers:lifetime?.disposed ? 0 : 1}; },
        dispose() { lifetime?.dispose(); },
    };
    root.__risereinPlayer = api;
    doc.body.append(root); setExpanded(true); select(0);
    lifetime = watchRoleLifetime(scope,() => {
        if (disposed) return;
        disposed = true; abort.abort(); listeners = 0; live = false;
        audio.pause(); audio.removeAttribute('src'); audio.load(); audio.remove();
        root.remove(); delete root.__risereinPlayer;
    });
    return api;
}

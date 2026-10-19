import { createVisibilityController } from './ui/visibility.js';
import { effectiveLyricOffset } from './ui/lyric-timing.js';
import { createLyricsLookup } from './lyrics.js';
import { applyReading, createReadingControls } from './ui/reading.js';
import { createLyricReader } from './ui/lyric-reader.js';
import { createCardMaker } from './card-maker.js';
import { createPlatformService } from './platforms/service.js';
import { PLATFORM_NAMES } from './platforms/catalog.js';
import { BUILTIN_ID, findTrack, planImport, allTracks } from './platforms/library.js';
import { ONLINE_MARKUP, createOnlinePanel } from './online-panel.js';
import { createOfficialPlayer } from './platforms/embeds.js';
import {
    MAX_TRACKS, PLAY_MODES, createTrackId, normalizeSettings, normalizeUrl, titleFromUrl, nextTrackId, formatTime, validateAudioFile,
    getQueue, createPlaylist, renamePlaylist, addTrackToPlaylist, removeTrackFromPlaylist, deleteTrackFromLibrary,
    deletePlaylist, bindPlaylistCharacters, currentCharacterAvatar, playlistForCharacter,
    recordPlayback, recentTracks, rankedTracks, ensureLibraryTrack,
} from './core.js';
import { LocalMusicStore } from './local-store.js';
import { makeDraggable } from './floating.js';
import { makeResizable } from './resizing.js';
import { createSelectMenus } from './select-menu.js';
import { resolveScheme, themePalette } from './scheme.js';
import { createImageCropper, validateImageFile } from './background.js';
import { fallbackCoverUrl, randomCover, readEmbeddedMetadata, prepareCover, parseLyrics, currentLyricIndex, MAX_LYRICS } from './media.js';
import { createFontPicker } from './font-picker.js';
import { createMiniPlayer, playSymbol } from './player-components.js';
import { CUSTOM_PROPERTIES, customPalette, hexRgba, defaultMaskOpacity, attachClickEffects } from './appearance.js';
import { createPlayerUI } from './player-ui.js';
import { createPlaybackQueue } from './playback-queue.js';
import { createNativeCardExport } from './card-player/native-export.js';
import { createCardHandoff } from './card-player/handoff.js';
import { createAssetRetirement } from './asset-retirement.js';

import { identifyAccount, setStorageScope, createAccountGuard } from './data/identity.js';
import { MaintenanceJournal } from './data/journal.js';
import { createDataPanel } from './data/panel.js';
import { createAudioTransitions } from './listening.js';
import { createListeningPanel } from './listening-panel.js';
import {unreferencedResourceIds} from './card-player/resource-references.js';
import { normalizeDesign } from './ui/config.js';
import { createDesignPresentation } from './ui/presentation.js';
import { createDesignControls } from './ui/controls.js';
import {createDesignEditor} from './ui/editor.js';
import {createDesignFontLayer} from './ui/font-layer.js';
import { createLauncherControls } from './ui/launcher-controls.js';
import { createLauncherAvoidance } from './ui/launcher-avoidance.js';
import { roleSceneGroup, selectedScene, rememberScene, sceneIssues } from './music-scenes.js';
import { createScenePicker, createSceneManager } from './music-scenes-panel.js';
import { createJournal } from './ui/journal.js';
import { prepareDesignIcon } from './ui/images.js';

const SETTINGS_KEY = 'riserein_music_player';
// Keep the build-time guard explicit at author-only branches: esbuild can then
// eliminate storage, platform search and the maker from the independent target.

export function initialize(options = {}) {
    if (document.querySelector('#stm-player:not([data-portable])')) return;
    const context = options.context || globalThis.SillyTavern?.getContext();
    if (!context?.extensionSettings || !context.saveSettingsDebounced) {
        console.error('[音乐播放器] 无法获取酒馆扩展接口，请更新 SillyTavern。');
        return;
    }

    const settings = normalizeSettings(context.extensionSettings[SETTINGS_KEY] ?? { theme: 'night', colorScheme: 'dark', surface: 'matte', panelSize: { width: 640, height: 700 } });
    context.extensionSettings[SETTINGS_KEY] = settings;
    if (!(typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__)) {
        window.__risereinFullMusicPlayer = true;
        window.dispatchEvent(new Event('riserein:full-player-start'));
        document.querySelector('[data-riserein-card-player]')?.__risereinPlayer?.dispose();
    }
    const store = (typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__) ? options.store : new LocalMusicStore();
    const platformService = (typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__) ? { canPlay: track => Boolean(track), canEmbed: () => false } : createPlatformService();
    let disposed = false;
    let maintenanceBusy = false;
    let maintenanceControls=[];
    function setMaintenanceBusy(value){
        if(maintenanceBusy===value)return;maintenanceBusy=value;
        if(value){
            panel.setAttribute('aria-busy','true');
            maintenanceControls=[...panel.querySelectorAll('button,input,select,textarea')].filter(node=>!node.closest('[data-role=data-tools]')).map(node=>[node,node.disabled]);
            for(const [node]of maintenanceControls)node.disabled=true;
        }else{panel.removeAttribute('aria-busy');for(const [node,disabled]of maintenanceControls)node.disabled=disabled;maintenanceControls=[];}
    }
    let dataPanel = null;
    let online = null;
    let listening = null;
    let designEditor = null, designFont = null;
    let designPresentation = null, designControls = null, readingControls = null, lyricReader = null, launcherControls = null, launcherAvoidance = null, previewDesign = null, visibility = null, fullRecoveryEntry = null;
    let platformLoadController = null;
    let objectUrl = null;
    let loadSequence = 0;
    let selectionPending = false;
    let importing = false;
    let viewRevision = 0;
    let lastRoleAvatar = null;
    let roleRevision = 0;
    let canAutoAdvance = true;
    let membershipTrackId = null;
    let libraryDetail = false;
    let browsedPlaylistId = settings.activePlaylistId;
    let activeSceneState=null, scenePicker=null, sceneManager=null, sceneVisualEpoch=0, sceneImageUrl=null, scenePreview=null, journalUI=null;
    const playbackQueue = createPlaybackQueue(id => activeSceneState && id===activeSceneState.queueKey ? activeSceneState.scene.trackIds.map(id=>findTrack(settings,id)).filter(Boolean) : getQueue(settings, id));
    playbackQueue.reset(settings.activePlaylistId);
    const librarySelection = new Set();
    const sheetReturnFocus = new Map();
    let statusTimer;
    let currentPage = 'playback';
    let playSession = 0;
    let countedSession = -1;
    let backgroundUrl = null;
    let backgroundRevision = 0;
    let coverUrl = null;
    let mediaRevision = 0;
    let lyricData = { synced: false, lines: [] };
    let activeLyric = -1;
    let detailsTrackId = null;
    const coverCache = new Map();

    const launcher = document.createElement('div');
    launcher.id = 'stm-launcher';
    launcher.setAttribute('role', 'button'); launcher.tabIndex = 0;
    launcher.className = 'stm-launcher';
    launcher.textContent = '♫';
    launcher.title = '点击打开音乐播放器，拖动可移动';
    launcher.setAttribute('aria-label', '打开音乐播放器');
    launcher.setAttribute('aria-controls', 'stm-player');
    launcher.setAttribute('aria-expanded', 'false');

    const panel = document.createElement('section');
    panel.id = 'stm-player';
    panel.className = 'stm-player';
    panel.dataset.page = 'playback';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '音乐播放器');
    panel.innerHTML = `
        <header class="stm-header" tabindex="0" aria-label="拖动播放器窗口，可用方向键移动" title="拖动这里移动窗口">
            <span class="stm-grip" aria-hidden="true">⠿</span>
            <div class="stm-header-actions">
                <button type="button" class="stm-secondary" data-action="appearance" aria-expanded="false" aria-controls="stm-appearance" aria-label="外观设置" title="外观">◐</button>
                <button type="button" class="stm-icon" data-action="close" aria-label="关闭播放器" title="关闭面板，音乐继续播放">×</button>
            </div>
        </header>
        <nav class="stm-tabs" role="tablist" aria-label="播放器页面">
            <button type="button" role="tab" id="stm-tab-playback" data-page="playback" aria-controls="stm-page-playback" aria-selected="true">播放</button>
            <button type="button" role="tab" id="stm-tab-library" data-page="library" aria-controls="stm-page-library" aria-selected="false" tabindex="-1">曲库</button>
            <button type="button" role="tab" id="stm-tab-import" data-page="import" aria-controls="stm-page-import" aria-selected="false" tabindex="-1">导入</button>
            <button type="button" role="tab" id="stm-tab-recent" data-page="recent" aria-controls="stm-page-recent" aria-selected="false" tabindex="-1">最近播放</button>
            <button type="button" role="tab" id="stm-tab-ranking" data-page="ranking" aria-controls="stm-page-ranking" aria-selected="false" tabindex="-1">播放排行</button>
            <button type="button" role="tab" id="stm-tab-appearance" data-page="appearance" aria-controls="stm-appearance" aria-selected="false" tabindex="-1">外观</button>
        </nav>
        <audio preload="metadata"></audio>
        <section id="stm-page-playback" class="stm-page" role="tabpanel" aria-labelledby="stm-tab-playback" data-view="playback">
        <button type="button" class="stm-cover-stage" data-action="toggle-lyrics" aria-label="显示歌词" aria-pressed="false">
            <img class="stm-cover-image" alt="当前歌曲封面" draggable="false">
            <span class="stm-cover-tip">轻点查看歌词</span>
        </button>
        <div class="stm-now"><div class="stm-now-info"><strong data-role="title">挑一首喜欢的歌</strong><span data-role="source">从曲库开始今天的旋律</span></div></div>
        <label class="stm-sr-only" for="stm-seek">播放进度</label>
        <input id="stm-seek" class="stm-range" type="range" min="0" max="0" step="0.1" value="0" disabled>
        <div class="stm-time"><span data-role="elapsed">0:00</span><span data-role="duration">0:00</span></div>
        <div class="stm-transport">
            <button type="button" class="stm-icon" data-action="previous" aria-label="上一首" title="上一首"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 5 7 12l10 7zM5 5h2v14H5z"/></svg></button>
            <button type="button" class="stm-primary stm-play" data-action="play" aria-label="播放" title="播放"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg></button>
            <button type="button" class="stm-icon" data-action="next" aria-label="下一首" title="下一首"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 5 10 7-10 7zM17 5h2v14h-2z"/></svg></button>
        </div>
        <div class="stm-options"><button type="button" id="stm-mode" class="stm-mode" aria-label="播放模式：列表循环" title="列表循环 · 点击切换播放模式"></button></div>
        <div class="stm-volume">
            <button type="button" class="stm-icon" data-action="mute" aria-label="静音" title="静音">♪</button>
            <label class="stm-sr-only" for="stm-volume">音量</label>
            <input id="stm-volume" class="stm-range" type="range" min="0" max="100" step="1">
            <output for="stm-volume" data-role="volume"></output>
        </div>
        <div class="stm-divider"></div>
        <div class="stm-library-nav">
            <label class="stm-sr-only" for="stm-playlist">选择歌单</label>
            <select id="stm-playlist"><option value="">总曲库</option></select>
            <button type="button" class="stm-secondary" data-action="toggle-queue" aria-expanded="false" aria-controls="stm-queue">播放队列</button>
            <button type="button" class="stm-secondary" data-action="manage-playlists" aria-controls="stm-page-library">歌单管理</button>
        </div>
        <p class="stm-role-status" data-role="role-status"></p>
        <p class="stm-queue-empty stm-page-empty">前往「导入」添加音乐，或在曲库选择一首歌。</p>
        </section>
        <section id="stm-page-library" class="stm-page" role="tabpanel" aria-labelledby="stm-tab-library" data-view="library" hidden>
        <div class="stm-page-heading stm-heading-actions"><div><h3>我的音乐</h3><span>你的收藏，每一段旋律</span></div><button type="button" class="stm-secondary" data-action="new-playlist">＋ 新建歌单</button></div>
        <button type="button" class="stm-secondary stm-maker-entry" data-action="card-maker">角色卡播放器制作 ↗</button><button type="button" class="stm-secondary" data-action="rebuild-native">检查 / 重建当前角色的随卡播放器</button>
        <details class="stm-hint" data-role="card-handoff"><summary>随卡分发：接收端没有播放器？</summary><p>确认“音乐已随卡保存”后，从酒馆原生菜单重新导出 PNG / JSON，再发送新文件。旧文件不会自动更新。</p><p>接收端无需安装音乐插件，但必须安装并启用酒馆助手，在打开角色卡时确认启用嵌入式脚本。若曾取消，请到“酒馆助手 → 脚本库 → 角色脚本”手动启用。未安装酒馆助手的原生酒馆无法执行随卡脚本。</p><button type="button" class="stm-secondary">检查要分发的 PNG / JSON</button><input type="file" accept=".png,.json" hidden><p data-role="handoff-result" aria-live="polite">选择实际要发送的文件，检查播放器、音乐和外观是否已经写入。只读取文件，不执行脚本、不改角色卡。</p></details>
        <div id="stm-create-playlist-panel" hidden>
            <form class="stm-create-playlist">
                <label for="stm-new-playlist" data-role="create-title">给新歌单起个名字</label>
                <div class="stm-inline-form"><input id="stm-new-playlist" placeholder="例如：雨夜、角色主题曲" maxlength="80" required autocomplete="off"><button type="submit" class="stm-primary">新建</button></div>
                <p class="stm-hint">建好后可直接导入音乐，也可以到总曲库，点歌曲右侧的“⋯”，再选“加入歌单”。</p>
                <button type="button" class="stm-secondary" data-action="cancel-create">取消</button>
            </form>
        </div>
        <div id="stm-library-home">
            <div class="stm-library-collections" data-role="all-collection"></div>
            <div data-role="builtin-collection"></div>
            <section id="stm-created-playlists" hidden><div class="stm-list-heading"><h3>自建歌单</h3></div><div class="stm-library-collections" data-role="playlist-collections"></div></section>
            <p class="stm-hint">点“总曲库”查看全部歌曲；点右上角“新建歌单”整理音乐。</p>
        </div>
        <select id="stm-library-playlist" data-no-menu aria-label="当前查看的歌单" hidden><option value="">总曲库</option></select>
        <div id="stm-library-detail" hidden>
        <button type="button" class="stm-secondary" data-action="library-home">‹ 我的音乐</button>
        <div class="stm-collection-hero"><img alt="歌单封面"><div><strong data-role="hero-title"></strong><small data-role="hero-meta"></small><p data-role="hero-description"></p></div></div>
        <div class="stm-list-heading"><h3><span data-role="collection-title">总曲库</span> <span data-role="count">0</span></h3><button type="button" class="stm-secondary" data-action="toggle-manager" aria-expanded="false" aria-controls="stm-playlist-manager">管理此歌单</button></div>
        <div class="stm-collection-actions"><button type="button" class="stm-secondary" data-action="go-import">＋ 导入音乐</button><button type="button" class="stm-secondary" data-action="choose-library-songs">从总曲库选歌</button></div>
        <div id="stm-playlist-manager" class="stm-playlist-manager" hidden>
            <div class="stm-playlist-editor" hidden>
                <form class="stm-rename-playlist stm-inline-form">
                    <label class="stm-sr-only" for="stm-playlist-name">修改歌单名称</label>
                    <input id="stm-playlist-name" maxlength="80" required autocomplete="off">
                    <button type="submit" class="stm-secondary">保存名称</button>
                </form>
                <label class="stm-description-label" for="stm-playlist-description">歌单简介</label><textarea id="stm-playlist-description" maxlength="240" rows="2" placeholder="给这张歌单写一段话"></textarea><button type="button" class="stm-secondary" data-action="save-description">保存简介</button>
                <div class="stm-playlist-actions">
                    <button type="button" class="stm-secondary" data-action="playlist-cover">更换歌单封面</button>
                    <button type="button" class="stm-secondary" data-action="clear-playlist-cover">恢复默认封面</button>
                    <input type="file" data-role="playlist-cover-file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden>
                    <button type="button" class="stm-secondary" data-action="bind-roles" aria-expanded="false" aria-controls="stm-role-bindings">绑定角色</button>
                    <button type="button" class="stm-secondary" data-action="edit-order" aria-pressed="false">调整歌曲顺序</button>
                    <button type="button" class="stm-secondary stm-danger" data-action="delete-playlist">删除歌单</button>
                </div>
                <form id="stm-role-bindings" hidden>
                    <p class="stm-hint">可绑定多个角色。保存后，将音乐与播放器写入角色卡，支持使用酒馆原生按钮导出 PNG / JSON。已有绑定会更新为当前歌单；接收端需启用酒馆助手角色脚本。</p>
                    <div class="stm-role-picker"></div>
                    <button type="submit" class="stm-secondary">保存绑定</button>
                </form>
            </div>
            <p class="stm-hint">删除歌单保留全部歌曲。进入绑定角色时只切歌单，音乐需手动播放。</p>
        </div>
        <div class="stm-membership" hidden>
            <strong data-role="membership-title"></strong>
            <p class="stm-hint">选择目标歌单，再点“加入歌单”。原曲仍保留在总曲库。</p>
            <button type="button" class="stm-secondary" data-action="create-for-song">＋ 新建歌单并加入这首歌</button>
            <div class="stm-inline-form">
                <label class="stm-sr-only" for="stm-add-target">加入哪个歌单</label>
                <select id="stm-add-target"></select>
                <button type="button" class="stm-secondary" data-action="confirm-membership">加入歌单</button>
                <button type="button" class="stm-icon" data-action="close-membership" aria-label="取消加入歌单">×</button>
            </div>
        </div>
        <div class="stm-library-tools">
            <label class="stm-sr-only" for="stm-library-search">搜索当前曲库</label><input id="stm-library-search" type="search" placeholder="搜索歌名或歌手" autocomplete="off">
            <label class="stm-sr-only" for="stm-library-sort">曲库显示顺序</label><select id="stm-library-sort"><option value="original">原有顺序</option><option value="title">歌名排序</option><option value="artist">歌手排序</option></select>
            <label class="stm-sr-only" for="stm-library-filter">歌曲来源</label><select id="stm-library-filter"><option value="all">全部来源</option><option value="playable">可直接播放</option><option value="local">本地音乐</option><option value="url">音频直链</option><option value="platform">在线平台</option><option value="restricted">受限来源</option></select>
            <button type="button" class="stm-secondary" data-action="toggle-bulk" aria-pressed="false">批量管理</button>
        </div>
        <div class="stm-bulk-tools" hidden><label class="stm-check-label"><input type="checkbox" id="stm-select-visible">选择本页结果</label><span data-role="selection-count"></span><label class="stm-sr-only" for="stm-bulk-target">批量加入的歌单</label><select id="stm-bulk-target"></select><button type="button" class="stm-secondary" data-action="bulk-add">加入歌单</button><button type="button" class="stm-secondary" data-action="bulk-unlink">从此歌单移除</button><button type="button" class="stm-secondary stm-danger" data-action="bulk-delete">从曲库删除</button></div>
        <p class="stm-search-empty" hidden>没有匹配的歌曲，试试其他关键词或来源。</p>
        <ol class="stm-track-list" aria-label="播放列表"></ol>
        <p class="stm-empty">曲库还没有歌曲，点上方“导入音乐”开始吧。</p>
        </div>
        </section>
        <section id="stm-page-import" class="stm-page" role="tabpanel" aria-labelledby="stm-tab-import" data-view="import" hidden>
            <div class="stm-page-heading"><h3>让音乐住进来</h3><span>本地音乐、直链与在线收藏</span></div>
            <div class="stm-import-target"><label for="stm-import-playlist">导入到</label><select id="stm-import-playlist"><option value="">不选择 · 仅加入总曲库</option></select></div>
            ${ONLINE_MARKUP}
            <div id="stm-direct-import" role="tabpanel" aria-label="本地与直链">
            <button type="button" class="stm-upload-zone" data-action="import"><svg class="stm-upload-symbol" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 22V5m-6 6 6-6 6 6M6 22v5h20v-5"/></svg><strong>选择本地音乐</strong><small>MP3 / WAV / FLAC / M4A · 支持多选</small></button>
            <input type="file" data-role="files" accept="audio/*,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.opus,.webm" multiple hidden>
            <div class="stm-import-divider">或添加音频直链</div>
            <form class="stm-url-form"><label class="stm-sr-only" for="stm-url">音乐直链</label><input id="stm-url" type="url" placeholder="https://… / music.mp3" required autocomplete="off"><button type="submit" class="stm-secondary">添加</button></form>
            <p class="stm-hint">需要可直接播放的音频文件地址。平台分享链接请使用“分享链接”入口。</p>
            </div>
            <button type="button" class="stm-text-link" data-action="go-library">查看我的曲库 ↗</button>
        </section>
        <section id="stm-page-recent" class="stm-page" role="tabpanel" aria-labelledby="stm-tab-recent" data-view="recent" hidden>
            <div class="stm-page-heading"><h3>最近播放</h3><span>最近听过的 100 首歌</span></div>
            <ol class="stm-recent-list stm-history-list" aria-label="最近播放"></ol>
            <p class="stm-recent-empty stm-page-empty">还没有播放记录，播放一首喜欢的歌吧。</p>
        </section>
        <section id="stm-page-ranking" class="stm-page" role="tabpanel" aria-labelledby="stm-tab-ranking" data-view="ranking" hidden>
            <div class="stm-page-heading"><h3>播放次数排行</h3><span>最近 72 小时 · 从高到低</span></div>
            <p class="stm-hint">歌曲开始播放计 1 次，暂停后继续不重复计数。</p>
            <ol class="stm-ranking-list stm-history-list" aria-label="近三天播放排行"></ol>
            <p class="stm-ranking-empty stm-page-empty">近三天还没有播放记录。</p>
        </section>
        <section id="stm-appearance" class="stm-page stm-appearance" role="tabpanel" aria-labelledby="stm-tab-appearance" data-view="appearance" hidden>
            <div class="stm-page-heading"><h3>配色与背景</h3><span>为音乐换一种氛围</span></div>
            <label class="stm-check-label"><input type="checkbox" id="stm-hide-builtin">隐藏默认曲库</label>
            <p class="stm-hint" data-role="builtin-hint">默认歌曲由开发者随版本提供，不占自建歌单数量。</p>
            <div class="stm-scheme-control"><span>日夜外观</span><div class="stm-scheme-options" role="group" aria-label="日夜外观"><button type="button" data-scheme-choice="system">跟随系统</button><button type="button" data-scheme-choice="light">日间</button><button type="button" data-scheme-choice="dark">夜间</button></div><p class="stm-hint">保留当前配色与背景，自定义颜色优先。</p></div>
            <section class="stm-font-section">
                <div class="stm-font-heading"><span>界面字体</span><button type="button" class="stm-secondary" data-action="import-font">＋ 导入字体</button></div>
                <button type="button" id="stm-font" aria-label="选择界面字体" aria-expanded="false" aria-controls="stm-font-gallery"><strong>跟随酒馆</strong><span>预览与选择 ⌄</span></button>
                <div id="stm-font-gallery" class="stm-font-gallery" role="radiogroup" aria-label="字体预览与选择" hidden></div>
                <input type="file" data-role="font-file" accept=".woff2,.woff,.ttf,.otf" multiple hidden>
                <p class="stm-hint" data-role="font-status"></p>
            </section>
            <div class="stm-theme-grid" role="group" aria-label="选择配色"></div>
            <div class="stm-custom-colors">
                <label class="stm-check-label"><input type="checkbox" id="stm-custom-colors">自定义配色</label>
                <div class="stm-color-inputs">
                    <label>点缀色<input type="color" data-color="accent" aria-label="自定义点缀色"></label>
                    <label>背景色<input type="color" data-color="background" aria-label="自定义背景色"></label>
                    <label>文字色<input type="color" data-color="text" aria-label="自定义文字色"></label>
                </div>
                <p class="stm-hint">修改颜色即启用；选择上方预设即可恢复预设配色。</p>
            </div>
            <div class="stm-surface-row" role="group" aria-label="选择质感">
                <button type="button" class="stm-secondary" data-surface-choice="matte">雾面</button>
                <button type="button" class="stm-secondary" data-surface-choice="glass">毛玻璃</button>
                <button type="button" class="stm-secondary" data-surface-choice="clear" disabled title="导入背景图片后可用">清透</button>
            </div>
            <div class="stm-mask-control">
                <div class="stm-mask-heading"><label for="stm-mask-transparency">遮罩透明度</label><output for="stm-mask-transparency" data-role="mask-transparency"></output></div>
                <input id="stm-mask-transparency" class="stm-range" type="range" min="0" max="100" step="1" aria-label="遮罩透明度">
                <div class="stm-mask-caption"><span class="stm-hint">越高越通透，两种质感分别记忆</span><button type="button" class="stm-secondary" data-action="reset-mask">重置透明度</button></div>
            </div>
            <label class="stm-check-label stm-effects-toggle"><input type="checkbox" id="stm-click-effects">播放器点击涟漪</label>
            <div class="stm-background-card">
                <div class="stm-background-preview" aria-label="当前背景图片预览"><span>你的图片，你的氛围</span></div>
                <div class="stm-background-actions">
                    <button type="button" class="stm-secondary" data-action="import-background">导入背景图片</button>
                    <button type="button" class="stm-secondary" data-action="recrop-background" disabled>重新裁剪</button>
                    <button type="button" class="stm-secondary" data-action="remove-background" disabled>移除图片</button>
                </div>
                <input type="file" data-role="background-file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden>
                <p class="stm-hint">支持 10 MB 以内图片，导入后可拖动、缩放裁剪。雾面与毛玻璃叠加在图片上；清透直接使用图片背景。</p>
                <p class="stm-hint" data-role="background-status">图片仅保存在当前浏览器。</p>
            </div>
            <button type="button" class="stm-secondary" data-action="reset-position">重置窗口大小与位置</button>
        </section>
        <p class="stm-status" role="status" aria-live="polite"></p>
        <footer class="stm-footer">关闭面板，音乐继续</footer>
        <div id="stm-queue" class="stm-queue-overlay" hidden>
            <div class="stm-queue-scrim" data-action="close-queue" aria-hidden="true"></div>
            <section class="stm-queue-sheet" role="dialog" aria-modal="true" aria-label="当前播放列表">
                <span class="stm-sheet-grip" aria-hidden="true"></span>
                <header><div><strong>当前播放</strong><span data-role="queue-count"></span><small data-role="queue-source"></small></div><button type="button" class="stm-icon" data-action="close-queue" aria-label="关闭播放列表">×</button></header>
                <div class="stm-queue-tools"><span>临时调整不会修改歌单</span><button type="button" class="stm-secondary" data-action="reset-queue">恢复歌单顺序</button></div><ol class="stm-queue-list" aria-label="当前歌单"></ol><p class="stm-sheet-empty stm-hint">播放列表还是空的。</p>
            </section>
        </div>
        <div id="stm-details" class="stm-queue-overlay stm-details-overlay" hidden>
            <div class="stm-queue-scrim" data-action="close-details" aria-hidden="true"></div>
            <section class="stm-queue-sheet stm-track-details" role="dialog" aria-modal="true" aria-label="歌曲详情">
                <span class="stm-sheet-grip" aria-hidden="true"></span>
                <header><strong>歌曲详情</strong><button type="button" class="stm-icon" data-action="close-details" aria-label="关闭歌曲详情">×</button></header>
                <div class="stm-details-content">
                    <div class="stm-details-summary"><img class="stm-details-cover" alt="歌曲封面"><div><strong data-role="details-title"></strong><small data-role="details-source"></small></div></div>
                    <div class="stm-detail-primary-actions"><button type="button" class="stm-primary" data-action="detail-play">播放</button><button type="button" class="stm-secondary" data-action="detail-membership">加入歌单</button><button type="button" class="stm-secondary" data-action="detail-unlink">从此歌单移除</button><button type="button" class="stm-secondary stm-danger" data-action="detail-delete">从曲库删除</button></div>
                    <p class="stm-hint">让封面和歌词，成为这首歌的一部分。</p>
                    <div class="stm-platform-credit stm-hint" data-role="platform-credit" hidden></div>
                    <button type="button" class="stm-secondary" data-action="open-official" hidden>打开官方播放器</button>
                    <div class="stm-official-player" data-role="official-player" hidden></div>
                    <div class="stm-detail-actions">
                        <button type="button" class="stm-secondary" data-action="song-cover" aria-label="添加封面"><span>添加封面</span><small aria-hidden="true">上传喜欢的图片</small></button>
                        <button type="button" class="stm-secondary" data-action="find-song-lyrics"><span>查找歌词</span><small aria-hidden="true">搜索并预览歌词</small></button><button type="button" class="stm-secondary" data-action="song-lyrics" aria-label="导入歌词"><span>导入歌词</span><small aria-hidden="true">支持 LRC / TXT</small></button>
                        <button type="button" class="stm-secondary" data-action="clear-song-cover" aria-label="恢复随机封面"><span>恢复随机封面</span><small aria-hidden="true">使用内置插画</small></button>
                        <button type="button" class="stm-secondary" data-action="clear-song-lyrics" aria-label="清除歌词"><span>清除歌词</span><small aria-hidden="true">移除当前歌曲的歌词</small></button>
                    </div>
                    <section data-role="lyrics-lookup" hidden></section>
                    <input type="file" data-role="song-cover-file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden>
                    <input type="file" data-role="lyrics-file" accept=".lrc,.txt,text/plain" hidden>
                </div>
            </section>
        </div>
        <section class="stm-lyrics-view" aria-label="歌词阅读" hidden><header class="stm-lyrics-toolbar"><button type="button" class="stm-secondary" data-action="back-cover" aria-label="返回封面">返回封面</button><strong data-lyric-title></strong><span data-lyric-status></span><button type="button" class="stm-secondary" data-action="resume-lyrics" hidden>回到当前歌词</button></header><div class="stm-lyrics-scroll" tabindex="0" role="region" aria-label="歌词正文"><div class="stm-lyrics-lines"></div></div></section>
        <button type="button" class="stm-resize-handle" aria-label="调整播放器大小" title="拖动调整大小，也可用方向键微调"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 16 8-8M13 16l3-3"/></svg></button>
        <section class="stm-crop-editor" role="dialog" aria-modal="true" aria-label="裁剪背景图片" hidden>
            <div class="stm-page-heading"><h3>裁剪背景图片</h3><span>拖动图片，留下喜欢的区域</span></div>
            <canvas width="320" height="480" aria-label="背景裁剪预览"></canvas>
            <label>缩放<input class="stm-range" type="range" data-crop="zoom" aria-label="裁剪缩放" min="1" max="4" step="0.01" value="1"></label>
            <label>左右<input class="stm-range" type="range" data-crop="x" aria-label="裁剪左右位置" min="0" max="100" step="0.1" value="50"></label>
            <label>上下<input class="stm-range" type="range" data-crop="y" aria-label="裁剪上下位置" min="0" max="100" step="0.1" value="50"></label>
            <div class="stm-crop-actions"><button type="button" class="stm-secondary" data-crop-action="cancel">取消</button><button type="button" class="stm-primary" data-crop-action="save">使用此区域</button></div>
            <p class="stm-crop-error stm-hint" role="status"></p>
        </section>`;
    document.body.append(launcher, panel);
    if(!(typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__)){
        const protect=event=>{if(maintenanceBusy&&!event.target.closest?.('[data-role=data-tools]')){event.preventDefault();event.stopImmediatePropagation();}};
        for(const event of ['click','input','change','submit'])panel.addEventListener(event,protect,true);
    }

    const query = selector => panel.querySelector(selector);
    const audio = query('audio');
    const transitions = createAudioTransitions(audio, { getVolume: () => settings.volume, getDuration: () => settings.transitionDuration });
    const officialPlayer = createOfficialPlayer(query('[data-role="official-player"]'), { beforeOpen: pausePlayback });
    const officialList = createOfficialPlayer(query('[data-online="official-list-player"]'), { beforeOpen: pausePlayback });
    let playbackTimer;
    const status = query('.stm-status');
    const playButton = query('[data-action="play"]');
    const fileInput = query('[data-role="files"]');
    const seek = query('#stm-seek');
    const volume = query('#stm-volume');
    const mode = query('#stm-mode');
    const menus = createSelectMenus(panel);
    const systemScheme = matchMedia('(prefers-color-scheme: dark)');
    const list = query('.stm-track-list');
    const urlInput = query('#stm-url');
    const playlistSelect = query('#stm-playlist');
    const importTarget = query('#stm-import-playlist');

    function save() {
        if (disposed || maintenanceBusy) return;
        context.extensionSettings[SETTINGS_KEY] = settings;
        context.saveSettingsDebounced();
    }
    const maintenanceJournal = (typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__) || !options.account?.verified ? null : new MaintenanceJournal({scope:store.scope});
    const retirement = (typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__) ? null : createAssetRetirement({
        store, settings, scheduleSave: save, journal:maintenanceJournal,
        protectedReferences:maintenanceJournal?()=>dataPanel?dataPanel.protectedReferences():Promise.resolve({unknown:true}):null,
        onError: () => showStatus('设置已保存，但旧资源尚未清理；文件已保留，下次保存时会重试。', true),
        onUnconfirmed: () => showStatus('酒馆没有确认设置已保存；旧资源已保留，请检查连接或服务器磁盘空间后重试。', true),
    });
    const retireAssets = ids => retirement ? retirement.retire(ids) : void store.deleteMany(unreferencedResourceIds(settings,ids)).catch(() => {});

    const launcherDrag = makeDraggable(launcher, launcher, {
        getPosition: () => settings.positions.launcher,
        onPositionChange: position => { settings.positions.launcher = position; save(); },
        onDragStart: () => visibility?.dragStart(), onDragEnd: (bounds, viewport) => { visibility?.dragEnd(bounds, viewport); launcherAvoidance?.refresh(); },
    });
    const panelDrag = makeDraggable(panel, query('.stm-header'), {
        getPosition: () => settings.positions.panel,
        onPositionChange: position => { settings.positions.panel = position; save(); },
    });
    const resizer = makeResizable(panel, query('.stm-resize-handle'), {
        getSize: () => settings.panelSize,
        onChange: (size, position) => { settings.panelSize = size; settings.positions.panel = position; menus.close(); save(); },
        onLayout: () => {
            panelDrag.refresh();
            if (panel.dataset.lyricsOpen === 'true') {
                const view = query('.stm-lyrics-scroll');
                view.style.setProperty('--stm-lyrics-half-height', `${view.clientHeight / 2}px`);
                updateLyrics(true);
            }
        },
    });
    const disposeClickEffects = attachClickEffects(panel, launcher, () => settings.clickEffects);
    function showPage(page, focus = false) {
        if (!query(`[data-view="${page}"]`)) return;
        currentPage = page;
        panel.dataset.page = page;
        if (page !== 'import') online?.cancel();
        menus.close();
        setDetailsOpen(false);
        if (page !== 'playback') { setQueueOpen(false); setLyricsOpen(false); }
        for (const section of panel.querySelectorAll('[data-view]')) section.hidden = section.dataset.view !== page;
        for (const button of panel.querySelectorAll('[data-page]')) {
            const selected = button.dataset.page === page || page === 'favorites' && button.dataset.page === 'library';
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
            if (selected && focus) button.focus();
        }
        query('[data-action="appearance"]').setAttribute('aria-expanded', String(page === 'appearance'));
        if (page === 'recent' || page === 'ranking') renderHistory();
        if (page === 'library') renderRolePicker();
        updateMini();
        panelDrag.refresh();
    }
    function setSheetOpen(selector, open, restoreFocus = false) {
        const overlay = query(selector);
        if ((selector === '#stm-details' && !open) || (selector !== '#stm-details' && open)) officialPlayer.close();
        if (open) {
            sheetReturnFocus.set(selector, document.activeElement);
            menus.close();
            for (const other of panel.querySelectorAll(':scope > .stm-queue-overlay')) if (other !== overlay) other.hidden = true;
        }
        overlay.hidden = !open;
        const active = [...panel.querySelectorAll(':scope > .stm-queue-overlay')].find(sheet => !sheet.hidden);
        for (const child of panel.children) if (child !== status && !child.classList.contains('stm-click-effects')) child.inert = Boolean(active && child !== active);
        for (const button of panel.querySelectorAll('[data-action="toggle-queue"], .stm-mini-queue')) button.setAttribute('aria-expanded', String(!query('#stm-queue').hidden));
        query('.stm-sleep-button')?.setAttribute('aria-expanded', String(!query('#stm-sleep')?.hidden));
        if (open) overlay.querySelector('button').focus({ preventScroll: true });
        else if (restoreFocus) {
            const previous = sheetReturnFocus.get(selector);
            const fallback = selector === '#stm-details' ? [...panel.querySelectorAll('[data-details-id]')].find(button => button.dataset.detailsId === detailsTrackId) : null;
            (previous?.isConnected ? previous : fallback || query('[data-action="close"]')).focus({ preventScroll: true });
        }
    }
    function setQueueOpen(open, focus = false) {
        if (open) renderQueue();
        setSheetOpen('#stm-queue', open, focus);
    }
    function setDetailsOpen(open, focus = false) {
        lyricsLookup?.close();
        if (open) renderSongDetails();
        setSheetOpen('#stm-details', open, focus);
    }
    for (const [selector, action] of [['#stm-queue', 'close-queue'], ['#stm-details', 'close-details']]) {
        const close = () => { if (selector === '#stm-details') lyricsLookup?.close(); setSheetOpen(selector, false, true); };
        for (const element of query(selector).querySelectorAll(`[data-action="${action}"]`)) element.addEventListener('click', close);
        query(selector).addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
            if (event.key === 'Tab') {
                const buttons = [...query(selector).querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')].filter(element => element.getClientRects().length);
                if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
                else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
            }
        });
    }
    query('[data-action="toggle-queue"]').addEventListener('click', () => setQueueOpen(query('#stm-queue').hidden));
    query('[data-action="go-import"]').addEventListener('click', () => { importTarget.value = browsedPlaylistId === BUILTIN_ID ? '' : browsedPlaylistId || ''; menus.refresh(); showPage('import'); });
    query('[data-action="go-library"]').addEventListener('click', showLibraryHome);
    function setManagerOpen(open) {
        query('#stm-playlist-manager').hidden = !open;
        query('[data-action="toggle-manager"]').setAttribute('aria-expanded', String(open));
    }
    query('[data-action="toggle-manager"]').addEventListener('click', () => setManagerOpen(query('#stm-playlist-manager').hidden));
    const tabs = Array.from(panel.querySelectorAll('[data-page]')).filter(button => !(typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__) || button.dataset.page !== 'import');
    tabs.forEach((button, index) => {
        button.addEventListener('click', () => { if (button.dataset.page === 'library') showLibraryHome(); else showPage(button.dataset.page); });
        button.addEventListener('keydown', event => {
            const offset = ['ArrowRight','ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 0;
            if (offset || event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(index + offset + tabs.length) % tabs.length];
                if (next.dataset.page === 'library') { showLibraryHome(); next.focus(); }
                else showPage(next.dataset.page, true);
            }
        });
    });
    const themes = { night: '夜航', amber: '暖砂', ocean: '雾蓝', forest: '松绿', rose: '烟粉', lavender: '月紫', pearl: '珍珠白' };
    for (const [theme, name] of Object.entries(themes)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'stm-theme-choice';
        button.dataset.theme = theme;
        button.dataset.themeChoice = theme;
        button.setAttribute('aria-label', `配色：${name}`);
        const swatch = document.createElement('span');
        swatch.className = 'stm-swatch';
        swatch.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = name;
        button.append(swatch, label);
        button.addEventListener('click', () => { settings.theme = theme; settings.customColors.enabled = false; applyAppearance(); save(); });
        query('.stm-theme-grid').append(button);
    }
    function applyAppearance() {
        const scheme = resolveScheme(settings.colorScheme, systemScheme.matches);
        for (const element of [panel, launcher]) {
            element.dataset.theme = settings.theme;
            element.dataset.colorScheme = scheme;
            element.style.colorScheme = scheme;
            element.dataset.surface = settings.surface;
            element.dataset.customColors = String(settings.customColors.enabled);
            for (const property of CUSTOM_PROPERTIES) element.style.removeProperty(property);
            const palette = settings.customColors.enabled ? customPalette(settings.customColors) : themePalette(settings.theme, scheme);
            for (const [property, value] of Object.entries(palette)) element.style.setProperty(property, value);
            for (const surface of ['matte', 'glass']) {
                if (settings.maskOpacity[surface] !== null) {
                    const solid = getComputedStyle(element).getPropertyValue('--stm-solid').trim();
                    element.style.setProperty(`--stm-${surface}`, hexRgba(solid, settings.maskOpacity[surface]));
                }
            }
        }
        for (const button of panel.querySelectorAll('[data-theme-choice]')) {
            button.setAttribute('aria-pressed', String(!settings.customColors.enabled && button.dataset.themeChoice === settings.theme));
        }
        for (const button of panel.querySelectorAll('[data-surface-choice]')) {
            button.setAttribute('aria-pressed', String(button.dataset.surfaceChoice === settings.surface));
            if (button.dataset.surfaceChoice === 'clear') button.disabled = !backgroundUrl;
        }
        const effectiveBackground=sceneImageUrl||backgroundUrl;
        panel.dataset.hasBackground = String(Boolean(effectiveBackground));
        panel.style.setProperty('--stm-background-image', effectiveBackground ? `url("${effectiveBackground}")` : 'none');
        query('.stm-background-preview').style.backgroundImage = backgroundUrl ? `url("${backgroundUrl}")` : '';
        query('.stm-background-preview span').hidden = Boolean(backgroundUrl);
        query('[data-action="recrop-background"]').disabled = !backgroundUrl;
        query('[data-action="remove-background"]').disabled = !settings.backgroundId;
        query('#stm-custom-colors').checked = settings.customColors.enabled;
        for (const input of panel.querySelectorAll('[data-color]')) input.value = settings.customColors[input.dataset.color];
        const opacity = settings.surface === 'clear' ? 0 : settings.maskOpacity[settings.surface]
            ?? defaultMaskOpacity(settings.surface, Boolean(backgroundUrl), settings.theme, settings.customColors.enabled);
        panel.style.setProperty('--stm-mask-opacity', String(opacity));
        query('#stm-mask-transparency').value = String(Math.round((1 - opacity) * 100));
        query('[data-role="mask-transparency"]').textContent = `${query('#stm-mask-transparency').value}%`;
        query('#stm-mask-transparency').disabled = settings.surface === 'clear';
        query('[data-action="reset-mask"]').disabled = settings.surface === 'clear';
        query('#stm-click-effects').checked = settings.clickEffects;
        for (const button of panel.querySelectorAll('[data-scheme-choice]')) button.setAttribute('aria-pressed', String(button.dataset.schemeChoice === settings.colorScheme));
        refreshDesign();
    }
    const onSystemScheme = () => { if (settings.colorScheme === 'system') applyAppearance(); };
    systemScheme.addEventListener('change', onSystemScheme);
    for (const button of panel.querySelectorAll('[data-scheme-choice]')) button.addEventListener('click', () => { settings.colorScheme = button.dataset.schemeChoice; applyAppearance(); save(); });
    query('#stm-custom-colors').addEventListener('change', event => {
        settings.customColors.enabled = event.currentTarget.checked; applyAppearance(); save();
    });
    for (const input of panel.querySelectorAll('[data-color]')) input.addEventListener('input', () => {
        settings.customColors[input.dataset.color] = input.value;
        settings.customColors.enabled = true;
        applyAppearance(); save();
    });
    query('#stm-mask-transparency').addEventListener('input', event => {
        if (settings.surface === 'clear') return;
        settings.maskOpacity[settings.surface] = (100 - Number(event.currentTarget.value)) / 100;
        applyAppearance(); save();
    });
    query('[data-action="reset-mask"]').addEventListener('click', () => {
        if (settings.surface === 'clear') return;
        settings.maskOpacity[settings.surface] = null; applyAppearance(); save();
    });
    query('#stm-click-effects').addEventListener('change', event => {
        settings.clickEffects = event.currentTarget.checked; save();
    });
    query('[data-action="appearance"]').addEventListener('click', () => showPage(currentPage === 'appearance' ? 'playback' : 'appearance'));
    for (const button of panel.querySelectorAll('[data-surface-choice]')) {
        button.addEventListener('click', () => {
            if (button.dataset.surfaceChoice === 'clear' && !backgroundUrl) return;
            settings.surface = button.dataset.surfaceChoice; applyAppearance(); save();
        });
    }
    query('[data-action="reset-position"]').addEventListener('click', () => {
        settings.positions = { launcher: null, panel: null };
        settings.panelSize = null; resizer.reset();
        launcherDrag.reset();
        panelDrag.reset();
        save();
    });
    applyAppearance();

    const fontPicker = (typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__) ? null
        : createFontPicker({ panel, launcher, store, settings, save, showStatus, retireAssets, createId: createTrackId, availableFonts: options.availableFonts, onApplied(){refreshDesign();}, getSelectionScope:()=>currentCharacterAvatar(options.context||globalThis.SillyTavern?.getContext?.()||context), onSelect(scope){if(scope!==currentCharacterAvatar(options.context||globalThis.SillyTavern?.getContext?.()||context)){refreshDesign();showStatus('默认字体已载入；角色已切换，未覆盖当前角色的专属字体。');return;}const design=normalizeDesign(effectiveDesign());if(design.fontPreset!=='current'){design.fontPreset='current';applyUserDesign(design);}else refreshDesign();} });
    if ((typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__)) query('.stm-font-section').remove();
    const mini = createMiniPlayer({
        panel, audio,
        getTrack: () => findTrack(settings, settings.currentId),
        getCount: () => playbackQueue.tracks().filter(track => platformService.canPlay(track)).length,
        loadCover: track => track.coverId ? cachedCover(track.coverId) : Promise.resolve(track.cover || null),
        onOpen: () => showPage('playback'), onPlay: toggleCurrent, onQueue: () => setQueueOpen(true),
    });
    online = (typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__) ? null : createOnlinePanel({
        panel, service: platformService, menus, getTarget: () => importTarget.value || null,
        getCapacity: () => MAX_TRACKS - settings.tracks.length,
        hasTrack: id => settings.tracks.some(track => track.id === id), onState: updatePlayback, onSave: savePlatformImport,
        closeOfficialList: () => officialList.close(), openOfficialList: value => officialList.open(value),
        onEmbed(track) {
            savePlatformImport({ type: 'track', complete: true, total: 1, tracks: [track], name: track.title });
            detailsTrackId = track.id; setDetailsOpen(true); officialPlayer.open(track);
        },
        showStatus, async onPlay(track, force = false) {
            savePlatformImport({ type: 'track', complete: true, total: 1, tracks: [track], name: track.title }, { targetId: importTarget.value || null });
            if (!playbackQueue.tracks().some(item => item.id === track.id)) await activatePlaylist(importTarget.value || null);
            if (force) await selectTrack(track.id, true); else await toggleTrack(track.id);
        },
    });
    function savePlatformImport(preview, options = {}) {
        const plan = planImport(settings, preview, options);
        let targetId = plan.targetId;
        if (plan.newPlaylist) { const playlist = createPlaylist(settings, plan.name); playlist.source = plan.source; targetId = playlist.id; }
        settings.tracks.push(...plan.added);
        for (const track of plan.upgrades) {
            const old = settings.tracks.find(item => item.id === track.id);
            const customTitle = old.title !== `${PLATFORM_NAMES[old.platform]} · ${old.platformTrackId}` ? old.title : null;
            Object.assign(old, track); delete old.metadataStatus;
            if (customTitle) old.title = customTitle;
        }
        if (targetId) for (const track of plan.tracks) addTrackToPlaylist(settings, targetId, track.id);
        save(); renderPlaylists(); renderTracks();
        return `已保存 ${plan.tracks.length} 首歌曲信息，新增 ${plan.added.length} 首，复用 ${plan.tracks.length - plan.added.length} 首${plan.upgrades.length ? `，已更新 ${plan.upgrades.length} 首原来源书签的信息` : ''}${targetId ? '，已加入歌单' : ''}。`;
    }
    query('#stm-hide-builtin').checked = settings.builtinHidden;
    query('#stm-hide-builtin').addEventListener('change', async event => {
        settings.builtinHidden = event.target.checked;
        if (settings.builtinHidden && settings.activePlaylistId === BUILTIN_ID) await activatePlaylist(null);
        save(); renderPlaylists(); renderTracks();
    });
    const playerUI = createPlayerUI(panel, launcher, audio);
    listening = createListeningPanel({ panel, settings, audio, getTrack: id => findTrack(settings, id), save, showPage, setSheetOpen,
        canPlay: track => platformService.canPlay(track),
        onPlay: id => void toggleTrack(id), onStop: () => void softPause(),
        onAdd(target, ids) {
            if (!settings.playlists.some(list => list.id === target)) throw new Error('请先创建一个歌单，再选择加入目标。');
            if (settings.tracks.length + ids.filter(id => !settings.tracks.some(track => track.id === id)).length > MAX_TRACKS) throw new Error('加入后会超过总曲库容量，请减少选择；未加入或舍弃歌曲。');
            let added = 0; for (const id of ids) if (addTrackToPlaylist(settings, target, id)) added++;
            save(); renderPlaylists(); renderTracks(); showStatus(`已将 ${added} 首收藏加入歌单。`);
        },
    });
    query('#stm-transition-duration').addEventListener('change', event => { settings.transitionDuration = Number(event.target.value); transitions.refresh(); save(); });
    menus.refresh();
    designPresentation = createDesignPresentation({ panel, launcher, audio, readIcon: id => store.get(id), onPlay: toggleCurrent, onNext: () => advanceTrack(1), getTrackNumber: () => playbackQueue.tracks().findIndex(track => track.id === settings.currentId) + 1 });
    designControls = createDesignControls({ panel, settings, getDesign: effectiveDesign, onChange: applyUserDesign,
        onAccessibility() { refreshDesign(); save(); }, isPortable: (typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__) });
    readingControls = createReadingControls({ panel, settings, onChange(key) {
        refreshDesign(); menus.refresh();
        if (key === 'autoFollow') { lyricReader?.reset(); lyricReader?.center(); }
        else lyricReader?.invalidate();
        save();
    } });
    launcherControls=createLauncherControls({panel,group:designControls.group,getDesign:effectiveDesign,onChange:applyUserDesign,isPortable:(typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__),
        async onIcon(file,signal){
            if((typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__))return;
            const before=JSON.stringify(effectiveDesign()),avatar=currentCharacterAvatar(options.context||globalThis.SillyTavern?.getContext?.()||context);
            const blob=await prepareDesignIcon(file,{signal}),id='cover:'+createTrackId();
            signal.throwIfAborted();try{await store.put(id,blob);}catch(error){if(error.name==='QuotaExceededError')throw new Error('浏览器存储空间不足，原图标已保留。');throw error;}
            if(disposed||signal.aborted||avatar!==currentCharacterAvatar(options.context||globalThis.SillyTavern?.getContext?.()||context)||before!==JSON.stringify(effectiveDesign())){await store.delete(id).catch(()=>{});if(!disposed&&!signal.aborted)throw new Error('处理期间角色或设计已改变，原图标保留；请重试。');return;}
            const config=normalizeDesign(effectiveDesign()),previous=config.customization.iconId;config.customization.iconId=id;config.launcher='custom';applyUserDesign(config);
            if(previous)retireAssets([previous]);
        },
    });
    launcherAvoidance=createLauncherAvoidance(launcher,{getInput:options.getInputElement||(()=>document.querySelector('#send_form')),onMove(position){if(disposed||maintenanceBusy)return;settings.positions.launcher=position;save();}});
    if (!(typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__)) {
        designFont=createDesignFontLayer(panel,launcher,text=>showStatus(text,true));
        designEditor=createDesignEditor({panel,launcher,settings,getDesign:effectiveDesign,getContext:()=>options.context||globalThis.SillyTavern?.getContext?.()||context,
            getScenes:()=>sceneGroupForCurrent()?.scenes.filter(s=>s.playable)||[],previewScene:id=>{const avatar=currentCharacterAvatar(freshContext()),group=roleSceneGroup(settings,avatar);return previewScene(id&&group?{avatar,group:structuredClone(group),sceneId:id}:null);},
            preview(value){previewDesign=value;refreshDesign();},apply:applyUserDesign,save,readIcon:id=>store.get(id),retireAssets,showPage,setOpen,
            async writeIcon(file,signal){const blob=await prepareDesignIcon(file,{signal}),id='cover:'+createTrackId();signal.throwIfAborted();await store.put(id,blob);if(signal.aborted){await store.delete(id).catch(()=>{});signal.throwIfAborted();}return id;},
            async bind(avatar,playlistId,config){
                const ctx=options.context||globalThis.SillyTavern?.getContext?.()||context;
                if(!ctx.characters.some(card=>card.avatar===avatar))throw new Error('目标角色已不存在，未写入绑定。');
                const playlist=settings.playlists.find(row=>row.id===playlistId);if(!playlist)throw new Error('目标歌单已不存在。');
                const row=settings.roleDesigns.find(row=>row.avatar===avatar);if(!row&&settings.roleDesigns.length>=1000)throw new Error('角色设计数量已达上限。');
                bindPlaylistCharacters(settings,playlistId,[...new Set([...playlist.characterAvatars,avatar])]);
                if(row)row.config=normalizeDesign(config);else{if(settings.roleDesigns.length>=1000)throw new Error('角色设计数量已达上限。');settings.roleDesigns.push({avatar,config:normalizeDesign(config)});}
                save();refreshDesign();renderPlaylists();await nativeExport.syncBindings();
            },
        });
    }
    refreshDesign(); menus.refresh();
    function effectiveDesign() {
        const avatar = currentCharacterAvatar(options.context || globalThis.SillyTavern?.getContext?.() || context);
        const base=(typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__) ? (settings.uiDesign.allowRecipientLayout && settings.personalDesign ? settings.personalDesign : settings.uiDesign) : settings.roleDesigns.find(row => row.avatar === avatar)?.config || settings.uiDesign;
        return activeSceneState?.scene.themeId && activeSceneState.scene.themeId!=='inherit' ? normalizeDesign({...base,theme:activeSceneState.scene.themeId}) : base;
    }
    function refreshDesign() {
        if (!designPresentation) return;
        designPresentation.apply(previewDesign || effectiveDesign(), { motion: settings.visualMotion, accessible: settings.accessibleControls });
        applyReading(panel, launcher, settings.reading, previewDesign || effectiveDesign());
        journalUI?.apply(previewDesign || effectiveDesign());
        designFont?.set((previewDesign||effectiveDesign()).fontPreset);
        designControls?.refresh(); readingControls?.refresh(); launcherControls?.refresh(); launcherDrag.refresh(); panelDrag.refresh(); launcherAvoidance?.refresh(); visibility?.refresh();
    }
    function applyUserDesign(value) {
        const config = normalizeDesign(value);
        if ((typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__)) {
            if (!settings.uiDesign.allowRecipientLayout) return;
            settings.personalDesign = config;
        } else {
            const avatar = currentCharacterAvatar(options.context || globalThis.SillyTavern?.getContext?.() || context), bound = settings.roleDesigns.find(row => row.avatar === avatar);
            if (bound) bound.config = config; else settings.uiDesign = config;
            settings.visualMotion = null;
        }
        refreshDesign(); save();
    }
    function updateMini() { mini.render(currentPage === 'playback' || panel.dataset.lyricsOpen === 'true'); }


    const coverImage = query('.stm-cover-image');
    coverImage.src = fallbackCoverUrl(0);
    coverImage.addEventListener('error', () => {
        const track = findTrack(settings, settings.currentId);
        const fallback = fallbackCoverUrl(track?.fallbackCover ?? 0);
        if (coverImage.src !== fallback) coverImage.src = fallback;
    });
    function setLyricsOpen(open) {
        if(journalUI?.active){journalUI.show(open?'lyrics':'player');return;}
        query('.stm-lyrics-view').hidden = !open;
        panel.dataset.lyricsOpen = String(open);
        menus.close();
        query('.stm-cover-tip').hidden = open;
        query('[data-action="toggle-lyrics"]').setAttribute('aria-pressed', String(open));
        if (open) {
            const view = query('.stm-lyrics-scroll');
            view.style.setProperty('--stm-lyrics-half-height', `${view.clientHeight / 2}px`);
            lyricReader?.reset();
            view.focus({ preventScroll: true });
        }
        if (open) updateLyrics(true);
    }
    query('[data-action="toggle-lyrics"]').addEventListener('click', () => { if (settings.accessibleControls || effectiveDesign().customization.showLyricsButton) setLyricsOpen(true); });
    const lyricView = query('.stm-lyrics-view');
    const leaveLyrics = () => { setLyricsOpen(false); query('[data-action="toggle-lyrics"]').focus({ preventScroll: true }); };
    lyricReader = createLyricReader({ view: lyricView, scroller: query('.stm-lyrics-scroll'), lines: query('.stm-lyrics-lines'), getDefaultFollow: () => settings.reading.autoFollow, getCurrent: () => activeLyric, getTitle: () => findTrack(settings, settings.currentId)?.title, onBack: leaveLyrics, audio, getReading: () => settings.reading, getTimeline: () => lyricData, getTime: () => (audio.currentTime || 0) - effectiveLyricOffset(findTrack(settings, settings.currentId), settings.lyricOffsets) / 1000, getOffset: () => effectiveLyricOffset(findTrack(settings, settings.currentId), settings.lyricOffsets), onOffset: value => { if (settings.currentId) { settings.lyricOffsets[settings.currentId] = value; save(); } }, onTime: () => updateLyrics(), isVisible: () => !panel.hidden && !lyricView.hidden && currentPage === 'playback' });
    function renderLyrics(track) {
        lyricData = parseLyrics(track?.lyrics || '');
        activeLyric = -1;
        lyricReader.reset();
        const target = query('.stm-lyrics-lines'); target.replaceChildren();
        if (!track?.lyrics?.trim()) {
            const empty = document.createElement('p'); empty.className = 'stm-no-lyrics';
            empty.textContent = '暂无歌词';
            const hint = document.createElement('small');
            hint.textContent = (typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__) ? '此角色卡未附带歌词，请由制作端补充后重新导出。' : '可在歌曲详情中查找歌词，或导入 LRC / TXT。';
            target.append(empty, hint);
            if (!(typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__) && track) {
                const button = document.createElement('button'); button.type = 'button'; button.className = 'stm-secondary'; button.textContent = '查找这首歌的歌词';
                button.addEventListener('click', event => { event.stopPropagation(); setLyricsOpen(false); detailsTrackId = track.id; setDetailsOpen(true); lyricsLookup.open({ ...track, duration: audio.duration }); });
                button.addEventListener('keydown', event => event.stopPropagation()); target.append(button);
            }
            return;
        }
        for (const line of lyricData.lines) {
            const paragraph = document.createElement('p'); paragraph.textContent = line.text;
            target.append(paragraph);
        }
        updateLyrics(true);
    }
    function updateLyrics(force = false) {
        if (!lyricData.synced) return;
        const next = currentLyricIndex(lyricData.lines, (audio.currentTime || 0) - effectiveLyricOffset(findTrack(settings, settings.currentId), settings.lyricOffsets) / 1000);
        if (!force && next === activeLyric) return;
        activeLyric = next;
        const lines = query('.stm-lyrics-lines').children;
        Array.from(lines).forEach((line, index) => line.classList.toggle('stm-current-lyric', index === next));
        lyricReader.refresh();
        if (next >= 0 && !query('.stm-lyrics-view').hidden && currentPage === 'playback' && !panel.hidden) {
            lyricReader.center(force);
        }
    }
    async function renderMedia(track) {
        const revision = ++mediaRevision;
        if (coverUrl) URL.revokeObjectURL(coverUrl);
        coverUrl = null;
        if (track && track.fallbackCover === undefined) { track.fallbackCover = randomCover(); save(); }
        coverImage.src = track?.cover || fallbackCoverUrl(track?.fallbackCover ?? 0);
        coverImage.alt = track ? `歌曲封面：${track.title}` : '音乐封面';
        renderLyrics(track);
        if (track?.coverId) {
            try {
                const blob = await store.get(track.coverId);
                if (revision !== mediaRevision || settings.currentId !== track.id || !blob) return;
                coverUrl = URL.createObjectURL(blob); coverImage.src = coverUrl;
            } catch { /* Keep bundled artwork when this browser lacks the embedded cover. */ }
        }
    }
    function cachedCover(id) {
        if (!coverCache.has(id)) {
            const entry = {};
            entry.promise = store.get(id).then(blob => {
                if (!blob || coverCache.get(id) !== entry) return null;
                entry.url = URL.createObjectURL(blob); return entry.url;
            }).catch(() => null);
            coverCache.set(id, entry);
        }
        return coverCache.get(id).promise;
    }
    function forgetCover(id) {
        const entry = coverCache.get(id);
        if (entry?.url) URL.revokeObjectURL(entry.url);
        coverCache.delete(id);
    }
    function renderSongDetails() {
        const track = findTrack(settings, detailsTrackId);
        if (!track) return;
        listening?.detail(track.id);
        query('[data-role="details-title"]').textContent = track.title;
        query('[data-role="details-source"]').textContent = track.artist || (track.kind === 'local' ? '本地音乐' : '在线音乐');
        const image = query('.stm-details-cover');
        image.src = track.cover || fallbackCoverUrl(track.fallbackCover ?? 0);
        const credit = query('[data-role="platform-credit"]'); credit.replaceChildren(); credit.hidden = track.kind !== 'platform';
        query('[data-action="open-official"]').hidden = !platformService.canEmbed(track);
        if (track.kind === 'platform') {
            const text = document.createElement('p'); text.textContent = `${PLATFORM_NAMES[track.platform]} · ${platformService.canPlay(track) ? '可尝试站内播放' : platformService.canEmbed(track) ? '官方嵌入播放器 · 是否完整收听由平台决定' : '仅支持前往官方平台收听'}`; credit.append(text);
            if (track.license) { const notice = document.createElement('p'); notice.textContent = track.license.attribution; credit.append(notice); }
            for (const [label, url] of [['在官方平台查看', track.sourceUrl], ['许可说明', track.license?.url]]) if (url) { const link = document.createElement('a'); link.href = url; link.textContent = label; link.target = '_blank'; link.rel = 'noopener noreferrer'; credit.append(link); }
        }
        const playing = settings.currentId === track.id && !audio.paused && !audio.ended;
        const direct = platformService.canPlay(track);
        query('[data-action="detail-play"]').hidden = !direct;
        query('[data-action="detail-play"]').textContent = playing ? '暂停' : '播放';
        query('[data-action="detail-play"]').setAttribute('aria-label', `${playing ? '暂停歌曲' : '播放歌曲'}：${track.title}`);
        query('[data-action="detail-membership"]').setAttribute('aria-label', `加入歌单：${track.title}`);
        query('[data-action="detail-delete"]').setAttribute('aria-label', `删除：${track.title}`);
        query('[data-action="detail-delete"]').hidden = browsedPlaylistId === BUILTIN_ID;
        query('[data-action="detail-unlink"]').hidden = !browsedPlaylist()?.trackIds.includes(track.id);
        query('[data-action="detail-unlink"]').setAttribute('aria-label', `从歌单移除：${track.title}`);
        const coverId = track.coverId;
        if (coverId) void cachedCover(coverId).then(url => {
            if (url && detailsTrackId === track.id && track.coverId === coverId) image.src = url;
        });
    }
    query('[data-action="detail-play"]').addEventListener('click', () => void toggleTrack(detailsTrackId, browsedPlaylistId));
    query('[data-action="detail-membership"]').addEventListener('click', () => { setDetailsOpen(false); showMembership(detailsTrackId); });
    query('[data-action="detail-unlink"]').addEventListener('click', () => { setDetailsOpen(false); void unlinkTrack(detailsTrackId); });
    query('[data-action="detail-delete"]').addEventListener('click', async () => { await removeTrack(detailsTrackId); if (!findTrack(settings, detailsTrackId)) setDetailsOpen(false); });
    query('[data-action="open-official"]').addEventListener('click', () => officialPlayer.open(findTrack(settings, detailsTrackId)));
    function editableDetailsTrack(id = detailsTrackId) {
        if (!findTrack(settings, id)) return null;
        try { return ensureLibraryTrack(settings, id); } catch (error) { showStatus(error.message, true); return null; }
    }
    const songCoverInput = query('[data-role="song-cover-file"]');
    const lyricsInput = query('[data-role="lyrics-file"]');
    query('[data-action="song-cover"]').addEventListener('click', () => songCoverInput.click());
    query('[data-action="song-lyrics"]').addEventListener('click', () => lyricsInput.click());
    const lyricsLookup = (typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__) ? null : createLyricsLookup(query('[data-role="lyrics-lookup"]'), {
        onApply(original, result) {
            const track = editableDetailsTrack(original.id); if (!track) return;
            track.lyrics = result.lyrics; track.lyricsSource = result.source; save();
            if (settings.currentId === track.id) renderLyrics(track);
            showStatus('歌词已保存，绑定歌单后重新导出即可随卡携带。');
        },
    });
    if (lyricsLookup) query('[data-action="find-song-lyrics"]').addEventListener('click', () => {
        const track = findTrack(settings, detailsTrackId); if (track) lyricsLookup.open({ ...track, duration: track.id === settings.currentId ? audio.duration : undefined });
    });
    else query('[data-action="find-song-lyrics"]').remove();
    songCoverInput.addEventListener('change', async () => {
        const file = songCoverInput.files[0], id = detailsTrackId;
        songCoverInput.value = '';
        if (!file || !findTrack(settings, id)) return;
        const key = `cover:${createTrackId()}`;
        try {
            validateImageFile(file);
            const cover = await prepareCover(file);
            await store.put(key, cover);
            if (disposed) { await store.delete(key); return; }
            const track = editableDetailsTrack(id);
            if (!track) { await store.delete(key); return; }
            const previous = track.coverId;
            track.coverId = key; save(); renderTracks();
            if (settings.currentId === id) void renderMedia(track);
            if (previous) { forgetCover(previous); retireAssets([previous]); }
            showStatus('歌曲封面已更新。');
        } catch (error) { await store.delete(key).catch(() => {}); showStatus(error.message || '封面读取失败，请换一张图片。', true); }
    });
    lyricsInput.addEventListener('change', async () => {
        const file = lyricsInput.files[0], id = detailsTrackId;
        lyricsInput.value = '';
        if (!file) return;
        try {
            if (!/\.(lrc|txt)$/i.test(file.name) || !file.size || file.size > 512 * 1024) throw new Error('请选择 512 KB 以内的 LRC 或 TXT 歌词文件。');
            const text = (await file.text()).replace(/^\uFEFF/, '').trim();
            if (disposed) return;
            if (!text || text.length > MAX_LYRICS) throw new Error('歌词不能为空，最多支持 50000 个字符。');
            const track = editableDetailsTrack(id);
            if (!track) return;
            track.lyrics = text; delete track.lyricsSource; save();
            if (settings.currentId === id) renderLyrics(track);
            showStatus('歌词已导入，点击播放页的封面即可查看。');
        } catch (error) { showStatus(error.message || '歌词读取失败。', true); }
    });
    query('[data-action="clear-song-cover"]').addEventListener('click', async () => {
        const track = editableDetailsTrack();
        if (!track) return;
        const previous = track.coverId;
        delete track.coverId; track.fallbackCover = randomCover(); save(); renderTracks();
        if (settings.currentId === track.id) void renderMedia(track);
        if (previous) { forgetCover(previous); retireAssets([previous]); }
        showStatus('已恢复内置封面。');
    });
    query('[data-action="clear-song-lyrics"]').addEventListener('click', () => {
        const track = editableDetailsTrack();
        if (!track) return;
        delete track.lyrics; delete track.lyricsSource; save();
        if (settings.currentId === track.id) renderLyrics(track);
        showStatus('歌词已清除。');
    });

    async function restoreBackground() {
        const revision = ++backgroundRevision;
        if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
        backgroundUrl = null;
        if (settings.backgroundId) {
            try {
                const blob = await store.get(settings.backgroundId);
                if (revision !== backgroundRevision) return;
                if (blob) backgroundUrl = URL.createObjectURL(blob);
                else query('[data-role="background-status"]').textContent = '图片不在当前浏览器中，请重新导入。';
            } catch { query('[data-role="background-status"]').textContent = '读取背景失败，请检查浏览器存储权限后重新导入。'; }
        }
        if (revision !== backgroundRevision) return;
        if (!backgroundUrl && settings.surface === 'clear') { settings.surface = 'glass'; save(); }
        applyAppearance();
    }
    async function deleteBackgroundFiles(id) {
        if (!id) return;
        await Promise.all([store.delete(id), store.delete(`${id}:original`)]);
    }
    const cropElement = query('.stm-crop-editor');
    const cropper = createImageCropper(cropElement, {
        getAspectRatio() { const bounds = panel.getBoundingClientRect(); return bounds.width / bounds.height; },
        async onSave({ original, cropped }) {
            const id = `background:${createTrackId()}`;
            try {
                await store.put(`${id}:original`, original);
                await store.put(id, cropped);
                if (disposed) { await deleteBackgroundFiles(id).catch(() => {}); return; }
            } catch (error) {
                await deleteBackgroundFiles(id).catch(() => {});
                throw error;
            }
            const previous = settings.backgroundId;
            settings.backgroundId = id;
            save();
            await restoreBackground();
            query('[data-role="background-status"]').textContent = '背景已保存，可重新裁剪；图片仅保存在当前浏览器。';
            showStatus();
            if (previous) retireAssets([previous, `${previous}:original`]);
        },
        onError(error) {
            const message = error.name === 'QuotaExceededError' ? '浏览器存储空间不足，请释放空间后重试。' : error.message || '图片处理失败，请换一张图片。';
            query('.stm-crop-error').textContent = message;
            showStatus(message, true);
        },
        onClose() {
            for (const element of panel.querySelectorAll(':scope > :not(.stm-crop-editor)')) element.inert = false;
            query('[data-action="import-background"]').focus();
        },
    });
    async function openCropper(blob) {
        query('.stm-crop-error').textContent = '';
        await cropper.open(blob);
        if (!cropElement.hidden) for (const element of panel.querySelectorAll(':scope > :not(.stm-crop-editor)')) element.inert = true;
    }
    const backgroundInput = query('[data-role="background-file"]');
    query('[data-action="import-background"]').addEventListener('click', () => backgroundInput.click());
    backgroundInput.addEventListener('change', () => {
        const file = backgroundInput.files[0];
        backgroundInput.value = '';
        if (file) void openCropper(file);
    });
    query('[data-action="recrop-background"]').addEventListener('click', async () => {
        try {
            const original = await store.get(`${settings.backgroundId}:original`);
            if (!original) throw new Error('原图不在当前浏览器中，请重新导入。');
            await openCropper(original);
        } catch (error) { showStatus(error.message, true); }
    });
    query('[data-action="remove-background"]').addEventListener('click', async () => {
        const previous = settings.backgroundId;
        settings.backgroundId = null;
        if (settings.surface === 'clear') settings.surface = 'glass';
        save();
        await restoreBackground();
        query('[data-role="background-status"]').textContent = '图片仅保存在当前浏览器。';
        showStatus('背景图片已移除，已恢复原有配色。');
        if (previous) retireAssets([previous, `${previous}:original`]);
    });
    void restoreBackground();

    function showStatus(message = '', error = false) {
        window.clearTimeout(statusTimer);
        status.textContent = message;
        status.classList.toggle('stm-error', error);
        if (message) statusTimer = window.setTimeout(() => { status.textContent = ''; status.classList.remove('stm-error'); }, error ? 8000 : 4000);
    }

    function setOpen(open, focus = true) {
        if (open) visibility?.restore();
        const wasHidden = panel.hidden;
        panel.hidden = !open;
        launcher.setAttribute('aria-expanded', String(open));
        if (open) {
            resizer.refresh(); panelDrag.refresh();
            if (wasHidden && panel.dataset.lyricsOpen === 'true') { lyricReader?.reset(); updateLyrics(true); }
            if(wasHidden&&journalUI?.active)journalUI.resume();
            if (focus) (panel.dataset.lyricsOpen === 'true' ? query('.stm-lyrics-scroll') : query('[data-action="close"]')).focus({ preventScroll: true });
        }
        else { menus.close(); setSheetOpen('#stm-sleep', false); setQueueOpen(false); setDetailsOpen(false); officialList.close(); if (panel.contains(document.activeElement)) launcher.focus(); }
    }

    const activePlaylist = () => settings.playlists.find(item => item.id === settings.activePlaylistId);
    const browsedPlaylist = () => settings.playlists.find(item => item.id === browsedPlaylistId);
    function collectionName(id=settings.activePlaylistId) {return !arguments.length&&activeSceneState ? activeSceneState.scene.name : id === BUILTIN_ID ? settings.builtinCatalog.title : settings.playlists.find(item => item.id === id)?.name || '总曲库';}
    const freshContext = () => options.context || globalThis.SillyTavern.getContext();

    function sceneGroupForCurrent() {const group=scenePreview?.group||roleSceneGroup(settings,currentCharacterAvatar(freshContext()));return group?{...group,scenes:group.scenes.map(s=>({...s,playable:!sceneIssues(s,allTracks(settings)).length}))}:null;}
    async function applySceneVisuals(staged) {
        const token=++sceneVisualEpoch,id=activeSceneState?.scene.backgroundId;
        if(sceneImageUrl)URL.revokeObjectURL(sceneImageUrl);sceneImageUrl=null;
        applyAppearance();scenePicker?.refresh();
        if(!id)return;
        try{const blob=staged?.get(id)||await store.get(id);if(disposed||token!==sceneVisualEpoch)return;
            if(blob)sceneImageUrl=URL.createObjectURL(blob);else showStatus('场景背景在当前浏览器中缺失，请到音乐场景重新选择。',true);
            applyAppearance();
        }catch(error){if(!disposed&&token===sceneVisualEpoch)showStatus(error.message,true);}
    }
    async function activateScene(id,{group=roleSceneGroup(settings,currentCharacterAvatar(freshContext())),preview=false,remember=true,playState=null,staged}={}) {
        const avatar=currentCharacterAvatar(freshContext()),scene=group?.scenes.find(s=>s.id===id);
        if(!avatar||!scene||sceneIssues(scene,allTracks(settings)).length)throw new Error('这个音乐场景尚未完成，请检查歌曲。');
        const wasPlaying=playState??(!audio.paused&&!audio.ended),keep=group.keepCurrent!==false&&scene.trackIds.includes(settings.currentId)&&audio.getAttribute('src')&&!selectionPending;
        if(!preview&&remember)rememberScene(settings,avatar,id,allTracks(settings));
        activeSceneState={avatar,group,scene,queueKey:'@scene:'+avatar+'\n'+scene.id};
        playbackQueue.reset(activeSceneState.queueKey);void applySceneVisuals(staged);
        renderTracks();
        if(!keep)await selectTrack(scene.trackIds[0],wasPlaying&&visibility?.state!=='hidden');
        if(!disposed){scenePicker?.refresh();save();}
        return scene;
    }
    async function previewScene(value) {
        if(value){scenePreview=value;return activateScene(value.sceneId,{group:value.group,preview:true,staged:value.staged});}
        if(!scenePreview)return;scenePreview=null;
        const avatar=currentCharacterAvatar(freshContext()),group=roleSceneGroup(settings,avatar),scene=selectedScene(settings,avatar,allTracks(settings));
        if(scene)return activateScene(scene.id,{group,preview:true});
        activeSceneState=null;void applySceneVisuals();return activatePlaylist(settings.activePlaylistId);
    }

    function libraryTracks(tracks = getQueue(settings, browsedPlaylistId)) {
        const term = query('#stm-library-search').value.trim().toLocaleLowerCase();
        const filter = query('#stm-library-filter').value;
        const result = tracks.filter(track => (!term || `${track.title} ${track.artist || ''}`.toLocaleLowerCase().includes(term))
            && (filter === 'all' || filter === track.kind || filter === 'playable' && platformService.canPlay(track) || filter === 'restricted' && !platformService.canPlay(track)));
        const sort = query('#stm-library-sort').value;
        if (sort !== 'original') result.sort((a,b) => String(sort === 'artist' ? a.artist || '' : a.title).localeCompare(String(sort === 'artist' ? b.artist || '' : b.title),'zh-CN'));
        return result;
    }
    function renderCollectionHero() {
        const selected = browsedPlaylist(), count = getQueue(settings, browsedPlaylistId).length;
        query('[data-role="hero-title"]').textContent = collectionName(browsedPlaylistId);
        const names = new Map((freshContext().characters || []).map(character => [character.avatar, character.name]));
        const roles = selected?.characterAvatars.map(avatar => names.get(avatar) || avatar) || [];
        query('[data-role="hero-meta"]').textContent = `${count} 首${selected ? roles.length ? ` · 已绑定：${roles.join('、')}` : ' · 未绑定角色' : browsedPlaylistId === BUILTIN_ID ? ' · 开发者预设' : ' · 全部音乐'}`;
        query('[data-role="hero-description"]').textContent = selected?.description || (selected ? '喜欢的旋律，与同一段故事相伴。' : '所有音乐在这里，找到今天想听的那一首。');
        collectionImage(query('.stm-collection-hero img'), selected || (browsedPlaylistId === BUILTIN_ID ? {id:BUILTIN_ID} : null));
        query('[data-action="bulk-unlink"]').hidden = !selected;
        query('[data-action="bulk-delete"]').hidden = browsedPlaylistId === BUILTIN_ID;
        query('[data-action="edit-order"]').hidden = !selected;
    }
    function updateSelection() {
        const ids = new Set(getQueue(settings, browsedPlaylistId).map(track => track.id));
        for (const id of librarySelection) if (!ids.has(id)) librarySelection.delete(id);
        const visible = libraryTracks(), selected = visible.filter(track => librarySelection.has(track.id)).length;
        query('[data-role="selection-count"]').textContent = `已选 ${librarySelection.size} 首`;
        const check = query('#stm-select-visible'); check.checked = Boolean(visible.length) && selected === visible.length; check.indeterminate = selected > 0 && selected < visible.length;
        for (const button of panel.querySelectorAll('[data-action^="bulk-"]')) button.disabled = !librarySelection.size || button.dataset.action === 'bulk-add' && !settings.playlists.length;
    }
    function showMembership(id) {
        const track = findTrack(settings, id); if (!track) return;
        membershipTrackId = id;
        showPage('library');
        if (!libraryDetail) { libraryDetail = true; panel.dataset.libraryDetail = 'true'; renderLibraryHome(); }
        query('[data-role="membership-title"]').textContent = `将「${track.title}」加入歌单`;
        query('[data-action="confirm-membership"]').disabled = !settings.playlists.length;
        if (settings.playlists.some(playlist => playlist.id === preferredPlaylistId)) { query('#stm-add-target').value = preferredPlaylistId; menus.refresh(); }
        query('.stm-membership').hidden = false;
        query('.stm-membership').scrollIntoView({block:'nearest'});
        (query('#stm-add-target-trigger').disabled ? query('[data-action="create-for-song"]') : query('#stm-add-target-trigger')).focus();
    }
    for (const id of ['stm-library-search','stm-library-sort','stm-library-filter']) query(`#${id}`).addEventListener(id.endsWith('search') ? 'input' : 'change', () => { panel.dataset.orderEditing = 'false'; query('[data-action="edit-order"]').setAttribute('aria-pressed','false'); renderTracks(); });
    query('[data-action="toggle-bulk"]').addEventListener('click', event => {
        const open = panel.dataset.bulkEditing !== 'true'; panel.dataset.bulkEditing = String(open);
        panel.dataset.orderEditing = 'false'; query('[data-action="edit-order"]').setAttribute('aria-pressed','false');
        event.currentTarget.setAttribute('aria-pressed',String(open)); query('.stm-bulk-tools').hidden = !open;
        if (!open) librarySelection.clear(); renderTracks();
    });
    query('#stm-select-visible').addEventListener('change', event => { for (const track of libraryTracks()) if (event.target.checked) librarySelection.add(track.id); else librarySelection.delete(track.id); renderTracks(); });
    query('[data-action="bulk-add"]').addEventListener('click', () => {
        try {
            const ids = [...librarySelection], target = query('#stm-bulk-target').value;
            if (!settings.playlists.some(playlist => playlist.id === target)) throw new Error('请先创建并选择目标歌单。');
            if (ids.filter(id => !settings.tracks.some(track => track.id === id)).length > MAX_TRACKS - settings.tracks.length) throw new Error('总曲库容量不足，请减少勾选数量后重试。');
            for (const id of ids) addTrackToPlaylist(settings,target,id);
            save(); renderPlaylists(); renderTracks(); showStatus(`已将 ${ids.length} 首歌曲加入歌单，原歌曲保留不变。`);
        } catch (error) { showStatus(error.message,true); }
    });
    query('[data-action="bulk-unlink"]').addEventListener('click', async () => { const sourceId = browsedPlaylistId; for (const id of [...librarySelection]) await unlinkTrack(id, sourceId); librarySelection.clear(); renderTracks(); });
    query('[data-action="bulk-delete"]').addEventListener('click', async () => {
        if (!window.confirm(`从总曲库及所有歌单删除所选 ${librarySelection.size} 首歌曲？`)) return;
        for (const id of [...librarySelection]) await removeTrack(id,true);
        librarySelection.clear(); renderTracks();
    });
    query('[data-action="save-description"]').addEventListener('click', () => {
        const selected = browsedPlaylist(); if (!selected) return;
        const text = query('#stm-playlist-description').value.trim().slice(0,240);
        if (text) selected.description = text; else delete selected.description;
        save(); renderCollectionHero(); showStatus('歌单简介已保存。');
    });
    query('[data-action="edit-order"]').addEventListener('click', event => {
        const open = panel.dataset.orderEditing !== 'true'; panel.dataset.orderEditing = String(open); event.currentTarget.setAttribute('aria-pressed',String(open));
        panel.dataset.bulkEditing = 'false'; query('.stm-bulk-tools').hidden = true; query('[data-action="toggle-bulk"]').setAttribute('aria-pressed','false'); librarySelection.clear();
        query('#stm-library-sort').value = 'original'; query('#stm-library-filter').value = 'all'; query('#stm-library-search').value = ''; menus.refresh(); renderTracks();
        if (open) showStatus('使用歌曲右侧的上下箭头调整歌单顺序；当前临时播放队列保持不变。');
    });
    query('[data-action="reset-queue"]').addEventListener('click', () => { playbackQueue.reset(settings.activePlaylistId); renderQueue(); updateMini(); showStatus('已恢复歌单顺序，永久歌单没有改动。'); });

    function renderRoleStatus() {
        const current = freshContext();
        const avatar = currentCharacterAvatar(current);
        const binding = playlistForCharacter(settings, avatar);
        const name = current.characters?.[current.characterId]?.name || '当前角色';
        query('[data-role="role-status"]').textContent = avatar
            ? `${name} · ${binding ? `绑定「${binding.name}」` : '未绑定歌单'}`
            : `总曲库 ${settings.tracks.length} 首 · 进入角色自动切换绑定歌单`;
    }

    function renderRolePicker() {
        if ((typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__)) return;
        const selected = browsedPlaylist();
        const picker = query('.stm-role-picker');
        picker.replaceChildren();
        if (!selected) return;
        const characters = new Map((freshContext().characters || [])
            .filter(character => character.avatar && character.avatar !== 'none')
            .map(character => [character.avatar, character.name || character.avatar]));
        for (const avatar of selected.characterAvatars) {
            if (!characters.has(avatar)) characters.set(avatar, `${avatar}（角色暂不在列表中）`);
        }
        for (const [avatar, name] of characters) {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.avatar = avatar;
            checkbox.checked = selected.characterAvatars.includes(avatar);
            checkbox.setAttribute('aria-label', `${name}（${avatar}）`);
            const caption = document.createElement('span');
            caption.textContent = name;
            const binding = playlistForCharacter(settings, avatar);
            if (binding && binding.id !== selected.id) {
                const note = document.createElement('small');
                note.textContent = `当前绑定：${binding.name}`;
                caption.append(note);
            }
            label.append(checkbox, caption);
            picker.append(label);
        }
        if (!characters.size) picker.textContent = '酒馆中还没有角色卡，请先添加角色。';
    }

    function showLibraryHome() {
        libraryDetail = false; panel.dataset.libraryDetail = 'false';
        query('#stm-library-home').hidden = false;
        query('#stm-library-detail').hidden = true;
        query('#stm-create-playlist-panel').hidden = true;
        setManagerOpen(false);
        showPage('library'); renderLibraryHome();
    }
    async function browseCollection(id) {
        const normalized = id === BUILTIN_ID && !settings.builtinHidden ? BUILTIN_ID : settings.playlists.some(playlist => playlist.id === id) ? id : null;
        showPage('library');
        viewRevision++; browsedPlaylistId = normalized; librarySelection.clear();
        libraryDetail = true; panel.dataset.libraryDetail = 'true';
        query('#stm-library-home').hidden = true;
        query('#stm-library-detail').hidden = false;
        setManagerOpen(false);
        renderPlaylists(); renderTracks();
        query('#stm-page-library').scrollTop = 0;
    }
    function openCreatePlaylist(trackId = null) {
        membershipTrackId = trackId;
        showPage('library');
        const track = findTrack(settings, trackId);
        query('[data-role="create-title"]').textContent = track ? `新建歌单，并加入「${track.title}」` : '给新歌单起个名字';
        query('#stm-create-playlist-panel').hidden = false;
        query('#stm-page-library').scrollTop = 0;
        query('#stm-new-playlist').focus();
    }
    function collectionImage(image, playlist) {
        const track = playlist ? getQueue(settings, playlist.id)[0] : settings.tracks[0];
        const coverId = playlist?.coverId || track?.coverId;
        const fallback = fallbackCoverUrl(track?.fallbackCover ?? 0);
        image.src = playlist?.source?.cover || track?.cover || fallback;
        image.onerror = () => { if (image.src !== fallback) image.src = fallback; };
        if (coverId) void cachedCover(coverId).then(url => { if (url && image.isConnected) image.src = url; });
    }
    function renderLibraryHome() {
        for (const [target, collections] of [[query('[data-role="all-collection"]'), [null]], [query('[data-role="playlist-collections"]'), settings.playlists]]) {
            target.replaceChildren();
            for (const playlist of collections) {
                const row = document.createElement('div'); row.className = 'stm-collection-row';
                const button = document.createElement('button'); button.type = 'button'; button.className = 'stm-collection-open';
                button.dataset.collectionId = playlist?.id || '';
                const name = playlist?.name || '总曲库'; button.setAttribute('aria-label', `打开歌单：${name}`);
                const image = document.createElement('img'); image.alt = ''; image.className = 'stm-collection-cover';
                const text = document.createElement('span'); const title = document.createElement('strong'); title.textContent = name;
                const subtitle = document.createElement('small'); subtitle.textContent = `${playlist ? playlist.trackIds.length : settings.tracks.length} 首${playlist ? ' · 自建歌单' : ' · 全部音乐'}`;
                text.append(title, subtitle); button.append(image, text);
                button.addEventListener('click', () => { void browseCollection(playlist?.id || null); });
                row.append(button);
                if (playlist) {
                    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'stm-icon'; edit.textContent = '⋯';
                    edit.setAttribute('aria-label', `管理歌单：${playlist.name}`);
                    edit.addEventListener('click', async () => { await browseCollection(playlist.id); if (browsedPlaylist()?.id === playlist.id) setManagerOpen(true); });
                    row.append(edit);
                }
                target.append(row); collectionImage(image, playlist);
            }
        }
        const defaults = query('[data-role="builtin-collection"]'); defaults.replaceChildren(); defaults.hidden = settings.builtinHidden;
        if (!settings.builtinHidden) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'stm-collection-open stm-builtin-collection'; button.dataset.collectionId = BUILTIN_ID; button.setAttribute('aria-label', '打开默认曲库');
            const image = document.createElement('img'); image.className = 'stm-collection-cover'; image.alt = ''; image.src = settings.builtinCatalog.tracks[0]?.cover || fallbackCoverUrl(1);
            const text = document.createElement('span'); const title = document.createElement('strong'); title.textContent = settings.builtinCatalog.title;
            const count = document.createElement('small'); count.textContent = settings.builtinCatalog.tracks.length ? `${settings.builtinCatalog.tracks.length} 首 · 开发者预设` : '开发者尚未配置正式曲目';
            text.append(title, count); button.append(image, text); button.addEventListener('click', () => { void browseCollection(BUILTIN_ID); }); defaults.append(button);
        }
        query('#stm-created-playlists').hidden = !settings.playlists.length;
        query('#stm-library-home').hidden = libraryDetail;
        query('#stm-library-detail').hidden = !libraryDetail;
    }
    query('[data-action="library-home"]').addEventListener('click', showLibraryHome);
    query('[data-action="new-playlist"]').addEventListener('click', () => openCreatePlaylist());
    query('[data-action="cancel-create"]').addEventListener('click', () => { query('#stm-create-playlist-panel').hidden = true; });
    query('[data-action="create-for-song"]').addEventListener('click', () => openCreatePlaylist(membershipTrackId));
    let preferredPlaylistId = null;
    query('[data-action="choose-library-songs"]').addEventListener('click', async () => {
        const playlist = browsedPlaylist(); if (!playlist) return;
        preferredPlaylistId = playlist.id;
        await browseCollection(null);
        showStatus(`点歌曲右侧“⋯ → 加入歌单”，目标已预选为「${playlist.name}」。`);
    });
    const playlistCoverInput = query('[data-role="playlist-cover-file"]');
    query('[data-action="playlist-cover"]').addEventListener('click', () => playlistCoverInput.click());
    playlistCoverInput.addEventListener('change', async () => {
        const file = playlistCoverInput.files[0]; playlistCoverInput.value = '';
        const playlist = browsedPlaylist(); if (!file || !playlist) return;
        const id = `cover:${createTrackId()}`;
        try {
            validateImageFile(file);
            const image = await prepareCover(file);
            await store.put(id, image);
            if (disposed || !settings.playlists.includes(playlist)) { await store.delete(id); return; }
            const previous = playlist.coverId; playlist.coverId = id;
            save(); renderPlaylists();
            if (previous) { forgetCover(previous); retireAssets([previous]); }
            showStatus('歌单封面已更新，图片保存在当前浏览器。');
        } catch (error) { await store.delete(id).catch(() => {}); showStatus(error.message || '歌单封面保存失败。', true); }
    });
    query('[data-action="clear-playlist-cover"]').addEventListener('click', async () => {
        const playlist = browsedPlaylist(); if (!playlist?.coverId) return;
        const previous = playlist.coverId;
        delete playlist.coverId; forgetCover(previous); save(); renderPlaylists(); showStatus('已恢复歌单默认封面。');
        retireAssets([previous]);
    });

    function renderPlaylists() {
        const importId = importTarget.value;
        const bulkId = query('#stm-bulk-target').value;
        const membershipId = query('#stm-add-target').value;
        for (const [select, libraryName] of [[playlistSelect, '总曲库'], [query('#stm-library-playlist'), '总曲库'], [importTarget, '不选择 · 仅加入总曲库'], [query('#stm-add-target'), null], [query('#stm-bulk-target'), null]]) {
            select.replaceChildren();
            if (libraryName) select.append(new Option(libraryName, ''));
            if (select === playlistSelect && !settings.builtinHidden && settings.builtinCatalog.tracks.length) select.append(new Option(settings.builtinCatalog.title, BUILTIN_ID));
            if (select === query('#stm-library-playlist') && browsedPlaylistId === BUILTIN_ID) select.append(new Option(settings.builtinCatalog.title, BUILTIN_ID));
            for (const playlist of settings.playlists) select.append(new Option(playlist.name, playlist.id));
        }
        playlistSelect.value = settings.activePlaylistId || '';
        query('#stm-library-playlist').value = browsedPlaylistId || '';
        importTarget.value = settings.playlists.some(item => item.id === importId) ? importId : '';
        if (settings.playlists.some(item => item.id === membershipId)) query('#stm-add-target').value = membershipId;
        if (settings.playlists.some(item => item.id === bulkId)) query('#stm-bulk-target').value = bulkId;
        const selected = browsedPlaylist();
        query('.stm-playlist-editor').hidden = !selected;
        if (selected) { query('#stm-playlist-name').value = selected.name; query('#stm-playlist-description').value = selected.description || ''; }
        menus.refresh();
        if (!settings.playlists.length || !findTrack(settings, membershipTrackId)) query('.stm-membership').hidden = true;
        renderRoleStatus();
        renderRolePicker();
        renderLibraryHome();
        renderCollectionHero();
        query('[data-action="toggle-manager"]').hidden = !selected;
        query('[data-action="choose-library-songs"]').hidden = !selected;
        query('[data-action="clear-playlist-cover"]').disabled = !selected?.coverId;
    }

    async function activatePlaylist(id, open = false) {
        if(activeSceneState||scenePreview){activeSceneState=null;scenePreview=null;void applySceneVisuals();}
        settings.activePlaylistId = id === BUILTIN_ID && !settings.builtinHidden ? BUILTIN_ID : settings.playlists.some(playlist => playlist.id === id) ? id : null;
        const revision = ++viewRevision;
        playbackQueue.reset(settings.activePlaylistId);
        pausePlayback();
        query('.stm-membership').hidden = true;
        renderPlaylists();
        if (open) { showPage('playback'); setOpen(true, false); }
        const queue = playbackQueue.tracks();
        const selected = activePlaylist();
        const track = queue.find(item => item.id === settings.currentId)
            || queue.find(item => item.id === selected?.lastTrackId) || queue[0];
        if (track?.id !== settings.currentId || (!audio.getAttribute('src') && track)) await selectTrack(track?.id ?? null);
        else { save(); renderTracks(); }
        return revision === viewRevision;
    }

    function pausePlayback() {
        playerUI.setResolving(false);
        clearTimeout(playbackTimer); officialPlayer.close(); officialList.close();
        platformLoadController?.abort(); platformLoadController = null;
        loadSequence++;
        selectionPending = false; updateProgress();
        canAutoAdvance = false;
        transitions.stop();
    }
    function softPause() {
        playerUI.setResolving(false);
        clearTimeout(playbackTimer); platformLoadController?.abort(); platformLoadController = null;
        loadSequence++; selectionPending = false; updateProgress(); canAutoAdvance = false;
        return transitions.pause();
    }

    async function syncRole(force = false) {
        if(maintenanceBusy)return;
        const avatar = currentCharacterAvatar(freshContext());
        if (!force && avatar === lastRoleAvatar) { renderRoleStatus(); return; }
        sceneManager?.close(true);scenePreview=null;
        designEditor?.close();
        const previous = lastRoleAvatar;
        lastRoleAvatar = avatar;
        refreshDesign();
        const revision = ++roleRevision;
        viewRevision++;
        if (avatar) {
            pausePlayback();
            const binding = playlistForCharacter(settings, avatar);
            browsedPlaylistId = binding?.id ?? null;
            librarySelection.clear();
            const activated = await activatePlaylist(binding?.id ?? null, Boolean(binding) && visibility?.state === 'normal' && !(typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__));
            if (!activated || revision !== roleRevision) return;
            const scene=selectedScene(settings,avatar,allTracks(settings));
            if(scene)await activateScene(scene.id,{playState:false,remember:false});
            if (binding) showStatus(`已打开「${binding.name}」，点击播放开始听歌。`);
        } else if (previous) {
            activeSceneState=null;scenePicker?.close();void applySceneVisuals();
            pausePlayback();
            showStatus('已离开角色聊天，音乐已暂停。');
        }
        renderRoleStatus();
    }

    function renderTracks() {
        list.replaceChildren();
        const collection = getQueue(settings, browsedPlaylistId);
        const queue = libraryTracks(collection);
        let assignedCover = false;
        for (const track of queue) {
            if (track.fallbackCover === undefined) { track.fallbackCover = randomCover(); assignedCover = true; }
            const row = document.createElement('li');
            row.className = 'stm-track'; row.dataset.trackId = track.id;
            if (panel.dataset.bulkEditing === 'true') {
                const label = document.createElement('label'); label.className = 'stm-bulk-check';
                const check = document.createElement('input'); check.type = 'checkbox'; check.checked = librarySelection.has(track.id); check.setAttribute('aria-label', `选择歌曲：${track.title}`);
                check.addEventListener('change', () => { if (check.checked) librarySelection.add(track.id); else librarySelection.delete(track.id); updateSelection(); });
                label.append(check); row.append(label);
            }
            row.classList.toggle('stm-active', track.id === settings.currentId);
            const thumbnail = document.createElement('img');
            thumbnail.className = 'stm-track-thumbnail'; thumbnail.alt = ''; thumbnail.loading = 'lazy';
            thumbnail.src = track.cover || fallbackCoverUrl(track.fallbackCover ?? 0);
            if (track.coverId) void cachedCover(track.coverId).then(url => { if (url && thumbnail.isConnected) thumbnail.src = url; });
            thumbnail.addEventListener('error', () => { const fallback = fallbackCoverUrl(track.fallbackCover ?? 0); if (thumbnail.src !== fallback) thumbnail.src = fallback; });
            row.append(thumbnail);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'stm-track-select';
            button.setAttribute('aria-label', `${platformService.canPlay(track) ? '播放' : '查看来源'}：${track.title}`);
            button.setAttribute('aria-current', track.id === settings.currentId ? 'true' : 'false');
            const title = document.createElement('span');
            title.className = 'stm-track-title';
            title.textContent = track.title;
            const source = document.createElement('small');
            source.textContent = track.kind === 'platform' ? `${track.artist ? track.artist + ' · ' : ''}${PLATFORM_NAMES[track.platform]} · ${platformService.canPlay(track) ? '站内播放' : platformService.canEmbed(track) ? '官方播放器 · 可能仅试听' : '官方平台收听'}` : track.artist || (track.kind === 'local' ? '本地音乐' : new URL(track.url).hostname);
            button.append(title, source);
            button.addEventListener('click', () => void toggleTrack(track.id, browsedPlaylistId));
            row.append(button);
            const details = document.createElement('button');
            details.type = 'button'; details.className = 'stm-icon'; details.textContent = '⋯';
            details.setAttribute('aria-label', `歌曲详情：${track.title}`);
            details.dataset.detailsId = track.id;
            details.addEventListener('click', () => {
                detailsTrackId = track.id; setDetailsOpen(true);
            });
            row.append(details);
            row.append(listening.button(track.id));
            if (browsedPlaylist() && panel.dataset.orderEditing === 'true') {
                for (const [direction, caption] of [[-1,'上移'],[1,'下移']]) {
                    const move = document.createElement('button'); move.type = 'button'; move.className = 'stm-icon stm-move-song'; move.textContent = direction < 0 ? '↑' : '↓'; move.setAttribute('aria-label', `${caption}歌曲：${track.title}`);
                    const index = browsedPlaylist().trackIds.indexOf(track.id); move.disabled = direction < 0 ? index === 0 : index === browsedPlaylist().trackIds.length - 1;
                    move.addEventListener('click', () => {
                        const ids = browsedPlaylist().trackIds, from = ids.indexOf(track.id), to = from + direction;
                        if (from < 0 || to < 0 || to >= ids.length) return;
                        [ids[from], ids[to]] = [ids[to], ids[from]]; save(); renderTracks();
                        [...list.querySelectorAll('.stm-move-song')].find(button => button.getAttribute('aria-label') === `${caption}歌曲：${track.title}`)?.focus({preventScroll:true});
                    }); row.append(move);
                }
            }
            row.append(trackControl(track, browsedPlaylistId));
            list.append(row);
        }
        query('[data-role="collection-title"]').textContent = collectionName(browsedPlaylistId);
        query('[data-role="count"]').textContent = String(queue.length);
        query('.stm-empty').hidden = collection.length > 0;
        query('.stm-search-empty').hidden = !collection.length || Boolean(queue.length);
        updateSelection(); renderCollectionHero();
        query('.stm-empty').textContent = browsedPlaylistId === BUILTIN_ID ? '开发者尚未配置默认曲目。以后更新插件会收到预设曲库，你的歌曲和歌单会保留。' : browsedPlaylist() ? '此歌单还没有歌曲，请选择导入目标，或从总曲库添加。' : '曲库还是空的，导入本地音乐或添加直链开始吧。';
        playButton.disabled = !playbackQueue.tracks().some(track => platformService.canPlay(track));
        query('[data-action="previous"]').disabled = playbackQueue.tracks().length === 0;
        query('[data-action="next"]').disabled = playbackQueue.tracks().length === 0;
        if (assignedCover) save();
        if (!findTrack(settings, detailsTrackId)) setDetailsOpen(false);
        else if (!query('#stm-details').hidden) renderSongDetails();
        renderQueue();
        renderHistory();
        listening.render();
        updatePlayback();
        journalUI?.sync();
    }

    function songButton(track, label, detail, playTrack) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'stm-track-select';
        button.setAttribute('aria-label', `${platformService.canPlay(track) ? label : '查看来源'}：${track.title}`);
        button.setAttribute('aria-current', String(track.id === settings.currentId));
        const title = document.createElement('span');
        title.className = 'stm-song-title';
        title.textContent = track.title;
        const subtitle = document.createElement('small');
        subtitle.textContent = detail;
        button.append(title, subtitle);
        button.addEventListener('click', playTrack);
        return button;
    }

    function renderQueue() {
        const queue = playbackQueue.tracks();
        const target = query('.stm-queue-list');
        const scrollTop = target.scrollTop;
        const focused = target.contains(document.activeElement) ? {
            id: document.activeElement.closest('.stm-queue-track')?.dataset.trackId,
            toggle: document.activeElement.classList.contains('stm-row-play'), action: document.activeElement.dataset.queueAction,
        } : null;
        target.replaceChildren();
        for (const track of queue) {
            const row = document.createElement('li');
            row.className = 'stm-queue-track';
            row.dataset.trackId = track.id;
            row.classList.toggle('stm-active', track.id === settings.currentId);
            row.append(songButton(track, '播放队列歌曲', `${track.id === settings.currentId ? '当前歌曲' : playbackQueue.hasPlayed(track.id) ? '本轮已播放' : '接下来'} · ${track.artist || (track.kind === 'local' ? '本地音乐' : '在线音乐')}`, () => { void toggleTrack(track.id); }), trackControl(track));
            for (const [action, label, text] of [['up','上移队列歌曲','↑'],['down','下移队列歌曲','↓'],['remove','移出播放队列','×']]) {
                const button = document.createElement('button'); button.type = 'button'; button.className = 'stm-icon stm-queue-edit'; button.textContent = text; button.dataset.queueAction = action; button.setAttribute('aria-label', `${label}：${track.title}`);
                const index = queue.findIndex(item => item.id === track.id);
                button.disabled = action === 'remove' ? track.id === settings.currentId : action === 'up' ? index === 0 : index === queue.length - 1;
                button.addEventListener('click', () => { if (action === 'remove') playbackQueue.remove(track.id, settings.currentId); else playbackQueue.move(track.id, action === 'up' ? -1 : 1); renderQueue(); updateMini();
                    [...target.querySelectorAll('[data-queue-action]')].find(item => item.closest('li').dataset.trackId === track.id && item.dataset.queueAction === action)?.focus({preventScroll:true});
                }); row.append(button);
            }
            target.append(row);
        }
        query('.stm-queue-empty').hidden = queue.length > 0;
        target.scrollTop = scrollTop;
        if (focused && !query('#stm-queue').hidden) {
            const row = [...target.children].find(element => element.dataset.trackId === focused.id);
            (row?.querySelector(focused.action ? `[data-queue-action=${focused.action}]` : focused.toggle ? '.stm-row-play' : '.stm-track-select') || query('#stm-queue button')).focus({ preventScroll: true });
        }
        query('.stm-sheet-empty').hidden = queue.length > 0;
        query('[data-role="queue-count"]').textContent = ` · ${queue.length} 首`;
        query('[data-role="queue-source"]').textContent = `来自：${collectionName()}`;
        designPresentation?.sync();
        updatePlayback();
    }

    async function toggleTrack(id, sourceId) {
        const selected = findTrack(settings, id);
        if (!selected) return;
        if (!platformService.canPlay(selected)) { detailsTrackId = id; setDetailsOpen(true); if (platformService.canEmbed(selected)) officialPlayer.open(selected); else showStatus('此歌曲仅支持前往官方平台收听。'); return; }
        if (settings.currentId === id && audio.getAttribute('src') && !audio.error) {
            if (transitions.intent === 'playing' && !audio.ended) await softPause(); else await play();
            return;
        }
        const destination = sourceId === undefined ? (settings.builtinCatalog.tracks.some(track => track.id === id) && !settings.tracks.some(track => track.id === id) ? BUILTIN_ID : null) : sourceId;
        if ((sourceId !== undefined && sourceId !== settings.activePlaylistId || !playbackQueue.tracks().some(track => track.id === id)) && !await activatePlaylist(destination)) return;
        await selectTrack(id, true);
    }
    function trackControl(track, sourceId) {
        if (!platformService.canPlay(track)) {
            if (platformService.canEmbed(track)) {
                const button = document.createElement('button'); button.type = 'button'; button.className = 'stm-secondary stm-embed-open'; button.textContent = '官方播放器';
                button.setAttribute('aria-label', `打开官方播放器：${track.title}`); button.addEventListener('click', () => void toggleTrack(track.id, sourceId)); return button;
            }
            const link = document.createElement('a'); link.className = 'stm-external-source'; link.href = track.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '↗'; link.setAttribute('aria-label', `前往官方平台：${track.title}`); return link;
        }
        const button = document.createElement('button'); button.type = 'button'; button.className = 'stm-row-play';
        button.dataset.trackToggle = track.id; button.dataset.trackTitle = track.title;
        button.addEventListener('click', () => { void toggleTrack(track.id, sourceId); });
        return button;
    }
    async function playHistoryTrack(id) { await toggleTrack(id); }

    function renderHistory() {
        const recent = recentTracks(settings);
        const ranking = rankedTracks(settings);
        for (const [selector, entries, ranked] of [['.stm-recent-list', recent, false], ['.stm-ranking-list', ranking, true]]) {
            const target = query(selector);
            target.replaceChildren();
            entries.forEach((entry, index) => {
                const row = document.createElement('li');
                row.className = 'stm-history-track';
                const number = document.createElement('span');
                number.className = 'stm-rank-number';
                number.textContent = String(index + 1).padStart(2, '0');
                const detail = ranked ? `${entry.count} 次播放` : new Date(entry.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                row.append(number, songButton(entry.track, ranked ? '播放排行歌曲' : '播放最近歌曲', detail, () => void playHistoryTrack(entry.track.id)), trackControl(entry.track));
                target.append(row);
            });
        }
        query('.stm-recent-empty').hidden = recent.length > 0;
        query('.stm-ranking-empty').hidden = ranking.length > 0;
        updatePlayback();
    }

    function updateProgress() {
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        seek.disabled = selectionPending || duration <= 0;
        seek.max = String(duration);
        seek.value = String(audio.currentTime || 0);
        query('[data-role="elapsed"]').textContent = formatTime(audio.currentTime);
        query('[data-role="duration"]').textContent = formatTime(duration);
        updateLyrics();
    }

    function updatePlayback() {
        const playing = !audio.paused && !audio.ended;
        playButton.innerHTML = playSymbol(playing);
        for (const button of panel.querySelectorAll('[data-track-toggle]')) {
            const active = button.dataset.trackToggle === settings.currentId;
            const live = active && playing;
            button.innerHTML = playSymbol(live);
            button.setAttribute('aria-label', `${live ? '暂停歌曲' : '播放歌曲'}：${button.dataset.trackTitle}`);
            button.setAttribute('aria-pressed', String(live));
            button.closest('li')?.classList.toggle('stm-active', active);
        }
        updateMini();
        listening?.update();
        playButton.setAttribute('aria-label', playing ? '暂停' : '播放');
        playButton.title = playing ? '暂停' : '播放';
        panel.classList.toggle('stm-is-playing', playing);
        launcher.classList.toggle('stm-playing', playing);
        launcher.title = playing ? '正在播放音乐 · 点击打开，拖动可移动' : '点击打开音乐播放器，拖动可移动';
        launcher.setAttribute('aria-label', launcher.title);
        if (!query('#stm-details').hidden) renderSongDetails();
    }

    function releaseSource() {
        playerUI.setResolving(false);
        clearTimeout(playbackTimer); officialPlayer.close(); officialList.close();
        platformLoadController?.abort(); platformLoadController = null;
        transitions.stop();
        audio.removeAttribute('src');
        audio.load();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null;
        updateProgress();
    }

    async function play() {
        officialPlayer.close(); officialList.close();
        const sequence = loadSequence;
        canAutoAdvance = true;
        clearTimeout(playbackTimer);
        if (findTrack(settings, settings.currentId)?.kind === 'platform') playbackTimer = setTimeout(() => {
            if (sequence !== loadSequence) return;
            platformService.invalidate(findTrack(settings, settings.currentId)); pausePlayback(); releaseSource();
            showStatus('音频加载超过 20 秒，请检查网络或稍后再点播放以重新获取音源。', true);
        }, 20000);
        try {
            await transitions.play();
            if (sequence === loadSequence) showStatus();
        } catch (error) {
            clearTimeout(playbackTimer);
            if (error.name === 'AbortError' || sequence !== loadSequence) return;
            showStatus(error.name === 'NotAllowedError'
                ? '浏览器阻止了自动播放，请再点一次“播放”。'
                : audio.error ? audioFailure() : '无法播放此音乐，请检查网络、格式或来源权限后再试。', true);
        }
    }

    async function selectTrack(id, shouldPlay = false) {
        const sequence = ++loadSequence, displayEpoch = visibility?.epoch;
        canAutoAdvance = false;
        selectionPending = true; updateProgress();
        try {
        if (shouldPlay && !audio.paused && !audio.ended) {
            const completed = await transitions.fadeOut();
            if (!completed || sequence !== loadSequence || disposed) return;
        }
        if (disposed || sequence !== loadSequence) return;
        playSession++;
        canAutoAdvance = true;
        releaseSource();
        const track = playbackQueue.tracks().find(item => item.id === id);
        settings.currentId = track?.id ?? null;
        const playlist = activePlaylist();
        if (playlist && track) playlist.lastTrackId = track.id;
        save();
        renderTracks();
        query('[data-role="title"]').textContent = track?.title ?? '还没有音乐';
        query('[data-role="source"]').textContent = track ? (track.kind === 'platform' ? [track.artist, PLATFORM_NAMES[track.platform], platformService.canPlay(track) ? '站内播放' : '官方平台收听'].filter(Boolean).join(' · ') : track.artist || (track.kind === 'local' ? '本地音乐' : '在线音乐')) : '从导入页添加喜欢的音乐';
        void renderMedia(track);
        showStatus();
        if (!track) return;
        if (track.kind === 'platform' && !shouldPlay) return;
        try {
            let source = track.url;
            if (track.kind === 'platform') {
                if (!platformService.canPlay(track)) { if (shouldPlay) showStatus('此平台歌曲仅支持前往官方平台收听，可在歌曲详情中打开来源。'); return; }
                platformLoadController = new AbortController();
                playerUI.setResolving(true);
                const resolved = await platformService.resolve(track, { signal: platformLoadController.signal });
                if (sequence !== loadSequence) return;
                source = normalizeUrl(resolved.url);
            }
            if (track.kind === 'local') {
                playerUI.setResolving(true);
                const blob = await store.get(track.id);
                if (sequence !== loadSequence) return;
                if (!blob) throw new Error('这个本地文件不在当前浏览器中，请删除该条目并重新导入。');
                objectUrl = URL.createObjectURL(blob);
                source = objectUrl;
            }
            if (sequence !== loadSequence) return;
            if (location.protocol === 'https:' && source.startsWith('http:')) {
                throw new Error('当前酒馆使用 HTTPS，请使用 HTTPS 音乐直链。');
            }
            audio.src = source;
            audio.load();
            if (shouldPlay && visibility?.state !== 'hidden' && displayEpoch === visibility?.epoch) await play();
        } catch (error) {
            if (sequence === loadSequence) showStatus(error.message || '读取音乐失败，请重新导入。', true);
        } finally {
            if (sequence === loadSequence) playerUI.setResolving(false);
        }
        } finally {
            if (sequence === loadSequence) { selectionPending = false; updateProgress(); }
        }
    }

    async function removeTrack(id, confirmed = false) {
        const track = findTrack(settings, id);
        if (!track) return;
        if (!confirmed && !window.confirm(`从总曲库删除「${track.title}」？\n这首歌也会从所有歌单中移除。`)) return;
        const keys = [...(track.kind === 'local' ? [id] : []), ...(track.coverId ? [track.coverId] : [])];
        if (!findTrack(settings, id)) return;
        const liveIndex = playbackQueue.tracks().findIndex(item => item.id === id);
        const current = settings.currentId === id;
        const wasPlaying = !audio.paused;
        deleteTrackFromLibrary(settings, id);
        retireAssets(keys);
        if (track.coverId) forgetCover(track.coverId);
        save();
        renderPlaylists();
        renderTracks();
        const queue = playbackQueue.tracks();
        if (current) await selectTrack(queue.length ? queue[Math.max(0, liveIndex) % queue.length].id : null, wasPlaying);
    }

    async function unlinkTrack(id, playlistId = browsedPlaylistId) {
        const playlist = settings.playlists.find(item => item.id === playlistId);
        if (!playlist) return;
        const index = playbackQueue.tracks().findIndex(track => track.id === id);
        const current = settings.activePlaylistId === playlist.id && settings.currentId === id;
        const wasPlaying = !audio.paused;
        removeTrackFromPlaylist(settings, playlist.id, id);
        save();
        renderPlaylists();
        renderTracks();
        const queue = playbackQueue.tracks();
        if (current) await selectTrack(queue.length ? queue[Math.max(0, index) % queue.length].id : null, wasPlaying);
        showStatus('已从此歌单移除，歌曲仍保留在总曲库。');
    }

    async function finishImport(targetId, revision) {
        const target = settings.playlists.find(item => item.id === targetId);
        const destinationId = target?.id ?? null;
        if (revision === viewRevision) browsedPlaylistId = destinationId;
        renderPlaylists();
        if (revision === viewRevision) {
            if (settings.activePlaylistId !== destinationId && audio.paused) await activatePlaylist(destinationId);
            else if (!settings.currentId && getQueue(settings).length) await selectTrack(getQueue(settings)[0].id);
        }
        renderTracks();
        return target;
    }

    async function importFiles(files) {
        if (importing) return;
        importing = true;
        const importButton = query('[data-action="import"]');
        importButton.disabled = true;
        const problems = [];
        let added = 0;
        const targetId = importTarget.value || null;
        const revision = viewRevision;
        for (const file of files) {
            if (disposed) break;
            try {
                if (settings.tracks.length >= MAX_TRACKS) throw new Error(`总曲库最多可添加 ${MAX_TRACKS} 首音乐。`);
                validateAudioFile(file);
                const metadata = await readEmbeddedMetadata(file).catch(() => ({}));
                if (disposed) break;
                const id = createTrackId();
                await store.put(id, file);
                if (disposed || settings.tracks.length >= MAX_TRACKS) {
                    await store.delete(id);
                    if (disposed) break;
                    throw new Error(`总曲库最多可添加 ${MAX_TRACKS} 首音乐。`);
                }
                let coverId;
                if (metadata.cover) {
                    const key = `cover:${createTrackId()}`;
                    try { await store.put(key, await prepareCover(metadata.cover)); coverId = key; } catch { /* Music remains usable with bundled artwork if storage is full. */ }
                }
                if (disposed) { await store.deleteMany([id, ...(coverId ? [coverId] : [])]).catch(() => {}); break; }
                settings.tracks.push({ id, kind: 'local', title: metadata.title || file.name.replace(/\.[^.]+$/, '').slice(0, 160),
                    ...(metadata.artist ? { artist: metadata.artist } : {}), ...(metadata.lyrics ? { lyrics: metadata.lyrics } : {}), ...(coverId ? { coverId } : {}) });
                addTrackToPlaylist(settings, targetId, id);
                added++;
                save();
            } catch (error) {
                problems.push(`${file.name}：${error.name === 'QuotaExceededError' ? '浏览器存储空间不足，请删除一些本地音乐后重试。' : (error.message || '本地存储失败。')}`);
            }
        }
        if (disposed) { importing = false; return; }
        const target = added ? await finishImport(targetId, revision) : settings.playlists.find(item => item.id === targetId);
        if (!added) { renderPlaylists(); renderTracks(); }
        showStatus([added ? `已导入 ${added} 首音乐${target ? `，并加入「${target.name}」` : '到总曲库'}。` : '',
            targetId && !target ? '目标歌单已删除，歌曲保留在总曲库。' : '', ...problems].filter(Boolean).join(' '), problems.length > 0);
        importing = false;
        importButton.disabled = false;
        fileInput.value = '';
    }

    launcher.addEventListener('click', () => setOpen(panel.hidden));
    launcher.addEventListener('keydown', event => { if (event.target === launcher && ['Enter', ' '].includes(event.key)) { event.preventDefault(); setOpen(panel.hidden); } });
    query('[data-action="close"]').addEventListener('click', () => setOpen(false));
    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
    });
    function toggleCurrent() {
        const current = findTrack(settings, settings.currentId);
        if (!current || !platformService.canPlay(current)) { void selectTrack(playbackQueue.tracks().find(track => platformService.canPlay(track))?.id, true); return; }
        if (transitions.intent === 'playing' && !audio.ended) void softPause();
        else if (!audio.getAttribute('src') || audio.error) void selectTrack(settings.currentId || playbackQueue.tracks()[0]?.id, true);
        else void play();
    }
    playButton.addEventListener('click', toggleCurrent);
    function advanceTrack(direction) {
        void selectTrack(nextTrackId(playbackQueue.tracks().filter(track => platformService.canPlay(track)), settings.currentId, settings.mode, { direction }), !audio.paused);
    }
    for (const [action, direction] of [['previous', -1], ['next', 1]]) {
        query(`[data-action="${action}"]`).addEventListener('click', () => {
            advanceTrack(direction);
        });
    }
    query('[data-action="import"]').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => void importFiles(Array.from(fileInput.files)));
    query('.stm-url-form').addEventListener('submit', async event => {
        event.preventDefault();
        try {
            const url = normalizeUrl(urlInput.value);
            if (location.protocol === 'https:' && url.startsWith('http:')) throw new Error('请使用 HTTPS 音乐直链。');
            const targetId = importTarget.value || null;
            const revision = viewRevision;
            let track = settings.tracks.find(item => item.url === url);
            if (track && !targetId) throw new Error('这首音乐已经在总曲库中了。');
            if (!track) {
                if (settings.tracks.length >= MAX_TRACKS) throw new Error(`总曲库最多可添加 ${MAX_TRACKS} 首音乐。`);
                track = { id: createTrackId(), kind: 'url', title: titleFromUrl(url), url };
                settings.tracks.push(track);
            }
            addTrackToPlaylist(settings, targetId, track.id);
            save();
            urlInput.value = '';
            const target = await finishImport(targetId, revision);
            showStatus(target ? `已将音乐加入「${target.name}」，总曲库也保留此歌曲。` : '已添加音乐直链到总曲库。');
        } catch (error) { showStatus(error.message, true); }
    });

    playlistSelect.addEventListener('change', () => void activatePlaylist(playlistSelect.value || null));
    query('#stm-library-playlist').addEventListener('change', event => void browseCollection(event.currentTarget.value || null));
    query('[data-action="manage-playlists"]').addEventListener('click', async () => { await browseCollection(settings.activePlaylistId); if (browsedPlaylist()) setManagerOpen(true); else openCreatePlaylist(); });
    query('.stm-create-playlist').addEventListener('submit', async event => {
        event.preventDefault();
        try {
            const playlist = createPlaylist(settings, query('#stm-new-playlist').value);
            query('#stm-new-playlist').value = '';
            const pending = findTrack(settings, membershipTrackId);
            if (pending) addTrackToPlaylist(settings, playlist.id, pending.id);
            membershipTrackId = null;
            query('#stm-create-playlist-panel').hidden = true;
            save();
            await browseCollection(playlist.id);
            showStatus(pending ? `已创建「${playlist.name}」并加入「${pending.title}」。` : `已创建「${playlist.name}」。点“导入音乐”，或点“从总曲库选歌”。`);
        } catch (error) { showStatus(error.message, true); }
    });
    query('.stm-rename-playlist').addEventListener('submit', event => {
        event.preventDefault();
        try {
            renamePlaylist(settings, browsedPlaylistId, query('#stm-playlist-name').value);
            save(); renderPlaylists(); renderTracks();
            showStatus('歌单名称已保存。');
        } catch (error) { showStatus(error.message, true); }
    });
    query('[data-action="delete-playlist"]').addEventListener('click', async () => {
        const selected = browsedPlaylist();
        if (!selected || !window.confirm(`删除歌单「${selected.name}」？\n歌曲将全部保留在总曲库，角色绑定会解除。`)) return;
        if (selected.coverId) {
            retireAssets([selected.coverId]); forgetCover(selected.coverId);
        }
        const wasActive = settings.activePlaylistId === selected.id;
        deletePlaylist(settings, selected.id);
        browsedPlaylistId = null; librarySelection.clear();
        save();
        renderPlaylists();
        if (wasActive) await activatePlaylist(null);
        renderTracks();
        showStatus('歌单已删除，歌曲全部保留在总曲库。');
        if (!(typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__)) {
            try { await nativeExport.syncBindings(); }
            catch (error) { showStatus(`歌单已删除，但随卡播放器未更新，原卡资源已保留：${error.message}`, true); }
        }
    });
    query('[data-action="bind-roles"]').addEventListener('click', event => {
        const form = query('#stm-role-bindings');
        form.hidden = !form.hidden;
        event.currentTarget.setAttribute('aria-expanded', String(!form.hidden));
        renderRolePicker();
    });
    query('#stm-role-bindings').addEventListener('submit', async event => {
        event.preventDefault();
        bindPlaylistCharacters(settings, browsedPlaylistId, Array.from(panel.querySelectorAll('.stm-role-picker input:checked'), input => input.dataset.avatar));
        save(); renderPlaylists();
        await syncRole(true);
        if (!(typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__)) {
            showStatus('角色绑定已保存，正在把音乐和播放器写入角色卡，请稍候…');
            try { await nativeExport.syncBindings(); showStatus('角色绑定已保存。音乐已随卡保存，可通过酒馆原生按钮导出 PNG / JSON。接收端需启用酒馆助手角色脚本。'); }
            catch (error) { showStatus(`角色绑定已保存，但随卡播放器未更新：${error.message}。请处理后重新保存绑定；原生导出前也会重新检查。`, true); }
        }
    });
    query('[data-action="confirm-membership"]').addEventListener('click', () => {
        try {
        const targetId = query('#stm-add-target').value;
        const added = addTrackToPlaylist(settings, targetId, membershipTrackId);
        save(); renderPlaylists(); renderTracks();
        query('.stm-membership').hidden = true;
        showStatus(added ? '已加入歌单，曲库歌曲保留不变。' : '这首歌已在所选歌单中。');
        } catch (error) { showStatus(error.message, true); }
    });
    query('[data-action="close-membership"]').addEventListener('click', () => { query('.stm-membership').hidden = true; });
    const modeLabels = { sequence: '顺序播放', list: '列表循环', single: '单曲循环', shuffle: '随机播放' };
    const modeIcons = {
        sequence: '<path d="M4 6h16M4 12h10M4 18h10m3-9 4 3-4 3"/>',
        list: '<path d="m17 3 4 4-4 4M3 11V9a2 2 0 0 1 2-2h16M7 21l-4-4 4-4m14 0v2a2 2 0 0 1-2 2H3"/>',
        single: '<path d="m17 3 4 4-4 4M3 11V9a2 2 0 0 1 2-2h16M7 21l-4-4 4-4m14 0v2a2 2 0 0 1-2 2H3"/><path d="m10 11 2-1v5m-2 0h4"/>',
        shuffle: '<path d="m18 3 3 3-3 3m0 6 3 3-3 3M3 6h3c4 0 8 12 12 12h3M3 18h3c2 0 4-3 6-6s4-6 6-6h3"/>',
    };
    function renderMode() {
        mode.dataset.mode = settings.mode;
        mode.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${modeIcons[settings.mode]}</svg>`;
        mode.setAttribute('aria-label', `播放模式：${modeLabels[settings.mode]}`);
        mode.title = `${modeLabels[settings.mode]} · 点击切换播放模式`;
    }
    mode.addEventListener('click', () => { settings.mode = PLAY_MODES[(PLAY_MODES.indexOf(settings.mode) + 1) % PLAY_MODES.length]; renderMode(); save(); showStatus(`播放模式：${modeLabels[settings.mode]}`); });
    renderMode();
    function updateVolume() {
        volume.value = String(Math.round(settings.volume * 100));
        query('[data-role="volume"]').textContent = audio.muted ? '静音' : `${volume.value}%`;
        const muteButton = query('[data-action="mute"]');
        muteButton.textContent = audio.muted ? '⊘' : '♪';
        muteButton.setAttribute('aria-label', audio.muted ? '取消静音' : '静音');
        muteButton.title = audio.muted ? '取消静音' : '静音';
    }
    audio.volume = settings.volume;
    updateVolume();
    volume.addEventListener('input', () => {
        settings.volume = Number(volume.value) / 100;
        transitions.refresh();
        audio.muted = false;
        updateVolume();
        save();
    });
    query('[data-action="mute"]').addEventListener('click', () => { audio.muted = !audio.muted; transitions.refresh(); updateVolume(); });
    seek.addEventListener('input', () => {
        if (!selectionPending && Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = Number(seek.value);
    });
    for (const event of ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied']) audio.addEventListener(event, updateProgress);
    for (const event of ['play', 'playing', 'waiting', 'stalled', 'pause', 'ended', 'error']) audio.addEventListener(event, updatePlayback);
    audio.addEventListener('pause', () => { if (audio.paused) transitions.refresh(); });
    audio.addEventListener('error', () => transitions.refresh());
    audio.addEventListener('playing', () => {
        clearTimeout(playbackTimer);
        if (audio.paused || !settings.currentId || countedSession === playSession) return;
        countedSession = playSession; playbackQueue.markPlayed(settings.currentId);
        recordPlayback(settings, settings.currentId);
        save();
        renderHistory();
    });
    // Rankings expire even if the player remains open for several days.
    const historyTimer = window.setInterval(() => {
        if (!panel.hidden && (currentPage === 'ranking' || currentPage === 'recent')) renderHistory();
    }, 60000);
    audio.addEventListener('ended', () => {
        if (listening.timer.ended()) return;
        if (!canAutoAdvance || visibility?.autoAdvanceAllowed === false) return;
        const nextId = nextTrackId(playbackQueue.tracks().filter(track => platformService.canPlay(track)), settings.currentId, settings.mode, { ended: true });
        if (nextId) void selectTrack(nextId, true);
        else showStatus('播放列表已播放完毕。');
    });
    audio.addEventListener('error', () => {
        clearTimeout(playbackTimer);
        if (!audio.getAttribute('src')) return;
        if (findTrack(settings, settings.currentId)?.kind === 'platform') { platformService.invalidate(findTrack(settings, settings.currentId)); showStatus(audioFailure(), true); return; }
        showStatus('音乐加载失败：链接可能失效、需要登录，或浏览器不支持此格式。可尝试下载后导入本地文件。', true);
    });
    function audioFailure() {
        return ({ 1: '播放已中断，可重新点播放。', 2: '音源网络连接失败；请检查网络，重试会重新获取地址。', 3: '浏览器无法解码此音频，请尝试其他歌曲或浏览器。', 4: '音源无法加载：可能已失效、受访问限制，或格式不受浏览器支持。重试会重新获取地址。' })[audio.error?.code] || '平台音源加载失败，请检查网络或原站权限后重试。';
    }
    let cardMaker;
    const hostStops = [];
    function dispose() {
        if (disposed) return;
        disposed = true;
        listening?.dispose(); transitions.dispose();
        journalUI?.dispose();
        sceneManager?.dispose();scenePicker?.dispose();++sceneVisualEpoch;if(sceneImageUrl)URL.revokeObjectURL(sceneImageUrl);
        designEditor?.dispose(); designFont?.dispose();
        lyricReader?.dispose(); readingControls?.dispose(); launcherControls?.dispose(); launcherAvoidance?.dispose(); designControls?.dispose(); designPresentation?.dispose();
        dataPanel?.dispose(); cardMaker?.dispose(); handoff?.dispose(); lyricsLookup?.dispose(); cropper.dispose(); nativeExport?.dispose(); retirement?.dispose(); options.onDispose?.();
        ++loadSequence;
        pausePlayback(); audio.removeAttribute('src'); audio.load();
        for (const stop of hostStops.splice(0)) stop();
        visibility?.dispose(); launcherDrag.dispose(); panelDrag.dispose();
        if (!(typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__)) delete window.__risereinFullMusicPlayer;
        ++mediaRevision; ++backgroundRevision; ++roleRevision;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
        if (coverUrl) URL.revokeObjectURL(coverUrl);
        for (const id of coverCache.keys()) forgetCover(id);
        fontPicker?.dispose(); mini.dispose(); playerUI.dispose(); online?.dispose(); platformLoadController?.abort(); menus.dispose(); resizer.dispose(); disposeClickEffects();
        clearTimeout(playbackTimer); officialPlayer.close(); officialList.close();
        systemScheme.removeEventListener('change', onSystemScheme);
        window.clearInterval(historyTimer);
        window.clearTimeout(statusTimer);
        panel.remove(); launcher.remove();
    }
    // Do not interrupt pages being kept in the browser back/forward cache.
    const onPageHide = event => { if (!event.persisted) dispose(); };
    window.addEventListener('pagehide', onPageHide);
    hostStops.push(() => window.removeEventListener('pagehide', onPageHide));

    const settingsArea = (typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__) ? null : document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (settingsArea) {
        const entry = document.createElement('div');
        entry.className = 'stm-settings-entry';
        const button = document.createElement('button');
        button.className = 'menu_button';
        button.type = 'button';
        button.textContent = '♫ 打开音乐播放器'; fullRecoveryEntry = button;
        button.addEventListener('click', () => setOpen(true));
        entry.append(button);
        settingsArea.append(entry);
        hostStops.push(() => entry.remove());
    }
    if (context.eventSource && context.eventTypes) {
        // Music file reads must not delay the host's chat navigation.
        const onHost = (type, callback) => {
            context.eventSource.on(type, callback);
            hostStops.push(() => {
                const remove = context.eventSource.removeListener || context.eventSource.off;
                remove?.call(context.eventSource, type, callback);
            });
        };
        onHost(context.eventTypes.CHAT_CHANGED, () => { if (!disposed) void syncRole(); });
        onHost(context.eventTypes.APP_READY, () => { if (!disposed) void syncRole(true); });
        if (context.eventTypes.CHARACTER_RENAMED) {
            onHost(context.eventTypes.CHARACTER_RENAMED, (oldAvatar, newAvatar) => {
                if (typeof oldAvatar !== 'string' || typeof newAvatar !== 'string') return;
                for (const playlist of settings.playlists) playlist.characterAvatars = playlist.characterAvatars.map(avatar => avatar === oldAvatar ? newAvatar : avatar);
                for (const row of settings.roleDesigns) if (row.avatar === oldAvatar) row.avatar = newAvatar;
                for (const row of settings.roleScenes) if (row.avatar === oldAvatar) row.avatar = newAvatar;
                for (const row of settings.scenePreferences) if (row.avatar === oldAvatar) row.avatar = newAvatar;
                if (lastRoleAvatar === oldAvatar) lastRoleAvatar = newAvatar;
                save(); renderPlaylists();
            });
        }
    }
    const nativeExport = (typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__) ? null : createNativeCardExport({ settings, store, getContext: freshContext, showStatus });
    const handoff = (typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__) ? null : createCardHandoff(panel);
    if(!(typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__)) {
        sceneManager=createSceneManager({panel,settings,store,getContext:freshContext,save,onError:error=>showStatus(error.message,true),onPreview:previewScene,onSaved:async avatar=>{
            scenePreview=null;if(avatar===currentCharacterAvatar(freshContext())){const scene=selectedScene(settings,avatar,allTracks(settings));if(scene)await activateScene(scene.id,{preview:true});else {activeSceneState=null;await activatePlaylist(settings.activePlaylistId);}}
            scenePicker?.refresh();
        }});
        const entry=document.createElement('button');entry.type='button';entry.className='stm-secondary';entry.dataset.action='music-scenes';entry.textContent='角色音乐场景';entry.addEventListener('click',()=>sceneManager.open(currentCharacterAvatar(freshContext())));query('[data-action=card-maker]').after(entry);
    }
    scenePicker=createScenePicker({panel,getGroup:sceneGroupForCurrent,getCurrent:()=>activeSceneState?.scene,onChoose:id=>{scenePreview=null;return activateScene(id);},onManage:(typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__)?null:()=>sceneManager.open(currentCharacterAvatar(freshContext())),onError:error=>showStatus(error.message,true)});
    journalUI=createJournal({panel,audio,getTrack:()=>findTrack(settings,settings.currentId),getTracks:()=>playbackQueue.tracks(),getScene:()=>activeSceneState?.scene,getGroup:()=>activeSceneState?.group||roleSceneGroup(settings,currentCharacterAvatar(freshContext())),onTrack:id=>{if(id===settings.currentId){if(audio.paused)void play();else void softPause();}else void selectTrack(id,true);},onLyrics:visible=>{if(visible){lyricReader?.reset();updateLyrics(true);}else lyricReader?.suspend();}});
    journalUI.apply(effectiveDesign());
    if (!(typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__)) {
        cardMaker = createCardMaker({panel,settings,store,context,getCollectionId:()=>browsedPlaylistId,pausePlayback,getDesign:effectiveDesign});
        query('[data-action="card-maker"]').addEventListener('click',()=>cardMaker.open());
        if(options.account){
            dataPanel=createDataPanel({panel,settings,store,journal:maintenanceJournal,context,account:options.account,assertAccount:options.assertAccount||(async()=>{throw new Error('账号身份未确认，请重新登录并刷新。');}),flushMaker:()=>cardMaker.flush(),pausePlayback,setMaintenanceBusy});
        }
        query('[data-action="rebuild-native"]').addEventListener('click', async () => {
            const latest = freshContext(), avatar = latest.characters[latest.characterId]?.avatar;
            if (latest.groupId || !avatar || !playlistForCharacter(settings, avatar)) { showStatus('请先打开已绑定歌单的单人角色卡。', true); return; }
            try { await nativeExport.rebuild(avatar); showStatus('随卡播放器已按当前版本重建；歌曲和外观配置保留。请重新从酒馆导出 PNG / JSON。'); }
            catch (error) { showStatus(`重建未完成：${error.message}`, true); }
        });

    } else {
        panel.style.setProperty('--stm-nav-count', '5');
        // Initialize the shared components, then remove every music-import entry.
        for (const element of panel.querySelectorAll('[data-page="import"], #stm-page-import, [data-action="go-import"], [data-action="card-maker"], [data-action="rebuild-native"], [data-role="card-handoff"], [data-action="bind-roles"], #stm-role-bindings')) element.remove();
        query('.stm-queue-empty').textContent = '在曲库选择一首歌开始听歌。';
    }
    visibility = createVisibilityController({ panel, launcher, audio, getPreference: () => settings.visibility, setPreference: value => { settings.visibility = value; save(); }, getTrackId: () => settings.currentId, close: () => setOpen(false, false), open: () => setOpen(true), onHide: () => { transitions.stop(); listening?.cancelSleep?.(); lyricReader?.suspend(); }, onStatus: text => showStatus(text), hostDocument: options.visibilityHostDocument || document, recoveryId: options.recoveryId || 'full', allowWand: (typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__), onPosition: position => {settings.positions.launcher=position;save();}, helperRecovery: options.helperRecovery, preview: options.previewRecovery === true, externalRecovery: () => !!fullRecoveryEntry?.isConnected, getInput: options.getInputElement || (() => document.querySelector('#send_form')) });
    renderPlaylists();
    renderTracks();
    if (settings.currentId) void selectTrack(settings.currentId);
    if (!document.getElementById('preloader')) void syncRole(true);
    return { panel, launcher, audio, settings, dispose, setOpen, visibility, setDesign: applyUserDesign, getDesign: effectiveDesign, chooseScene:activateScene,getScene:()=>activeSceneState?.scene||null,openScenes:()=>sceneManager?.open(currentCharacterAvatar(freshContext())) };
}

async function startFullPlayer() {
    const context=globalThis.SillyTavern?.getContext();
    if(!context?.extensionSettings)return initialize();
    if(document.querySelector('#stm-player:not([data-portable])'))return;
    let account;
    try {account=await identifyAccount({headers:context.getRequestHeaders()});}
    catch(error){
        setStorageScope({key:null,verified:false,label:'账号身份未确认'});
        const api=initialize({account:{key:null,verified:false},accountError:error.message});
        window.toastr?.warning(error.message,'音乐存储已锁定',{escapeHtml:true});return api;
    }
    setStorageScope(account);let api;
    // Unwind the recipient's account wrapper before capturing the host fetch.
    // Otherwise the full-player guard can retain a forwarding wrapper from a closed iframe.
    window.dispatchEvent(new Event('riserein:full-player-start'));
    document.querySelector('[data-riserein-card-player]')?.__risereinPlayer?.dispose();
    const guard=createAccountGuard({account,context,onMismatch(){api?.dispose();window.toastr?.warning('酒馆账号已切换，旧音乐播放器已停止。请刷新当前页面。','账号变化',{escapeHtml:true});}});
    try {api=initialize({account,assertAccount:guard.assert,onDispose:guard.dispose});return api;}
    catch(error){guard.dispose();throw error;}
}
if (!(typeof __STM_PORTABLE__ !== 'undefined' && __STM_PORTABLE__)) {
    const start=()=>{void startFullPlayer().catch(error=>{console.error('[音乐播放器] 初始化失败');window.toastr?.error(error.message,'音乐播放器',{escapeHtml:true});});};
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
    else start();
}

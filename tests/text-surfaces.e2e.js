import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const prefix = '/scripts/extensions/third-party/sillytavern/';
const phase = process.env.ST_TEXT_PHASE || 'after';
const root = process.env.ST_TEXT_REPORT_DIR || 'docs/text-surfaces';

async function choose(page, id, value) {
    await page.locator(id + '-trigger').click();
    await page.locator(id + '-menu [data-value="' + value + '"]').click();
}

test('real SillyTavern ordinary text and parents are unframed across pages, layouts and schemes', async ({ page }, info) => {
    await mkdir(`${root}/${phase}`, { recursive: true });
    await page.route('**/api/settings/get', async route => {
        const response = await route.fetch(), body = await response.json(), settings = JSON.parse(body.settings);
        settings.firstRun = false; settings.main_api = 'kobold'; settings.api_server = '';
        settings.extension_settings ||= {};
        settings.extension_settings.riserein_music_player = {
            tracks: [{ id: 'plate-a', kind: 'url', title: '风与故事', artist: '原创合成测试音', url: new URL(prefix + 'card-player/demo-assets/test-tone-a.mp3', page.url()).href, lyrics: '[00:00]听见故事里的风\n[00:02]收藏每一段心动\n[00:04]让旋律继续\n[00:06]走过长夜与晨光' }],
            playlists: [{ id: 'plate-list', name: '雨夜来信', trackIds: ['plate-a'], characterAvatars: [] }],
            favorites: [{trackId:'plate-a',at:Date.now()-1000}],
            theme: 'night', fontPreset: 'sans', colorScheme: 'dark', surface: 'glass', transitionDuration: 0, panelSize: { width: 600, height: 740 },
        };
        body.settings = JSON.stringify(settings); await route.fulfill({ response, json: body });
    });
    await page.goto('/'); await page.waitForFunction(() => !document.getElementById('preloader'));
    await expect(page.locator('#stm-launcher')).toBeVisible({ timeout: 30000 });
    await page.evaluate(async () => (await import('/script.js')).closeCurrentChat());
    await page.unroute('**/api/settings/get'); await page.locator('#stm-launcher').click();
    await page.locator('[data-action=play]').click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(a => a.currentTime)).toBeGreaterThan(.1);
    await page.evaluate(() => { window.textAudio = document.querySelector('#stm-player audio'); window.textSrc = textAudio.src; });
    // An actual image behind the plugin, not just two theme HEX values.
    await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 800;
        const c = canvas.getContext('2d'), gradient = c.createLinearGradient(0,0,600,800);
        gradient.addColorStop(0,'#f5d8bc'); gradient.addColorStop(.4,'#253c4c'); gradient.addColorStop(1,'#e7eef0');
        c.fillStyle=gradient;c.fillRect(0,0,600,800); c.fillStyle='#fff';c.beginPath();c.arc(420,190,100,0,Math.PI*2);c.fill();
        window.textImage = canvas.toDataURL();
    });
    const records=[];
    async function capture(name, layout, scheme) {
        const data = await page.locator('#stm-player').evaluate(async (panel, name) => {
            const { sampleReadingInk } = await import('/scripts/extensions/third-party/sillytavern/tests/rendered-reading.js');
            const visible = n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
            const ordinary = [...panel.querySelectorAll('p:not(.stm-status),small,label,h3,summary,.stm-now-info,.stm-eyebrow,.stm-page-heading,.stm-settings-group,.stm-list-heading,.stm-role-status,.stm-collection-hero,.stm-library-nav,.stm-library-tools,.stm-time,.stm-options,.stm-volume,.stm-footer,.stm-visibility-controls,.stm-track-select,.stm-collection-open,.stm-history-track:not(.stm-active),.stm-track:not(.stm-active),.stm-rank-number,.stm-empty,.stm-page-empty,.stm-import-divider,.stm-inline-form')].filter(visible);
            // A selected song row is an intentional whole-row selection, not a text plate.
            ordinary.push(...[...panel.querySelectorAll('[data-role=card-handoff],.stm-page,#stm-library-home,#stm-library-detail,.stm-library-collections')].filter(visible));
            const samples=ordinary.map(n=>{const s=getComputedStyle(n);return {tag:n.tagName,class:n.className,text:n.textContent.trim().slice(0,70),background:s.backgroundColor,image:s.backgroundImage,shadow:s.boxShadow,color:s.color,opacity:s.opacity,ratio:sampleReadingInk(n).ratio};});
            const alpha = color => { if(color==='transparent')return 0;const m=color.match(/rgba?\(([^)]+)\)/);return m ? Number(m[1].split(',')[3]??1) : color.includes(' / 0)') ? 0 : 1; };
            return {name,samples,boxed:samples.filter(s=>alpha(s.background)>0||s.image!=='none'),surface:getComputedStyle(panel,'::after').backgroundColor,controls:[...panel.querySelectorAll('.stm-primary,.stm-select-trigger,input[type=search],textarea')].filter(visible).map(n=>({class:n.className,bg:getComputedStyle(n).backgroundColor})),audioSame:window.textAudio===panel.querySelector('audio')&&textAudio.src===window.textSrc&&!textAudio.paused};
        },name);
        records.push({layout,scheme,...data});
        if(phase==='after') {
            expect(data.boxed,JSON.stringify({layout,scheme,name,boxed:data.boxed})).toEqual([]);
            for(const sample of data.samples)expect(sample.ratio,JSON.stringify({layout,scheme,name,sample})).toBeGreaterThanOrEqual(4.5);
            expect(data.audioSame).toBe(true);
            for(const control of data.controls)expect(control.bg).not.toBe('rgba(0, 0, 0, 0)');
        }
        // One complete before/after set on desktop dark and mobile light.
        if((info.project.name==='desktop'&&scheme==='dark')||(info.project.name!=='desktop'&&scheme==='light')) {
            await page.locator('#stm-player').screenshot({path:`${root}/${phase}/${layout}-${scheme}-${info.project.name}-${name}.png`});
        }
    }
    for(const layout of ['night','crystal','vinyl','cassette','pure']) for(const scheme of ['dark','light']) {
        await page.getByRole('tab',{name:'外观',exact:true}).click();
        await choose(page,'#stm-design-layout',layout);
        await page.locator(`[data-scheme-choice=${scheme}]`).click();
        await page.locator('#stm-player').evaluate(panel=>{panel.dataset.hasBackground='true';panel.style.setProperty('--stm-background-image',`url("${window.textImage}")`);panel.style.setProperty('--stm-mask-opacity','0');});
        await page.locator('#stm-appearance').evaluate(n=>n.scrollTop=0); await capture('appearance',layout,scheme);
        await page.getByRole('tab',{name:'播放',exact:true}).click(); await page.locator('#stm-page-playback').evaluate(n=>n.scrollTop=0); await capture('playback',layout,scheme);
        await page.locator('[data-action=toggle-lyrics]').click(); await capture('lyrics',layout,scheme); await page.locator('[data-action=back-cover]').click();
        await page.getByRole('tab',{name:'曲库',exact:true}).click();
        const home=page.locator('[data-action=library-home]'); if(await home.isVisible())await home.click();
        await page.locator('#stm-page-library').evaluate(n=>n.scrollTop=0); await capture('library',layout,scheme);
        await page.locator('[data-role=card-handoff]').evaluate(n=>n.open=true); await page.locator('[data-role=card-handoff]').scrollIntoViewIfNeeded(); await capture('handoff',layout,scheme);
        await page.locator('[data-role=card-handoff]').evaluate(n=>n.open=false);
        await page.locator('.stm-favorites-entry').click(); await capture('favorites',layout,scheme);
        await page.getByRole('tab',{name:'曲库',exact:true}).click(); if(await home.isVisible())await home.click();
        await page.locator('.stm-collection-open[data-collection-id="plate-list"]').click(); await capture('playlist',layout,scheme);
        await page.getByRole('tab',{name:'导入',exact:true}).click(); await capture('import',layout,scheme);
    }
    await writeFile(`${root}/${phase}/computed-${info.project.name}.json`,JSON.stringify(records,null,2));
    if(phase==='before')expect(records.some(r=>r.boxed.some(n=>n.tag==='P'))).toBe(true);
});

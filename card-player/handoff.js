import { verifyCardFile } from './quality.js';

/** Read card data only; never executes the selected file or changes a character. */
export function createCardHandoff(panel) {
    const section = panel.querySelector('[data-role="card-handoff"]');
    const input = section.querySelector('input');
    const result = section.querySelector('[data-role="handoff-result"]');
    const abort = new AbortController();
    let revision = 0;
    section.querySelector('button').addEventListener('click', () => input.click(), { signal: abort.signal });
    input.addEventListener('change', async () => {
        const file = input.files[0], current = ++revision;
        if (!file) return;
        result.textContent = '正在读取文件中的播放器与资源…';
        try {
            const report = await verifyCardFile(file, /\.png$/i.test(file.name) ? 'png' : 'json');
            if (abort.signal.aborted || current !== revision) return;
            result.textContent = `文件静态核对通过：${report.tracks} 首歌曲，播放器 ${report.runtimeVersion}，${(file.size / 1048576).toFixed(2)} MB。播放器脚本与曲目配置已写入文件；外链音频仍需联网访问原地址，此结果不代表已试听。接收端无需音乐插件，但需安装并启用酒馆助手，打开此卡后确认启用角色脚本；若曾取消，请到“酒馆助手 → 脚本库 → 角色脚本”手动启用。首次播放需手动点击。`;
        } catch (error) {
            if (!abort.signal.aborted && current === revision) result.textContent = `未通过分发检查：${error.message}`;
        } finally {
            input.value = '';
        }
    }, { signal: abort.signal });
    return { dispose() { ++revision; abort.abort(); } };
}

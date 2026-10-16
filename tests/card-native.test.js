import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { nativeCardScript, helperExportSettings } from '../card-player/native-export.js';

test('native export respects nested Helper private-data flags without mutating author settings or public scripts', () => {
    const settings = {
        variables: { preserve: 17 },
        scripts: [
            {
                type: 'folder',
                enabled: false,
                scripts: [
                    {
                        type: 'script',
                        id: 'private',
                        content: 'keep implementation',
                        data: { private: 42 },
                        button: { enabled: true, buttons: [{ name: 'Author', visible: true }] },
                        export_with: { data: false, button: false },
                    },
                ],
            },
            { type: 'script', id: 'public', data: { public: 13 }, export_with: { data: true, button: true } },
        ],
    };
    const result = helperExportSettings(settings);
    assert.deepEqual(result.scripts[0].scripts[0].data, {});
    assert.deepEqual(result.scripts[0].scripts[0].button.buttons, []);
    assert.equal(result.scripts[0].scripts[0].content, 'keep implementation');
    assert.deepEqual(result.scripts[1], settings.scripts[1]);
    assert.equal(settings.scripts[0].scripts[0].data.private, 42);
    assert.equal(settings.scripts[0].scripts[0].button.buttons.length, 1);
    assert.deepEqual(result.variables, { preserve: 17 });
});

test('native role script round-trips unicode and executable-looking metadata as data in the official helper envelope', () => {
    const payload = {
        version: 1,
        config: {
            title: '</script><script>throw new Error("metadata executed")</script> Amber 音乐\u2028',
            tracks: [{ title: 'bill', src: 'data:audio/mpeg;base64,AAAA' }],
        },
        ui: { theme: 'night' },
    };
    const runtime = 'const RisereinNativePlayer={startNativeCharacterPlayer(value){ capture(value); }};';
    const script = nativeCardScript(payload, runtime, 'test-script-id');
    let received;
    vm.runInNewContext(script.content, {
        capture: (value) => {
            received = JSON.parse(JSON.stringify(value));
        },
    });
    assert.deepEqual(received, payload);
    assert.equal(script.type, 'script');
    assert.equal(script.enabled, true);
    assert.deepEqual(script.export_with, { data: true, button: true });
    assert.equal(script.content.includes('</script>'), false);
});

test('native export refuses an incomplete runtime and an oversized script instead of returning a partial file', () => {
    assert.throws(() => nativeCardScript({ version: 1 }, '/* empty bundle */', 'id'), /不完整/);
    const runtime = 'const startNativeCharacterPlayer=()=>{};';
    assert.throws(
        () =>
            nativeCardScript(
                { config: { title: 'Oversized fixture' }, large: 'a'.repeat(46 * 1024 * 1024) },
                runtime,
                'id',
            ),
        /45 MB/,
    );
});

test('recipient sees startup errors from both synchronous and asynchronous initialization', async () => {
    for (const asyncFailure of [false, true]) {
        const reports = [];
        const runtime = `const RisereinNativePlayer={${asyncFailure ? 'async ' : ''}startNativeCharacterPlayer(){throw new Error('fixture startup error')}};`;
        const script = nativeCardScript({ config: { title: '启动失败测试', tracks: [] } }, runtime, 'broken');
        vm.runInNewContext(script.content, {
            console: { error() {} },
            window: { parent: { toastr: { error: (...args) => reports.push(args) } } },
        });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(reports.length, 1);
        assert.match(reports[0][0], /fixture startup error/);
        assert.equal(reports[0][2].escapeHtml, true);
        assert.equal(reports[0][2].timeOut, 0);
    }
});

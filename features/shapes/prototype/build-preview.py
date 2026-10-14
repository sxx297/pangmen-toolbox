"""Build the offline project preview and a self-contained conversation preview."""
from pathlib import Path
import argparse
import base64
import json

HERE = Path(__file__).resolve().parent

def build(inline_path=None, inline_effect=None):
    panel = (HERE / 'panel.html').read_text(encoding='utf-8')
    panel = panel.replace('</style>', (HERE / 'workspace-ui.css').read_text(encoding='utf-8-sig') + (HERE.parents[2] / 'shared/ui/toolbox-theme.css').read_text(encoding='utf-8') + '\n</style>')
    components = (HERE / 'controls-ui.js').read_text(encoding='utf-8-sig') + '\n' + (HERE / 'library-ui.js').read_text(encoding='utf-8-sig')
    artwork = 'globalThis.MaterialLibraryArtwork="data:image/png;base64,' + base64.b64encode((HERE / 'assets/glass-silk-amber-v1.png').read_bytes()).decode('ascii') + '";\n'
    renderer = (HERE / 'material-renderer.js').read_text(encoding='utf-8')
    worker_source = 'globalThis.MaterialRenderWorkerSource=' + json.dumps(renderer + '\n' + (HERE / 'render-worker.js').read_text(encoding='utf-8'), ensure_ascii=True).replace('</', '<\\/') + ';\n'
    async_renderer = worker_source + (HERE / 'async-renderer.js').read_text(encoding='utf-8')
    backgrounds = (HERE / 'preview-backgrounds.js').read_text(encoding='utf-8')
    presets = (HERE / 'preset-store.js').read_text(encoding='utf-8')
    handles = (HERE / 'direct-manipulation.js').read_text(encoding='utf-8')
    host_bridge = (HERE / 'host-bridge.js').read_text(encoding='utf-8')
    ui = (HERE.parents[2] / 'shared/ui/toast.js').read_text(encoding='utf-8') + '\n' + (HERE / 'ui.js').read_text(encoding='utf-8')
    license_text = (HERE / 'licenses' / 'liquid-dom-core-MIT.txt').read_text(encoding='utf-8')
    attribution = '/* Glass optics adapted from @liquid-dom/core 0.1.1.\n' + license_text + '\n*/\n'
    fragment = panel + '\n<script>\n' + attribution + renderer + '\n' + backgrounds + '\n' + presets + '\n' + handles + '\n' + host_bridge + '\n' + artwork + components + '\n' + async_renderer + '\n' + ui + '\n</script>\n'
    document = '''<!doctype html>
<html lang="zh-CN" data-material-standalone="true">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>旁门形状效果插件</title>
<style>
:root { color-scheme:light dark; background:light-dark(#fcfcfd,#14151a); }
body { margin:0; padding:36px 28px; }
main { max-width:1060px; margin:0 auto; }
@media(max-width:570px) { body { padding:20px 14px; } }
</style></head><body><main>
'''
    (HERE / 'index.html').write_text(document + fragment + '\n</main></body></html>\n', encoding='utf-8')
    preview_fragment = fragment.replace(host_bridge, host_bridge + '\n' + (HERE / 'windows-preview-host.js').read_text(encoding='utf-8'), 1)
    preview_header = '''<!doctype html><html lang="zh-CN" data-material-hosted="true"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Windows 面板预览</title><style>:root{color-scheme:light dark;background:light-dark(#fcfcfd,#191715)}body{margin:0;padding:10px;height:100vh;box-sizing:border-box}main{height:100%}</style></head><body><main>'''
    (HERE / 'windows-preview-frame.html').write_text(preview_header + preview_fragment + '\n</main></body></html>', encoding='utf-8')
    if inline_path:
        path = Path(inline_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        inline_fragment = fragment.replace('id="ppt-material-lab"', 'id="ppt-material-lab" data-initial-effect="' + inline_effect + '"', 1) if inline_effect else fragment
        path.write_text(inline_fragment, encoding='utf-8')
    print('Built prototype/index.html' + (' and inline preview' if inline_path else ''))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--inline')
    parser.add_argument('--inline-effect', choices=['glass', 'gradient'])
    args = parser.parse_args()
    build(args.inline, args.inline_effect)

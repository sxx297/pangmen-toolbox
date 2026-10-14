"""Download only the pinned build packages needed for the net48 desktop add-in."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import urllib.request
import zipfile

root = Path(__file__).resolve().parents[1]
packages = root / '.tools' / 'packages'
packages.mkdir(parents=True, exist_ok=True)
specs = [('microsoft.net.compilers.toolset', '4.8.0'),
         ('microsoft.netframework.referenceassemblies.net48', '1.0.3'),
         ('microsoft.web.webview2', '1.0.3650.58')]

def fetch(spec):
    name, version = spec
    filename = name + '.' + version + '.nupkg'
    url = 'https://api.nuget.org/v3-flatcontainer/' + name + '/' + version + '/' + filename
    archive = packages / filename
    target = packages / (name + '.' + version)
    if not archive.exists():
        print('Downloading ' + filename, flush=True)
        with urllib.request.urlopen(url, timeout=60) as response, archive.open('wb') as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk: break
                output.write(chunk)
    with zipfile.ZipFile(archive) as package:
        if package.testzip(): raise RuntimeError('Package is corrupt: ' + filename)
        target.mkdir(exist_ok=True)
        for item in package.infolist():
            if not (target / item.filename).resolve().is_relative_to(target.resolve()):
                raise RuntimeError('Unsafe package entry')
        package.extractall(target)
    return {'id': name, 'version': version, 'url': url,
            'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}

with ThreadPoolExecutor(max_workers=3) as pool:
    results = list(pool.map(fetch, specs))
(packages / 'build-packages.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
print(json.dumps(results), flush=True)

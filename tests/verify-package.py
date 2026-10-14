from pathlib import Path
import hashlib,json,subprocess,shutil,time
ROOT=Path(__file__).resolve().parents[1]
stamp=time.strftime('%Y%m%d-%H%M%S')
OUT=ROOT/'tests/results'/('package-'+stamp);OUT.mkdir(parents=True)
manifest=json.loads((ROOT/'dist/build-manifest.json').read_text(encoding='utf-8'))
checks=[]
for arch in ['x86','x64']:
    payload=ROOT/'build'/('addin-'+manifest['version'])/arch
    for entry in manifest['payloads'][arch]['files']:
        file=payload/entry['path'];assert file.stat().st_size==entry['bytes']
        assert hashlib.sha256(file.read_bytes()).hexdigest()==entry['sha256'],str(file)
        assert file.suffix.lower() not in ['.cs','.pdb','.map','.snk','.py','.cjs'],str(file)
    checks.append({'arch':arch,'test':'payload manifest and source exclusion','passed':True,'files':len(manifest['payloads'][arch]['files'])})
    runner=OUT/arch/'runner';runner.mkdir(parents=True)
    shutil.copy2(payload/'ActivationProbe.exe',runner/'ActivationProbe.exe')
    def probe(directory,name,expected,version=manifest['version']+'.0'):
        report=OUT/arch/(name+'.json')
        p=subprocess.run([str(runner/'ActivationProbe.exe'),'direct',str(directory/'PangmenToolbox.AddIn.dll'),version,str(report)],capture_output=True,timeout=60)
        passed=(p.returncode==0)==expected
        details=json.loads(report.read_text(encoding='utf-8-sig'))
        checks.append({'arch':arch,'test':name,'passed':passed,'report':str(report.relative_to(ROOT))})
        assert passed and details['passed']==expected,(name,p.stderr.decode(errors='replace'))
        assert details['environment']['process64Bit']==(arch=='x64')
    probe(payload,'direct',True)
    for name in ['PangmenToolbox.AddIn.dll','Microsoft.Web.WebView2.Core.dll','WebView2Loader.dll']:
        damaged=OUT/arch/('missing-'+name);shutil.copytree(payload,damaged)
        (damaged/name).unlink()
        probe(damaged,'missing-'+name,False)
    probe(payload,'wrong-version',False,'0.0.0.0')
setup=ROOT/'dist'/manifest['installer']['name']
assert hashlib.sha256(setup.read_bytes()).hexdigest()==manifest['installer']['sha256']
(OUT/'results.json').write_text(json.dumps({'installerSha256':manifest['installer']['sha256'],'checks':checks},indent=2),encoding='utf-8')
print(json.dumps({'passed':len(checks),'report':str(OUT/'results.json')}))

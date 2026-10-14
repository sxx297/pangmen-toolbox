"""Build the single protected toolbox and architecture-aware Windows installer."""
from pathlib import Path
import hashlib
import json
import subprocess
import shutil
import sys
import tempfile
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
VERSION = '1.0.11'
PACKAGES = ROOT / '.tools/packages'
CSC = PACKAGES / 'microsoft.net.compilers.toolset.4.8.0/tasks/net472/csc.exe'
REF = PACKAGES / 'microsoft.netframework.referenceassemblies.net48.1.0.3/build/.NETFramework/v4.8'
WV = PACKAGES / 'microsoft.web.webview2.1.0.3650.58'
SMA = Path('C:/Windows/Microsoft.NET/assembly/GAC_MSIL/System.Management.Automation/v4.0_3.0.0.0__31bf3856ad364e35/System.Management.Automation.dll')
KEY = ROOT / 'security/private/PangmenToolbox.snk'
BUILD = ROOT / 'build'
DIST = ROOT / 'dist'
WEB = BUILD / 'protected-web'
OUT = BUILD / ('addin-' + VERSION)
SHAPE = ROOT / 'features/shapes'
ANIM = ROOT / 'features/animations'
EXPORT = ROOT / 'features/export'

def run(args):
    subprocess.run([str(x) for x in args],cwd=ROOT,check=True)

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def obfuscar():
    version='2.2.38'
    archive=PACKAGES / ('obfuscar.'+version+'.nupkg')
    folder=PACKAGES / ('obfuscar.'+version)
    exe=folder / 'tools/Obfuscar.Console.exe'
    if not archive.exists():
        urllib.request.urlretrieve('https://api.nuget.org/v3-flatcontainer/obfuscar/'+version+'/'+archive.name,archive)
    if not exe.exists():
        with zipfile.ZipFile(archive) as z:
            for info in z.infolist():
                if not (folder/info.filename).resolve().is_relative_to(folder.resolve()): raise ValueError('Bad package path')
            z.extractall(folder)
    save(ROOT/'security/build-tools.json',{'obfuscar':{'version':version,'sha256':digest(archive)},'javascriptObfuscator':'4.1.1','terser':'5.44.0'})
    return exe

def protect_dll(exe, target):
    staging=BUILD/'obfuscated'/target.parent.name/target.stem
    staging.mkdir(parents=True,exist_ok=True)
    config=ET.Element('Obfuscator')
    for name,value in {'InPath':str(target.parent),'OutPath':str(staging),'KeyFile':str(KEY),
                       'KeepPublicApi':'true','HidePrivateApi':'true','RenameProperties':'false',
                       'RenameFields':'false','RenameEvents':'false','HideStrings':'true',
                       'OptimizeMethods':'false','RegenerateDebugInfo':'false'}.items():
        ET.SubElement(config,'Var',name=name,value=value)
    for folder in [REF,SMA.parent,target.parent]: ET.SubElement(config,'AssemblySearchPath',path=str(folder))
    module=ET.SubElement(config,'Module',file=str(target))
    # COM/Ribbon and reflection/serialization contracts stay stable.
    for namespace in ['PangmenToolbox.AddIn','Pangmen.Motion']:
        ET.SubElement(module,'SkipNamespace',name=namespace)
    # C# dynamic invokes member names via the runtime binder. Preserve these methods.
    import re
    for source in (ROOT/'features').rglob('*.cs'):
        text=source.read_text(encoding='utf-8-sig')
        namespace=re.search(r'namespace\s+([\w.]+)',text)
        if namespace and re.search(r'\bdynamic\b',text):
            for kind in re.finditer(r'\bclass\s+(\w+)',text):
                ET.SubElement(module,'SkipType',name=namespace[1]+'.'+kind[1],skipMethods='true')
    ET.SubElement(module,'SkipType',name='<>f__AnonymousType*',skipMethods='true',skipFields='true',skipProperties='true')
    file=staging/'obfuscar.xml'
    ET.ElementTree(config).write(file,encoding='utf-8',xml_declaration=True)
    run([exe,'-s',file])
    shutil.copy2(staging/target.name,target)

def main():
    for d in [BUILD,DIST,WEB,OUT,KEY.parent]: d.mkdir(parents=True,exist_ok=True)
    if not KEY.exists():
        key_script=BUILD/'create-strong-name.ps1'
        key_script.write_text("param([string]$Output)\n$rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider 2048\ntry { [IO.File]::WriteAllBytes($Output, $rsa.ExportCspBlob($true)) } finally { $rsa.Dispose() }\n",encoding='utf-8-sig')
        run(['powershell.exe','-NoProfile','-ExecutionPolicy','RemoteSigned','-File',key_script,KEY])
    run([sys.executable,ROOT/"tools/build-theme.py"])
    exe=obfuscar()
    run([sys.executable,SHAPE/'prototype/build-preview.py'])
    run([sys.executable,ANIM/'build-preview.py'])
    run(['node',ROOT/'tools/build-native-catalog.cjs'])
    for source,dest in [(SHAPE/'prototype/index.html',WEB/'shapes/index.html'),(ANIM/'preview/index.html',WEB/'animations/index.html'),(EXPORT/'ui/pdf-export.js',WEB/'export/pdf-export.js')]:
        stamp=dest.with_suffix('.input-sha256')
        expected=digest(source)+digest(ROOT/'tools/protect-web.cjs')
        if not dest.exists() or not stamp.exists() or stamp.read_text()!=expected:
            run(['node',ROOT/'tools/protect-web.cjs',source,dest])
            stamp.write_text(expected)
    for name in ['pdf-export.html','pdf-export.css']: shutil.copy2(EXPORT/'ui'/name,WEB/'export'/name)
    with (WEB/'export/pdf-export.css').open('a',encoding='utf-8') as f: f.write('\n'+(ROOT/'shared/ui/toolbox-theme.css').read_text(encoding='utf-8'))
    framework=['mscorlib','System','System.Core','System.Windows.Forms','System.Drawing','System.Web.Extensions',
               'System.Xml','System.Xml.Linq','Microsoft.CSharp','System.IO.Compression','System.IO.Compression.FileSystem','System.Runtime.Serialization','System.Data']
    common=[CSC,'/nologo','/noconfig','/nostdlib+','/langversion:latest','/optimize+','/warn:4','/deterministic+']+['/reference:'+str(REF/(n+'.dll')) for n in framework]
    webview=[WV/'lib/net462/Microsoft.Web.WebView2.Core.dll',WV/'lib/net462/Microsoft.Web.WebView2.WinForms.dll']
    payloads={}; manifests={}
    for arch in ['x86','x64']:
        published=OUT/arch
        assert published.resolve().parent==OUT.resolve() and OUT.resolve().is_relative_to(ROOT)
        # A fresh staging tree prevents stale scripts, debug files or user data from
        # being swept into the payload by rglob on repeated builds.
        staging=Path(tempfile.mkdtemp(prefix='payload-stage-',dir=BUILD))
        output=staging/arch
        output.mkdir()
        motion=output/'PangmenToolbox.Motion.dll'
        run(common+['/target:library','/platform:'+arch,'/keyfile:'+str(KEY),'/out:'+str(motion)]+[ANIM/'powerpoint'/n for n in ['NativeTrackWriter.cs','NumericFrameRenderer.cs','NumericTimeline.cs']])
        protect_dll(exe,motion)
        for p in webview: shutil.copy2(p,output/p.name)
        shutil.copy2(WV/('runtimes/win-'+arch+'/native/WebView2Loader.dll'),output/'WebView2Loader.dll')
        for module in ['shapes','animations']:
            target=output/'web'/module;target.mkdir(parents=True,exist_ok=True)
            shutil.copy2(WEB/module/'index.html',target/'index.html')
        scripts=['host/embedded-bridge.ps1','powerpoint/selection-animations.ps1','powerpoint/native-animations.ps1',
                 'powerpoint/number-frames.ps1','powerpoint/text-effects.ps1','powerpoint/selection-preview.ps1','powerpoint/native-catalog.json',
                 'powerpoint/assets/cloud-scalable.pptx','powerpoint/assets/loop-until-end.pptx']
        for name in scripts:
            target=output/'modules/animations'/name;target.parent.mkdir(parents=True,exist_ok=True)
            data=(ANIM/name).read_bytes()
            if name.endswith('.ps1'):
                import re
                text=data.decode('utf-8-sig')
                text=re.sub(r"Add-Type -Path \(Join-Path \$PSScriptRoot '(?:NativeTrackWriter|NumericFrameRenderer|NumericTimeline)\.cs'\) -ReferencedAssemblies [^\r\n}]+", "Add-Type -Path (Join-Path $PSScriptRoot '../../../PangmenToolbox.Motion.dll')",text)
                # Drop comments using the PowerShell parser in the next stage; retain script semantics.
                target.write_text(text,encoding='utf-8-sig')
            else: target.write_bytes(data)
        licenses=output/'licenses';licenses.mkdir(exist_ok=True)
        shutil.copy2(ROOT/'LICENSE',licenses/'PangmenToolbox-GPL-3.0.txt')
        shutil.copy2(ROOT/'THIRD_PARTY_NOTICES.md',licenses/'THIRD_PARTY_NOTICES.md')
        shutil.copy2(SHAPE/'prototype/licenses/liquid-dom-core-MIT.txt',licenses/'liquid-dom-core-MIT.txt')
        for p in WV.iterdir():
            if p.is_file() and any(n in p.name.lower() for n in ['license','notice']): shutil.copy2(p,licenses/('WebView2-'+p.name))
        asset_paths=[output/'web',output/'modules']
        integrity={p.relative_to(output).as_posix():digest(p) for d in asset_paths for p in d.rglob('*') if p.is_file()}
        integrity[motion.name]=digest(motion)
        integrity_path=BUILD/('integrity-'+arch+'.json');save(integrity_path,integrity)
        sources=sorted((ROOT/'host').glob('*.cs'))+sorted((SHAPE/'host').glob('*.cs'))+sorted((ANIM/'host').glob('*.cs'))+sorted((EXPORT/'host').glob('*.cs'))+sorted((ROOT/'security').glob('*.cs'))
        args=common+['/target:library','/platform:'+arch,'/keyfile:'+str(KEY),'/out:'+str(output/'PangmenToolbox.AddIn.dll')]
        args+=['/reference:'+str(p) for p in webview]+['/reference:'+str(SMA)]
        for brand in ['ShapeEffects','PangmenAnimation']:
            for ext in ['ico','png']: args+=['/resource:'+str(SHAPE/'host/assets'/('pang.'+ext))+','+brand+'.Pang.'+ext]
        args+=['/resource:'+str(WEB/'export'/n)+',ShapeEffects.Export.'+n for n in ['pdf-export.html','pdf-export.css','pdf-export.js']]
        args+=['/resource:'+str(integrity_path)+',PangmenToolbox.AssetIntegrity.json']
        run(args+sources)
        protect_dll(exe,output/'PangmenToolbox.AddIn.dll')
        run(common+['/target:exe','/platform:'+arch,'/out:'+str(output/'ActivationProbe.exe'),ROOT/'installer/ActivationProbe.cs',ROOT/'installer/SetupDiagnostics.cs'])
        manifest={'product':'PangmenToolbox','version':VERSION,'platform':arch,'files':[{'path':p.relative_to(output).as_posix(),'bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(output.rglob('*')) if p.is_file() and p.name!='build-manifest.json']}
        save(output/'build-manifest.json',manifest)
        payload=BUILD/('payload-'+VERSION+'-'+arch+'.zip')
        with zipfile.ZipFile(payload,'w',zipfile.ZIP_DEFLATED) as z:
            for p in sorted(output.rglob('*')):
                if p.is_file():z.write(p,p.relative_to(output).as_posix())
        if published.exists():
            assert published.resolve().parent==OUT.resolve() and OUT.resolve().is_relative_to(ROOT)
            shutil.rmtree(published)
        shutil.move(str(output),str(published))
        staging.rmdir()
        payloads[arch]=payload;manifests[arch]=manifest
    setup=DIST/('PangmenToolbox-Setup-'+VERSION+'.exe')
    args=common+['/platform:anycpu','/target:winexe','/out:'+str(setup),'/win32manifest:'+str(ROOT/'installer/app.manifest'),'/win32icon:'+str(SHAPE/'host/assets/pang.ico')]
    args+=['/resource:'+str(p)+',payload.'+arch+'.zip' for arch,p in payloads.items()]
    run(args+[ROOT/'installer'/name for name in ['Setup.cs','SetupDiagnostics.cs','LegacyMigration.cs','InstallFileBackup.cs']])
    save(DIST/'build-manifest.json',{'product':'PangmenToolbox','version':VERSION,'platform':'x86+x64','installer':{'name':setup.name,'bytes':setup.stat().st_size,'sha256':digest(setup)},'payloads':manifests,'baselines':json.loads((ROOT/'docs/module-sources.json').read_text(encoding='utf-8'))['baselines'],'protection':{'web':'terser + moderate javascript-obfuscator','dotnet':'Obfuscar with COM/reflection exclusions','authenticode':'not signed','license':'GPL-3.0-only'}})
    setup.with_suffix('.exe.sha256').write_text(digest(setup)+'  '+setup.name+'\n',encoding='ascii')
    print(str(setup),setup.stat().st_size,digest(setup))

if __name__=='__main__':main()

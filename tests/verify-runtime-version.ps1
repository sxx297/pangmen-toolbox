$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$manifest=Get-Content (Join-Path $root 'dist/build-manifest.json') -Raw|ConvertFrom-Json
$assembly=[Reflection.Assembly]::LoadFrom((Join-Path $root ('build/addin-'+$manifest.version+'/x64/PangmenToolbox.AddIn.dll')))
foreach($name in @('PangmenToolbox.AddIn.ToolboxRuntime')) {
 $version=$assembly.GetType($name,$true).GetField('Version',[Reflection.BindingFlags]'Static,NonPublic').GetRawConstantValue()
 if($version -ne $manifest.version){throw ($name+' version mismatch: '+$version)}
 Write-Output ($name+' '+$version)
}
if($assembly.GetName().Version.ToString() -ne ($manifest.version+'.0')){throw 'Assembly version mismatch'}
$setup=[Reflection.AssemblyName]::GetAssemblyName((Join-Path $root ('dist/'+$manifest.installer.name)))
if($setup.Version.ToString() -ne ($manifest.version+'.0')){throw 'Installer version mismatch'}
Write-Output ('Installer and compiled shared runtime match '+$manifest.version)

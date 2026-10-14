param([string]$Revision='01',[switch]$SkipVideo)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'native-animations.ps1')
$build=Join-Path $PSScriptRoot '.build'
$candidate=Join-Path $build "pangmen-native-$Revision.pptx"
$video=Join-Path $build "pangmen-native-$Revision.mp4"
if(Test-Path -LiteralPath $candidate){throw 'Use a fresh revision to retain the previous review file.'}
$app=New-Object -ComObject PowerPoint.Application
$presentation=$null
try {
 $presentation=$app.Presentations.Open((Join-Path $build 'base.pptx'),0,0,0)
 $report=Add-PangDemoAnimations -Presentation $presentation -CloudManifest (Join-Path $build 'clouds/manifest.json')
 $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $build "native-$Revision.json") -Encoding UTF8
 $presentation.SaveAs($candidate,24)
 Write-Output ('Saved native animation deck: '+$candidate)
 Write-Output ($report | ConvertTo-Json -Compress)
 if(-not $SkipVideo){
  $presentation.CreateVideo($video,$true,6,720,30,85)
  $deadline=[DateTime]::UtcNow.AddMinutes(10)
  $lastReport=[DateTime]::UtcNow
  do {
   Start-Sleep -Milliseconds 500
   $status=$presentation.CreateVideoStatus
   if(([DateTime]::UtcNow-$lastReport).TotalSeconds -gt 20){Write-Output ('PowerPoint video export status '+$status);$lastReport=[DateTime]::UtcNow}
  }while(($status -eq 1 -or $status -eq 2) -and [DateTime]::UtcNow -lt $deadline)
  if($status -ne 3){throw ('Video export failed or timed out. Status '+$status)}
  Write-Output ('PowerPoint-rendered video: '+$video)
 }
}finally{
 if($presentation){$presentation.Saved=-1;$presentation.Close()}
 [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}

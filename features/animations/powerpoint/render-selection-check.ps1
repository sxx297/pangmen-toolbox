param([string]$Revision='03')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'native-animations.ps1')
$build=Join-Path $PSScriptRoot '.build'
$app=New-Object -ComObject PowerPoint.Application;$p=$null
try {
 $p=$app.Presentations.Open((Join-Path $build "native-catalog-$Revision.pptx"),-1,0,0)
 $keep=@('spring','breathe','fade-out','typewriter','text-lines-in','text-fade-out')
 for($i=$p.Slides.Count;$i -ge 1;$i--){
  $s=$p.Slides.Item($i);$title=(Get-PangNamedShape $s 'PANG_TITLE').TextFrame.TextRange.Text
  if($title -notin $keep){$s.Delete();continue}
  foreach($e in $s.TimeLine.MainSequence){if($e.Timing.RepeatCount -gt 2){$e.Timing.RepeatCount=[single]2}}
 }
 $p.CreateVideo((Join-Path $build "selection-playback-$Revision.mp4"),$true,4,720,30,85)
 $deadline=[DateTime]::UtcNow.AddMinutes(3)
 do{Start-Sleep -Milliseconds 300;$status=$p.CreateVideoStatus}while($status -in @(1,2) -and [DateTime]::UtcNow -lt $deadline)
 Write-Output ('Video status '+$status)
}finally{if($p){$p.Saved=-1;$p.Close()};[void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)}

param([string]$Revision='02')
$ErrorActionPreference='Stop';$build=Join-Path $PSScriptRoot '.build'
$app=New-Object -ComObject PowerPoint.Application;$p=$null
try{
 $p=$app.Presentations.Open((Join-Path $build "native-catalog-$Revision.pptx"),-1,0,0)
 # Limit repeats only in this private playback check to avoid a very long export.
 foreach($slide in $p.Slides){foreach($e in $slide.TimeLine.MainSequence){if($e.Timing.RepeatCount -gt 2){$e.Timing.RepeatCount=[single]2}}}
 $p.CreateVideo((Join-Path $build "native-catalog-$Revision.mp4"),$true,4,720,30,85)
 $deadline=[DateTime]::UtcNow.AddMinutes(5)
 do{Start-Sleep -Milliseconds 300;$status=$p.CreateVideoStatus}while($status -in @(1,2) -and [DateTime]::UtcNow -lt $deadline)
 Write-Output ('Video status '+$status)
}finally{if($p){$p.Saved=-1;$p.Close()};[void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)}

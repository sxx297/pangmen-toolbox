param([string]$Revision='02')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'native-animations.ps1')
$build=Join-Path $PSScriptRoot '.build'
$app=New-Object -ComObject PowerPoint.Application
$p=$null
try {
 $p=$app.Presentations.Add(0)
 [void]$p.Slides.InsertFromFile((Join-Path $build 'base.pptx'),0,1,1)
 $p.PageSetup.SlideWidth=960;$p.PageSetup.SlideHeight=540
 $s=$p.Slides.Item(1);$target=$s.Shapes.Item('PANG_TARGET')
 Write-Output ('Target: '+$target.Left+','+$target.Top+' '+$target.Width+'x'+$target.Height)
 [void](Add-PangRecipe -Slide $s -Shape $target -Recipe anvil -Duration 1.8 -Delay .5 -SlideWidth 960 -SlideHeight 540)
 $s.SlideShowTransition.AdvanceOnTime=-1;$s.SlideShowTransition.AdvanceTime=3
 $p.SaveAs((Join-Path $build "playback-probe-$Revision.pptx"),24)
 $p.CreateVideo((Join-Path $build "playback-probe-$Revision.mp4"),$true,3,720,30,85)
 $deadline=[DateTime]::UtcNow.AddMinutes(3)
 do { Start-Sleep -Milliseconds 500; $status=$p.CreateVideoStatus } while (($status -eq 1 -or $status -eq 2) -and [DateTime]::UtcNow -lt $deadline)
 Write-Output ('Video status: '+$status)
 if($status -ne 3){throw 'PowerPoint video export failed or timed out.'}
}finally {if($p){$p.Saved=-1;$p.Close()};[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)}

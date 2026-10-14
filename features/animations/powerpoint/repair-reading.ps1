param([string]$SourceRevision='02',[string]$Revision='03')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'native-animations.ps1')
$build=Join-Path $PSScriptRoot '.build'
$source=Join-Path $build "pangmen-native-$SourceRevision.pptx"
$candidate=Join-Path $build "pangmen-native-$Revision.pptx"
$video=Join-Path $build "pangmen-native-$Revision.mp4"
if(Test-Path -LiteralPath $candidate){throw 'Use a fresh revision.'}
$app=New-Object -ComObject PowerPoint.Application
$presentation=$null
try {
 $presentation=$app.Presentations.Open($source,0,0,0)
 if($presentation.Tags.Item('PANG_NATIVE_DEMO') -ne '1'){throw 'This repair only accepts our generated demonstration.'}
 $slide=$presentation.Slides.Item(11)
 $sequence=$slide.TimeLine.MainSequence
 for($i=$sequence.Count;$i -ge 1;$i--){$sequence.Item($i).Delete()}
 Add-PangReadingDemo -Slide $slide
 $presentation.SaveAs($candidate,24)
 Write-Output ('Saved repaired demonstration: '+$candidate)
 $presentation.CreateVideo($video,$true,6,720,30,85)
 $deadline=[DateTime]::UtcNow.AddMinutes(10)
 do {
  Start-Sleep -Milliseconds 500
  $status=$presentation.CreateVideoStatus
 }while(($status -eq 1 -or $status -eq 2) -and [DateTime]::UtcNow -lt $deadline)
 if($status -ne 3){throw ('Video export failed. Status '+$status)}
 Write-Output ('PowerPoint-rendered video: '+$video)
}finally{
 if($presentation){$presentation.Saved=-1;$presentation.Close()}
 [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}

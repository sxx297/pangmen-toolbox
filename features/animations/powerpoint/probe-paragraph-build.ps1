$ErrorActionPreference='Stop'
$app=New-Object -ComObject PowerPoint.Application
$p=$null
try {
 $p=$app.Presentations.Add(0)
 [void]$p.Slides.InsertFromFile((Join-Path $PSScriptRoot '.build/base.pptx'),0,1,1)
 $s=$p.Slides.Item(1)
 $b=$s.Shapes.AddTextbox(1,10,10,300,200)
 $b.TextFrame.TextRange.Text="One`rTwo`rThree"
 $seq=$s.TimeLine.MainSequence
 $e=$seq.AddEffect($b,1,1,2)
 Write-Output ('Level1 count '+$seq.Count)
 for($i=1;$i -le $seq.Count;$i++){ $x=$seq.Item($i);Write-Output ('effect '+$i+' para '+$x.Paragraph);$x.Timing.TriggerDelayTime=[single]($i*.5) }
 $e=$seq.AddEffect($b,1,1,2);$e.Exit=-1
 Write-Output ('Exit count '+$seq.Count)
 $p.SaveAs((Join-Path $PSScriptRoot '.build/paragraph-build.pptx'),24)
} finally {if($p){$p.Saved=-1;$p.Close()};[void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)}

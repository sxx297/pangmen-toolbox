param()
$ErrorActionPreference='Stop'
$build=Join-Path $PSScriptRoot '.build'
$app=New-Object -ComObject PowerPoint.Application
$p=$null
try {
 $p=$app.Presentations.Open((Join-Path $build 'textbox-cloud-08-source.pptx'),0,0,0)
 $p.SaveAs((Join-Path $build 'textbox-cloud-09-source.pptx'),24)
 Write-Output ('Shapes '+$p.Slides.Item(1).Shapes.Count)
} finally {if($p){$p.Saved=-1;$p.Close()};[void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)}

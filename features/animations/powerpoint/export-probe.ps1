param([string]$Name='textbox-cloud-03-source')
$ErrorActionPreference='Stop';$build=Join-Path $PSScriptRoot '.build'
$app=New-Object -ComObject PowerPoint.Application;$p=$null
try{
 $p=$app.Presentations.Open((Join-Path $build ($Name+'.pptx')),0,0,0)
 Write-Output 'Opened probe.'
 $p.Slides.Item(1).Export((Join-Path $build ($Name+'-edit.png')),'PNG',1280,720)
 Write-Output 'Exported editing view.'
 $p.CreateVideo((Join-Path $build ($Name+'.mp4')),$true,4,720,30,85)
 $deadline=[DateTime]::UtcNow.AddMinutes(3)
 do{Start-Sleep -Milliseconds 300;$status=$p.CreateVideoStatus}while($status -in @(1,2) -and [DateTime]::UtcNow -lt $deadline)
 Write-Output ('Video status '+$status)
}finally{if($p){$p.Saved=-1;$p.Close()};[void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)}

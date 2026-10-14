param([string]$Source='01',[string]$Revision='02',[double]$FontSize=540,[double]$Top=0,[double]$Left=0)
$ErrorActionPreference='Stop'
$build=Join-Path $PSScriptRoot '.build'
$output=Join-Path $build "textbox-cloud-$Revision.pptx"
if(Test-Path -LiteralPath $output){throw 'Use fresh revision.'}
$app=New-Object -ComObject PowerPoint.Application;$p=$null
try{
 $p=$app.Presentations.Open((Join-Path $build "textbox-cloud-$Source.pptx"),0,0,0)
 $s=$p.Slides.Item(1)
 $s.FollowMasterBackground=0;$s.Background.Fill.Solid();$s.Background.Fill.ForeColor.RGB=0x212325
 $box=$s.Shapes.Item('PANG_CLOUD_TEXT_CONTAINER')
 $box.Fill.Visible=0;$box.Line.Visible=0
 $box.TextFrame.TextRange.Font.Size=[single]$FontSize
 $box.Top=[single]$Top;$box.Left=[single]$Left
 $p.SaveAs($output,24)
 $s.Export((Join-Path $build "textbox-cloud-$Revision-edit.png"),'PNG',1280,720)
 $p.CreateVideo((Join-Path $build "textbox-cloud-$Revision.mp4"),$true,4,720,30,85)
 do{Start-Sleep -Milliseconds 300;$status=$p.CreateVideoStatus}while($status -in @(1,2))
 Write-Output ([pscustomobject]@{VideoStatus=$status;Left=$box.Left;Top=$box.Top;Width=$box.Width;Height=$box.Height;TextBoundLeft=$box.TextFrame.TextRange.BoundLeft;TextBoundTop=$box.TextFrame.TextRange.BoundTop;TextBoundWidth=$box.TextFrame.TextRange.BoundWidth;TextBoundHeight=$box.TextFrame.TextRange.BoundHeight} | ConvertTo-Json -Compress)
}finally{if($p){$p.Saved=-1;$p.Close()};[void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)}

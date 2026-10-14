param([string]$Revision='01',[double]$FontSize=540,[double]$Top=0,[double]$Left=0)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'native-animations.ps1')
$build=Join-Path $PSScriptRoot '.build'
$output=Join-Path $build "textbox-cloud-$Revision.pptx"
if(Test-Path -LiteralPath $output){throw 'Use a fresh probe revision.'}
$app=New-Object -ComObject PowerPoint.Application
$p=$null
try {
 $p=$app.Presentations.Add(0)
 $p.PageSetup.SlideWidth=960;$p.PageSetup.SlideHeight=540
 [void]$p.Slides.InsertFromFile((Join-Path $build 'base.pptx'),0,1,1)
 $slide=$p.Slides.Item(1)
 $box=$slide.Shapes.AddTextbox(1,[single]$Left,[single]$Top,960,540)
 $box.Name='PANG_CLOUD_TEXT_CONTAINER'
 $box.TextFrame.AutoSize=0;$box.TextFrame.WordWrap=0
 $box.TextFrame.MarginLeft=0;$box.TextFrame.MarginRight=0
 $box.TextFrame.MarginTop=0;$box.TextFrame.MarginBottom=0
 $box.TextFrame.VerticalAnchor=1
 $box.TextFrame.TextRange.Text=(@([string][char]160)*48) -join "`r"
 $range=$box.TextFrame.TextRange
 $range.Font.Name='Arial';$range.Font.Size=[single]$FontSize
 $range.ParagraphFormat.LineRuleWithin=0;$range.ParagraphFormat.SpaceWithin=0
 $range.ParagraphFormat.LineRuleBefore=0;$range.ParagraphFormat.SpaceBefore=0
 $range.ParagraphFormat.LineRuleAfter=0;$range.ParagraphFormat.SpaceAfter=0
 $box.TextFrame.Ruler.Levels.Item(1).FirstMargin=0
 $box.TextFrame.Ruler.Levels.Item(1).LeftMargin=0
 for($i=0;$i -lt 48;$i++){
  $para=$range.Paragraphs($i+1,1)
  $para.IndentLevel=1
  $para.ParagraphFormat.Bullet.Type=3
  $para.ParagraphFormat.Bullet.Picture((Join-Path $build ('clouds/cloud-'+$i.ToString('000')+'.png')))
  $para.ParagraphFormat.Bullet.RelativeSize=1
  $effect=New-PangEffect -Slide $slide -Shape $box -EffectId 1 -Duration .001 -Delay (.7+$i/30.0)
  $effect.Paragraph=$i+1
  $exitEffect=New-PangEffect -Slide $slide -Shape $box -EffectId 1 -Duration .001 -Delay (.7+($i+1)/30.0) -Exit
  $exitEffect.Paragraph=$i+1
 }
 $target=Get-PangNamedShape -Slide $slide -Name 'PANG_TARGET'
 [void](Add-PangRecipe -Slide $slide -Shape $target -Recipe anvil -Duration 1.8 -Delay .5)
 $slide.SlideShowTransition.AdvanceOnClick=0
 $slide.SlideShowTransition.AdvanceOnTime=-1
 $slide.SlideShowTransition.AdvanceTime=4
 $p.SaveAs($output,24)
 $slide.Export((Join-Path $build "textbox-cloud-$Revision-edit.png"),'PNG',1280,720)
 Write-Output ([pscustomobject]@{Shapes=$slide.Shapes.Count;Paragraphs=$range.Paragraphs().Count;Effects=$slide.TimeLine.MainSequence.Count;LineSpacing=$range.ParagraphFormat.SpaceWithin;Font=$FontSize} | ConvertTo-Json -Compress)
 $video=Join-Path $build "textbox-cloud-$Revision.mp4"
 $p.CreateVideo($video,$true,4,720,30,85)
 $deadline=[DateTime]::UtcNow.AddMinutes(3)
 do{Start-Sleep -Milliseconds 300;$status=$p.CreateVideoStatus}while(($status -eq 1 -or $status -eq 2) -and [DateTime]::UtcNow -lt $deadline)
 if($status -ne 3){throw "Video failure $status"}
 Write-Output $video
}finally{
 if($p){$p.Saved=-1;$p.Close()}
 [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}

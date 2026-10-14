# Prototype adapter. Kept separate from the installed add-in pending visual review.
. (Join-Path $PSScriptRoot 'native-animations.ps1')
if (-not ('Pangmen.Motion.NumericFrameRenderer' -as [type])) {
 Add-Type -Path (Join-Path $PSScriptRoot 'NumericFrameRenderer.cs') -ReferencedAssemblies System.Drawing,System.Core
}
function Add-PangNumericStudy {
 param($Slide,$Shape,[string]$Folder,[bool]$Roll=$true,[double]$Duration=1.6,[double]$Delay=.5)
 $r=$Shape.TextFrame.TextRange;$text=[string]$r.Text
 $fontName=[string]$r.Font.Name;$fontSize=[single]$r.Font.Size;$fontBold=[int]$r.Font.Bold;$fontItalic=[int]$r.Font.Italic;$fontColor=[int]$r.Font.Color.RGB
 $numeric=$text-replace '[^0-9.\-]','';$value=[double]::Parse($numeric,[Globalization.CultureInfo]::InvariantCulture)
 $decimals=if($numeric.Contains('.')){$numeric.Split('.')[1].Length}else{0}
 [single[]]$centers=for($i=1;$i -le $text.Length;$i++){$c=$r.Characters($i,1);[single]($c.BoundLeft+$c.BoundWidth/2)}
 $style=0;if($r.Font.Bold -eq -1){$style=$style-bor 1};if($r.Font.Italic -eq -1){$style=$style-bor 2}
 [void][IO.Directory]::CreateDirectory($Folder)
 $chars=-join ([char[]]('0123456789'+$text)|Select-Object -Unique)
 $atlasBox=$Slide.Shapes.AddTextbox(1,100,100,2400,200);$atlasBox.TextFrame.AutoSize=0;$atlasBox.TextFrame.WordWrap=0
 $atlasBox.TextFrame.MarginTop=0;$atlasBox.TextFrame.MarginLeft=0;$atlasBox.TextFrame.MarginBottom=0;$atlasBox.TextFrame.MarginRight=0
 $ar=$atlasBox.TextFrame.TextRange;$ar.Text=([char[]]$chars)-join '   '
 $ar.Font.Name=$fontName;$ar.Font.Size=[double]$fontSize;$ar.Font.Bold=$fontBold;$ar.Font.Italic=$fontItalic;$ar.Font.Color.RGB=$fontColor
 [single[]]$al=for($i=0;$i -lt $chars.Length;$i++){$ar.Characters(1+4*$i,1).BoundLeft}
 [single[]]$aw=for($i=0;$i -lt $chars.Length;$i++){$ar.Characters(1+4*$i,1).BoundWidth}
 $at=$ar.BoundTop;$ah=$ar.BoundHeight;$right=$ar.BoundLeft+$ar.BoundWidth+10;$bottom=$at+$ah+10
 $atlasBox.Width=$ar.BoundWidth+5;$atlasBox.Height=$ah+5
 $m1=$Slide.Shapes.AddShape(1,90,90,2,2);$m2=$Slide.Shapes.AddShape(1,$right,$bottom,2,2)
 foreach($marker in @($m1,$m2)){$marker.Line.Visible=0;$marker.Fill.Solid();$marker.Fill.ForeColor.RGB=0xFF00FF}
 $group=$Slide.Shapes.Range(@($atlasBox.Name,$m1.Name,$m2.Name)).Group()
 $atlasPath=Join-Path $Folder 'atlas.png'
 $group.Export($atlasPath,2,($Slide.Parent.PageSetup.SlideWidth*1.5),($Slide.Parent.PageSetup.SlideHeight*1.5),1)
 $group.Delete()
 $atlas=[Pangmen.Motion.NumericFrameRenderer]::ReadAtlas($atlasPath,$chars,$al,$aw,$at,$ah,90,90,($right+2-90),($bottom+2-90),$r.Font.Size)
 try{$data=[Pangmen.Motion.NumericFrameRenderer]::Render($Folder,$text,$value,$decimals,$r.Font.Name,$r.Font.Size,$style,$r.Font.Color.RGB,$r.BoundLeft,$r.BoundTop,$r.BoundWidth,$centers,$Duration,$Roll,60,$atlas)}finally{$atlas.Dispose()}
 $slideWidth=[double]$Slide.Parent.PageSetup.SlideWidth
 $b=$Slide.Shapes.AddTextbox(1,($data.Left-2*$slideWidth),($data.Top+$data.Height-1),([Math]::Max(300,$data.Width+150)),($data.Height+50))
 $b.Name='PANG_NUMERIC_FRAMES';$b.Fill.Visible=0;$b.Line.Visible=0
 $b.TextFrame.AutoSize=0;$b.TextFrame.WordWrap=0
 $b.TextFrame.MarginTop=0;$b.TextFrame.MarginLeft=0;$b.TextFrame.MarginRight=0;$b.TextFrame.MarginBottom=0
 $b.TextFrame.TextRange.Text=(@(' ')*$data.Frames)-join "`r"
 $b.TextFrame.TextRange.Font.Name='Arial';$b.TextFrame.TextRange.Font.Size=[single]($data.Height/.7)
 $pf=$b.TextFrame.TextRange.ParagraphFormat
 $pf.LineRuleWithin=0;$pf.SpaceWithin=0;$pf.LineRuleBefore=0;$pf.SpaceBefore=0;$pf.LineRuleAfter=0;$pf.SpaceAfter=0
 $b.TextFrame.Ruler.Levels.Item(1).FirstMargin=0;$b.TextFrame.Ruler.Levels.Item(1).LeftMargin=0
 for($i=0;$i -lt $data.Frames;$i++){
  $p=$b.TextFrame.TextRange.Paragraphs($i+1,1)
  $p.ParagraphFormat.Bullet.Picture($data.Files[$i]);$p.ParagraphFormat.Bullet.RelativeSize=1
 }
 $seq=$Slide.TimeLine.MainSequence
 # A final entrance keeps the original target hidden until the handoff.
 foreach($exit in @($false,$true)){
  $before=$seq.Count;[void]$seq.AddEffect($b,1,2,2)
  if($seq.Count-$before -ne $data.Frames){throw 'Incomplete frame paragraphs'}
  for($i=0;$i -lt $data.Frames;$i++){
   $e=$seq.Item($before+$i+1)
   if($exit){$e.Exit=-1;$e=$seq.Item($before+$i+1)}
   $e.Timing.Duration=[single].001;$e.Timing.TriggerType=2
   $time=$Delay+($i+[int]$exit)/$data.Frames*$Duration
   $e.Timing.TriggerDelayTime=[single][Math]::Max([double]0,[double]$time)
   if(-not $exit){[void](Add-PangPropertyTrack -Effect $e -PropertyId 1 -Frames @(@{t=0;v='#ppt_x+2'},@{t=1;v='#ppt_x+2'}))}
  }
 }
 [void](New-PangEffect -Slide $Slide -Shape $Shape -EffectId 1 -Duration .001 -Delay ($Delay+$Duration))
 return $data
}

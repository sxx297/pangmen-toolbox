# Both numeric effects preserve the source text. Only a transparent local helper is added.
function Get-PangNumberSpec {
 param($Shape)
 if($Shape.HasTextFrame -ne -1 -or $Shape.TextFrame.HasText -ne -1){throw '请选择数字文本框。'}
 $r=$Shape.TextFrame.TextRange;$text=[string]$r.Text
 if($text -notmatch '^(?<prefix>[^\d\r\n+\-−]*)(?<sign>[+\-−]?)(?<digits>[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?<fraction>\.[0-9]+)?(?<suffix>[^\d\r\n]*)$'){throw '请选择只包含一个数值的文本框。'}
 $m=@{};foreach($k in $matches.Keys){$m[$k]=$matches[$k]}
 $digits=$m.digits-replace ',','';$dec=([string]$m.fraction).Length;if($dec){$dec--}
 $value=0.
 if(-not [double]::TryParse(($m.sign-replace '−','-')+$digits+$m.fraction,[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture,[ref]$value) -or [double]::IsInfinity($value) -or [Math]::Abs($value) -gt 999999999){throw '数值超出范围：最多支持 9 位整数，绝对值不能超过 999,999,999。请缩小数值或改用“万 / 亿”等单位。'}
 if($dec -gt 6){throw '小数位过多：最多支持 6 位小数，请减少小数位后重试。'}
 if($text.Length -gt 40){throw '文本过长：数字、符号和单位合计最多 40 个字符，请缩短文本后重试。'}
 if($r.Font.Size -le 0 -or -not $r.Font.Name -or $r.Font.Bold -eq -2 -or $r.Font.Italic -eq -2 -or $r.Font.Color.Type -eq -2){throw '请先统一数字文本框的字体、字号与文字颜色。'}
 # PowerPoint does not reliably return the mixed (-2) sentinel for an entire
 # range. Inspect every character so a partially formatted number cannot build
 # an atlas from one font and then misalign the other characters.
 $firstFont=$r.Characters(1,1).Font
 for($i=2;$i -le $text.Length;$i++){
  $font=$r.Characters($i,1).Font
  if([string]$font.Name -ne [string]$firstFont.Name -or [Math]::Abs([double]$font.Size-[double]$firstFont.Size) -gt .01 -or
     [int]$font.Bold -ne [int]$firstFont.Bold -or [int]$font.Italic -ne [int]$firstFont.Italic -or
     [int]$font.Color.Type -ne [int]$firstFont.Color.Type -or [int]$font.Color.RGB -ne [int]$firstFont.Color.RGB){
   throw '请先统一数字文本框的字体、字号与文字颜色。'
  }
 }
 if($r.Font.Size -gt 180 -or $r.BoundWidth -gt 1400 -or $r.Lines().Count -ne 1){throw '数值动画支持单行文本，字号不超过 180 磅。'}
 if($Shape.Fill.Visible -ne 0 -or $Shape.Line.Visible -ne 0 -or $Shape.Rotation -ne 0){throw '请选择未旋转、无填充和边框的数字文本框。'}
 return @{text=$text;value=$value;decimals=$dec;prefix=$m.prefix;suffix=$m.suffix;sign=$m.sign;grouping=$m.digits.Contains(',');minDigits=$(if($digits.StartsWith('0')){$digits.Length}else{1})}
}
function Close-PangTemporaryPresentation {
 param($Presentation)
 # PowerPoint can reject automation briefly while it is rendering a preview or
 # processing another add-in. Give private, hidden documents enough time to
 # close without turning that transient Office state into an apply failure.
 for($retry=0;$retry -lt 60;$retry++){
  try{
   $Presentation.Saved=-1
   $Presentation.Close()
   return
  }catch{
   if(-not (Test-PangCallRejected $_.Exception) -or $retry -eq 59){throw}
   Start-Sleep -Milliseconds 100
  }
 }
}
function Test-PangCallRejected {
 param($Exception)
 for($current=$Exception;$null-ne$current;$current=$current.InnerException){
  if($current.HResult -eq -2147418111){return $true}
 }
 return $false
}
function Add-PangNumberAnimation {
 param($Slide,$Shape,$Plan,[int]$Trigger=2,[double]$Delay=0)
 $spec=Get-PangNumberSpec $Shape
 $sourceName=[string]$Shape.Name
 if(-not ('Pangmen.Motion.NumericFrameRenderer' -as [type])){Add-Type -Path (Join-Path $PSScriptRoot 'NumericFrameRenderer.cs') -ReferencedAssemblies System.Drawing,System.Core}
 if(-not ('Pangmen.Motion.NumericTimeline' -as [type])){Add-Type -Path (Join-Path $PSScriptRoot 'NumericTimeline.cs') -ReferencedAssemblies Microsoft.CSharp,System.Core,System.Xml,System.Xml.Linq,System.IO.Compression,System.IO.Compression.FileSystem}
 $duration=[double]$Plan.duration;$roll=$Plan.id -eq 'number-roll'
 $owner=Get-PangOwner $Shape;$oldHelpers=@();$sequence=$Slide.TimeLine.MainSequence
 for($i=1;$i -le $Slide.Shapes.Count;$i++){$candidate=$Slide.Shapes.Item($i);if($candidate.Tags.Item('PANG_OWNER') -eq $owner -and $candidate.Tags.Item('PANG_HELPER') -eq 'number'){$oldHelpers+=,$candidate}}
 $oldSourceEffects=@();$oldIds=@($oldHelpers|ForEach-Object {$_.Id})
 for($i=1;$i -le $sequence.Count;$i++){
  $effect=$sequence.Item($i)
  if($effect.Shape.Id -ne $Shape.Id -or $effect.EffectType -ne 1){continue}
  if(($effect.Exit -eq -1 -and $i -lt $sequence.Count -and $sequence.Item($i+1).Shape.Id -in $oldIds) -or
     ($effect.Exit -ne -1 -and $i -gt 1 -and $sequence.Item($i-1).Shape.Id -in $oldIds)){$oldSourceEffects+=,$effect}
 }
 $folder=Join-Path ([IO.Path]::GetTempPath()) ('PangmenAnimation-number-'+[guid]::NewGuid().ToString('N'))
 [void][IO.Directory]::CreateDirectory($folder)
 $atlas=$null;$template=$null;$sourceReveal=$null;$b=$null
 try {
  $r=$Shape.TextFrame.TextRange;$text=$spec.text
  $fontName=[string]$r.Font.Name;$fontSize=[single]$r.Font.Size;$fontBold=[int]$r.Font.Bold;$fontItalic=[int]$r.Font.Italic;$fontColor=[int]$r.Font.Color.RGB
  [single[]]$centers=for($i=1;$i -le $text.Length;$i++){$c=$r.Characters($i,1);[single]($c.BoundLeft+$c.BoundWidth/2)}
  $style=0;if($fontBold -eq -1){$style=$style-bor 1};if($fontItalic -eq -1){$style=$style-bor 2}
  $chars=-join ([char[]]('0123456789'+$text)|Select-Object -Unique)
  # Duplicate the source so PowerPoint renders the actual text fill. Rebuilding
  # a textbox from Font.Color.RGB flattens gradient text and may export opaque
  # rectangular color samples instead of glyph-shaped alpha.
  $atlasBox=$Shape.Duplicate().Item(1);$atlasBox.Name='PANG_NUMERIC_ATLAS_'+[guid]::NewGuid().ToString('N')
  $atlasBox.Left=100;$atlasBox.Top=100;$atlasBox.Width=4000;$atlasBox.Height=[Math]::Max(250,$Shape.Height)
  $atlasBox.TextFrame.AutoSize=0;$atlasBox.TextFrame.WordWrap=0;$atlasBox.TextFrame.VerticalAnchor=1
  $atlasBox.TextFrame.MarginTop=0;$atlasBox.TextFrame.MarginLeft=0;$atlasBox.TextFrame.MarginBottom=0;$atlasBox.TextFrame.MarginRight=0
  $ar=$atlasBox.TextFrame.TextRange;$ar.Text=([char[]]$chars)-join ' ';$ar.ParagraphFormat.Alignment=1
  [single[]]$al=for($i=0;$i -lt $chars.Length;$i++){$ar.Characters(1+2*$i,1).BoundLeft}
  [single[]]$aw=for($i=0;$i -lt $chars.Length;$i++){$ar.Characters(1+2*$i,1).BoundWidth}
  $at=$ar.BoundTop;$ah=$ar.BoundHeight;$right=$ar.BoundLeft+$ar.BoundWidth+10;$bottom=$at+$ah+10
  $atlasBox.Width=[single]($ar.BoundWidth+5);$atlasBox.Height=[single]($ah+5)
  $m1=$Slide.Shapes.AddShape(1,90,90,2,2);$m2=$Slide.Shapes.AddShape(1,$right,$bottom,2,2)
  foreach($marker in @($m1,$m2)){$marker.Line.Visible=0;$marker.Fill.Solid();$marker.Fill.ForeColor.RGB=0xFF00FF}
  $group=$Slide.Shapes.Range(@($atlasBox.Name,$m1.Name,$m2.Name)).Group()
  $atlasPath=Join-Path $folder 'atlas.png'
  $group.Export($atlasPath,2,($Slide.Parent.PageSetup.SlideWidth*1.5),($Slide.Parent.PageSetup.SlideHeight*1.5),1);$group.Delete()
  # Grouping and deleting a duplicate can invalidate other Shape RCWs on the
  # same slide. Reacquire the editable source before reading the final name.
  $Shape=$Slide.Shapes.Item($sourceName)
  $atlas=[Pangmen.Motion.NumericFrameRenderer]::ReadAtlas($atlasPath,$chars,$al,$aw,$at,$ah,90,90,($right+2-90),($bottom+2-90),$fontSize)
  $data=[Pangmen.Motion.NumericFrameRenderer]::Render($folder,$text,$spec.value,$spec.decimals,$fontName,$fontSize,$style,$fontColor,$r.BoundLeft,$r.BoundTop,$r.BoundWidth,$centers,$duration,$roll,60,$atlas)
  $name=$(if($roll){'旁门数值滚动 · '}else{'旁门数值变动 · '})+$Shape.Name
  # Build only our helper in a private one-slide document. If Office is busy,
  # discard the entire private document before retrying so a partial COM loop
  # can never duplicate frame paragraphs or effects.
  for($retry=0;$retry-lt20;$retry++){
   try{
    $template=$Slide.Application.Presentations.Add(0)
    $template.PageSetup.SlideWidth=$Slide.Parent.PageSetup.SlideWidth;$template.PageSetup.SlideHeight=$Slide.Parent.PageSetup.SlideHeight
    $tempSlide=$template.Slides.Add(1,12)
    [void][Pangmen.Motion.NumericTimeline]::Create($tempSlide,$data.Files,$data.Left,$data.Top,$data.Width,$data.Height,$owner,$name,$Delay,$duration)
    break
   }catch{
    $failure=$_.Exception
    if($template){try{Close-PangTemporaryPresentation $template}catch{};$template=$null}
    if(-not (Test-PangCallRejected $failure) -or $retry-eq19){throw}
    Start-Sleep -Milliseconds 100
   }
  }
  $raw=Join-Path $folder 'raw.pptx';$compact=Join-Path $folder 'compact.pptx'
  $template.SaveAs($raw,24);Close-PangTemporaryPresentation $template;$template=$null
  [Pangmen.Motion.NumericTimeline]::Compact($raw,$compact)
  $template=$Slide.Application.Presentations.Open($compact,-1,0,0)
  # PowerPoint can reject a new effect immediately after a pasted composite
  # timeline. Create the source entrance before the paste, then move the helper
  # ahead of it so the source stays hidden until the final handoff.
  $sourceReveal=New-PangEffect -Slide $Slide -Shape $Shape -EffectId 1 -Duration .001 -Trigger $Trigger -Delay ($Delay+$duration)
  $before=$sequence.Count;$b=Copy-PangShapeToSlide -Source $template.Slides.Item(1).Shapes.Item(1) -Slide $Slide
  if($sequence.Count-$before -ne 1){throw '数字复合时序未完整复制。'}
  # The helper owns the selected trigger. The source has only a final entrance,
  # which keeps the editable value hidden before the first helper frame appears.
  $helperEffect=$sequence.Item($before+1);$helperEffect.MoveTo($before)
  $helperEffect=$sequence.Item($before);$sourceReveal=$sequence.Item($before+1)
  $helperEffect.Timing.TriggerType=$Trigger;$sourceReveal.Timing.TriggerType=2
  # PowerPoint may offset pasted shapes by 12 pt, even across private presentations.
  $b.Left=[single]($data.Left-2*$Slide.Parent.PageSetup.SlideWidth);$b.Top=[single]($data.Top+$data.Height-1)
  if($b.TextFrame.TextRange.Paragraphs().Count -ne $data.Frames){throw '数字帧段落在复制时丢失。'}
  Close-PangTemporaryPresentation $template;$template=$null
  # Decode embedded textures before first playback; temporary files are no longer needed afterwards.
  [Pangmen.Motion.NumericTimeline]::Warm($b,$Slide,(Join-Path $folder 'warm.png'))
  foreach($old in $oldSourceEffects){$old.Delete()}
  foreach($old in $oldHelpers){$old.Delete()}
  return ,@{effects=@($helperEffect,$sourceReveal);helpers=@($b)}
 } catch {
  # The old animation remains in place until every new resource is valid.
  if($b){try{$b.Delete()}catch{}}
  if($sourceReveal){try{$sourceReveal.Delete()}catch{}}
  throw
 } finally {
  if($template){try{Close-PangTemporaryPresentation $template}catch{}}
  if($atlas){$atlas.Dispose()}
  # This GUID directory contains only files generated by this invocation.
  foreach($file in [IO.Directory]::GetFiles($folder)){[IO.File]::Delete($file)}
  [IO.Directory]::Delete($folder)
 }
}

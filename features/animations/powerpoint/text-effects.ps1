# Bitmap character helpers and line highlights. Original text remains editable and untouched.
function Assert-PangTextGeometry {
 param($Shape)
 if($Shape.HasTextFrame -ne -1 -or $Shape.TextFrame.HasText -ne -1){throw '请选择有文字的文本框。'}
 if($Shape.Rotation -ne 0 -or $Shape.TextFrame.Orientation -ne 1){throw '此动画支持未旋转的横排文本框。'}
 if($Shape.Fill.Visible -ne 0 -or $Shape.Line.Visible -ne 0){throw '此动画请选择无填充、无边框的文本框。'}
 $r=$Shape.TextFrame.TextRange
 if($r.Length -gt 160){throw '逐字动画最多支持 160 个文字字符，请拆分文本框后重试。'}
 for($i=1;$i -le $r.Paragraphs().Count;$i++){if($r.Paragraphs($i,1).ParagraphFormat.Bullet.Visible -ne 0){throw '此动画暂不支持项目符号，请使用普通文本框。'}}
}
function Add-PangHighlight {
 param($Slide,$Shape,$Plan,[int]$Trigger,[double]$Delay)
 Assert-PangTextGeometry $Shape
 $hex=[string]$Plan.markColor;if($hex -notmatch '^#[0-9a-fA-F]{6}$'){$hex='#ffe066'}
 $rgb=[Convert]::ToInt32($hex.Substring(1,2),16)+256*[Convert]::ToInt32($hex.Substring(3,2),16)+65536*[Convert]::ToInt32($hex.Substring(5,2),16)
 $range=$Shape.TextFrame.TextRange;$owner=Get-PangOwner $Shape;$first=$true
 for($i=1;$i -le $range.Lines().Count;$i++){
  $line=$range.Lines($i,1);if([string]::IsNullOrWhiteSpace($line.Text)){continue}
  $box=$Slide.Shapes.AddShape(1,[single]($line.BoundLeft-1),[single]($line.BoundTop+$line.BoundHeight*.15),[single]($line.BoundWidth+2),[single]($line.BoundHeight*.8))
  $box.Name='旁门荧光标记 · '+$Shape.Name;$box.Fill.ForeColor.RGB=$rgb;$box.Fill.Transparency=[single].72;$box.Line.Visible=0
  $box.Tags.Add('PANG_OWNER',$owner);$box.Tags.Add('PANG_HELPER','highlight')
  while($box.ZOrderPosition -gt $Shape.ZOrderPosition){$box.ZOrder(3)}
  $triggerType=2;if($first){$triggerType=$Trigger;$first=$false}
  $e=New-PangEffect -Slide $Slide -Shape $box -EffectId 22 -Duration $Plan.duration -Delay $Delay -Trigger $triggerType
  $e.EffectParameters.Direction=4
 }
}
function Add-PangCharacterAnimation {
 param($Slide,$Shape,$Plan,[int]$Trigger,[double]$Delay)
 Assert-PangTextGeometry $Shape
 $r=$Shape.TextFrame.TextRange;$text=[string]$r.Text;$items=New-Object Collections.ArrayList
 $enumerator=[Globalization.StringInfo]::GetTextElementEnumerator($text)
 while($enumerator.MoveNext()){
  $value=$enumerator.GetTextElement();if([string]::IsNullOrWhiteSpace($value)){continue}
  $offset=$enumerator.ElementIndex;$range=$r.Characters($offset+1,$value.Length)
  [void]$items.Add(@{offset=$offset;length=$value.Length;left=[double]$range.BoundLeft;top=[double]$range.BoundTop;width=[double]$range.BoundWidth;height=[double]$range.BoundHeight})
 }
 if(-not $items.Count){throw '文本框没有可播放的文字。'}
 if($items.Count -gt 80){throw '此逐字动画最多支持 80 个可见字符，请拆分文本框后重试。'}
 $sw=[double]$Slide.Parent.PageSetup.SlideWidth;$sh=[double]$Slide.Parent.PageSetup.SlideHeight;$owner=Get-PangOwner $Shape
 $gap=[double]$Plan.stagger;if($Plan.id -eq 'text-tracking'){$gap=0}
 $base=[double]$Plan.duration;$total=$base+($items.Count-1)*$gap;$a=[double]$Plan.intensity;$scatter=$Plan.id -eq 'text-scatter'
 $folder=Join-Path ([IO.Path]::GetTempPath()) ('pang-text-'+[guid]::NewGuid().ToString('N'));[void][IO.Directory]::CreateDirectory($folder)
 $group=$null
 try{
  if(-not ('Pangmen.Motion.NumericFrameRenderer' -as [type])){Add-Type -Path (Join-Path $PSScriptRoot 'NumericFrameRenderer.cs') -ReferencedAssemblies System.Drawing,System.Core}
  $name=$Shape.Name;$copy=$Shape.Duplicate().Item(1);$copy.Left=$Shape.Left;$copy.Top=$Shape.Top
  foreach($old in @(Get-PangShapeMainEffects $Slide $copy)){$old.Delete()}
  $left=[double]$r.BoundLeft-8;$top=[double]$r.BoundTop-8;$right=[double]$r.BoundLeft+$r.BoundWidth+8;$bottom=[double]$r.BoundTop+$r.BoundHeight+8
  $m1=$Slide.Shapes.AddShape(1,$left,$top,2,2);$m2=$Slide.Shapes.AddShape(1,$right,$bottom,2,2)
  foreach($marker in @($m1,$m2)){$marker.Line.Visible=0;$marker.Fill.Solid();$marker.Fill.ForeColor.RGB=0xFF00FF}
  $group=$Slide.Shapes.Range(@($copy.Name,$m1.Name,$m2.Name)).Group();$atlas=Join-Path $folder 'atlas.png'
  $group.Export($atlas,2,[int]($sw*3),[int]($sh*3),1);$group.Delete();$group=$null;$Shape=$Slide.Shapes.Item($name)
  [Pangmen.Motion.NumericFrameRenderer]::CropCharacters($atlas,$folder,[single[]]@($items|ForEach-Object {$_.left-.35}),[single[]]@($items|ForEach-Object {$_.top-.35}),[single[]]@($items|ForEach-Object {$_.width+.7}),[single[]]@($items|ForEach-Object {$_.height+.7}),[single]$left,[single]$top,[single]($right+2-$left),[single]($bottom+2-$top))
 if($scatter){[void](New-PangEffect -Slide $Slide -Shape $Shape -EffectId 1 -Duration .001 -Delay $Delay -Trigger $Trigger -Exit)}
 for($j=0;$j -lt $items.Count;$j++){
  $item=$items[$j]
  $b=$Slide.Shapes.AddPicture((Join-Path $folder ($j.ToString()+'.png')),0,-1,[single]($item.left-.35),[single]($item.top-.35),[single]($item.width+.7),[single]($item.height+.7))
  $b.Name='旁门逐字 · '+$Shape.Name+' · '+($j+1);$b.Tags.Add('PANG_OWNER',$owner);$b.Tags.Add('PANG_HELPER','character')
  # Park helpers outside the editing canvas; animation coordinates bring them back.
  $park=$sw+1000;$b.Left=[single]($b.Left+$park)
  $times=New-Object 'Collections.Generic.SortedSet[double]';[void]$times.Add(0);[void]$times.Add(1)
  for($k=0;$k -le 48;$k++){[void]$times.Add(($j*$gap+$base*$k/48)/$total)}
  $frames=@(foreach($t in $times){
   $p=[Math]::Max(0.0,[Math]::Min(1.0,($t*$total-$j*$gap)/$base));$e=1-[Math]::Pow(1-$p,3);$smooth=$p*$p*(3-2*$p)
   $x=0.;$y=0.;$sx=1.;$angle=0.;$opacity=$smooth
   if($Plan.id -eq 'text-tracking'){
    $lineItems=@($items|Where-Object {[Math]::Abs($_.top-$item.top) -lt 2});$center=(($lineItems|ForEach-Object {$_.left+$_.width/2}|Measure-Object -Average).Average)
    $x=(($item.left+$item.width/2)-$center)*.7*$a*(1-$e)
   }elseif($Plan.id -eq 'text-flip'){$sx=.015+.985*$e;$angle=-8*(1-$e);$opacity=[Math]::Min(1.0,$p*5)}
   elseif($scatter){$theta=$j*2.39996323;$scale=$item.height/42.;$x=[Math]::Cos($theta)*200*$a*$p*$p*$scale;$y=[Math]::Sin($theta)*150*$a*$p*$p*$scale;$angle=[Math]::Sin($theta)*150*$p*$p;$opacity=1-$smooth}
   @{t=$t;x=$x-$park;y=$y;sx=$sx;r=$angle;opacity=$opacity}
  })
  $trig=2;if($j -eq 0 -and -not $scatter){$trig=$Trigger}
  $effect=New-PangEffect -Slide $Slide -Shape $b -Duration $total -Delay $Delay -Trigger $trig
  [void](Add-PangTransformTracks -Effect $effect -Shape $b -SlideWidth $sw -SlideHeight $sh -Frames $frames)
  [void](New-PangEffect -Slide $Slide -Shape $b -EffectId 1 -Duration .001 -Delay ($Delay+$total) -Trigger 2 -Exit)
 }
 if(-not $scatter){[void](New-PangEffect -Slide $Slide -Shape $Shape -EffectId 1 -Duration .001 -Delay ($Delay+$total) -Trigger 2)}
 }finally{
  if($group){try{$group.Delete()}catch{}}
  foreach($file in [IO.Directory]::GetFiles($folder)){[IO.File]::Delete($file)}
  [IO.Directory]::Delete($folder)
 }
}

# Native adapter used by the local plugin host and its isolated PowerPoint tests.
. (Join-Path $PSScriptRoot 'native-animations.ps1')
. (Join-Path $PSScriptRoot 'number-frames.ps1')
. (Join-Path $PSScriptRoot 'text-effects.ps1')

if(-not $script:PangApplyTokens){$script:PangApplyTokens=@{}}
if(-not $script:PangApplyTokenOrder){$script:PangApplyTokenOrder=New-Object Collections.Queue}

function Copy-PangShapeToSlide {
 param($Source,$Slide,[int]$Attempts=12,[int]$ExpectedEffects=-1)
 for($retry=0;$retry -lt $Attempts;$retry++){
  $before=$Slide.Shapes.Count;$effectsBefore=$Slide.TimeLine.MainSequence.Count
  try{
   $Source.Copy();Start-Sleep -Milliseconds 35
   $range=$Slide.Shapes.Paste()
   if(-not $range -or $range.Count -lt 1){throw 'PowerPoint clipboard returned no shapes.'}
   if($ExpectedEffects -ge 0 -and $Slide.TimeLine.MainSequence.Count-$effectsBefore -ne $ExpectedEffects){throw 'PowerPoint clipboard omitted animation tracks.'}
   return $range.Item(1)
  }catch{
   $failure=$_
   while($Slide.Shapes.Count -gt $before){try{$Slide.Shapes.Item($Slide.Shapes.Count).Delete()}catch{break}}
   if($retry -eq $Attempts-1){throw $failure}
   Start-Sleep -Milliseconds (50+25*$retry)
  }
 }
}

function Get-PangSlideSequences {
 param($Slide)
 $sequences=New-Object Collections.ArrayList
 [void]$sequences.Add($Slide.TimeLine.MainSequence)
 try{
  $interactive=$Slide.TimeLine.InteractiveSequences
  for($i=1;$i -le $interactive.Count;$i++){[void]$sequences.Add($interactive.Item($i))}
 }catch{}
 return ,$sequences
}

function Add-PangParagraphFrames {
 param($Slide,$Box,[int]$Count,[double]$Start,[double]$Duration,[int]$Trigger=2)
 $seq=$Slide.TimeLine.MainSequence
 foreach($exit in @($false,$true)) {
  $before=$seq.Count
  [void]$seq.AddEffect($Box,1,2,2) # msoAnimateTextByFirstLevel = 2
  $added=$seq.Count-$before
  if($added -ne $Count){throw "段落数异常：$added / $Count"}
  for($i=0;$i -lt $added;$i++) {
   $e=$seq.Item($before+$i+1)
   if($exit){$e.Exit=-1;$e=$seq.Item($before+$i+1)}
   try {$e.Timing.Duration=[single].001} catch {throw "frame=$i exit=$exit count=$($seq.Count) before=$before : $($_.Exception.Message)"}
   $e.Timing.TriggerType=2
   $e.Timing.TriggerDelayTime=[single]($Start+($i+[int]$exit)*$Duration/$Count)
  }
 }
}

function Add-PangCloudContainer {
 param($Slide,$Shape,[double]$Duration=1.8,[double]$Delay=0,[string]$Owner)
 $app=$Slide.Application
 $template=$null;$b=$null;$stage='尺寸检查'
 $sw=[double]$Slide.Parent.PageSetup.SlideWidth;$sh=[double]$Slide.Parent.PageSetup.SlideHeight
 $width=[double]$Shape.Width;$height=[double]$Shape.Height
 $left=[double]$Shape.Left;$top=[double]$Shape.Top
 try {
  foreach($value in @($sw,$sh,$width,$height,$left,$top)){
   if([double]::IsNaN($value) -or [double]::IsInfinity($value)){throw '画布或元素包含无效尺寸。'}
  }
  if($sw -le 0 -or $sh -le 0 -or $width -le 0 -or $height -le 0){throw '画布与元素宽高必须大于零。'}
  $stage='读取尘雾模板'
  $template=$app.Presentations.Open((Join-Path $PSScriptRoot 'assets/cloud-scalable.pptx'),-1,0,0)
  $source=Get-PangNamedShape $template.Slides.Item(1) 'PANG_CLOUD_GROUP'
  if(-not $source){throw 'Cloud template missing.'}
  $stage='复制尘雾'
  $before=$Slide.TimeLine.MainSequence.Count
  $b=Copy-PangShapeToSlide -Source $source -Slide $Slide -ExpectedEffects 96
  $ratio=$width/186.0
  # The group contains actual PNG pictures, so scaling and alignment have no
  # dependency on text metrics or the maximum PowerPoint font size.
  $stage='缩放尘雾外层';$b.LockAspectRatio=0
  $b.Width=[single](960*$ratio);$b.Height=[single](540*$ratio)
  $stage='定位尘雾落点'
  $b.Left=[single]($left+$width/2-480*$ratio)
  $b.Top=[single]($top+$height-363*$ratio)
  $b.Name='旁门云雾 · '+$Shape.Name
  $b.Tags.Add('PANG_OWNER',$Owner);$b.Tags.Add('PANG_HELPER','cloud')
  $stage='校验尘雾内部尺寸'
  if($b.Type -ne 6 -or $b.GroupItems.Count -ne 48){throw '尘雾内部帧未正确保留。'}
  $stage='设置尘雾播放时间'
  $seq=$Slide.TimeLine.MainSequence
  $drop=[Math]::Min(.2,.4*$Duration)
  $count=$seq.Count-$before
  if($count -ne 96){throw "Cloud paste did not preserve 96 effects: $count"}
  # PowerPoint reorders MainSequence immediately when a delay changes. Snapshot
  # effect references before editing; iterating live indices can edit one effect
  # repeatedly and leave other frames at their template timings.
  $frames=@(for($i=$before+1;$i -le $seq.Count;$i++){$seq.Item($i)})
  foreach($e in $frames) {
   if($e.Shape.Name -notmatch '^PANG_CLOUD_FRAME_(\d{3})$'){throw 'Invalid cloud frame target.'}
   $frame=[int]$Matches[1]
   if($frame -ge 48){throw 'Invalid cloud frame index.'}
   $progress=($frame+[int]($e.Exit -ne 0))/48.0
   $e.Timing.TriggerType=2
   $e.Timing.TriggerDelayTime=[single]($Delay+$drop+$progress*($Duration-$drop))
  }
 } catch {
  $detail='落点尘雾失败（阶段：{0}；画布：{1:F1}×{2:F1} pt；元素：{3:F1}×{4:F1} pt）：{5}' -f $stage,$sw,$sh,$width,$height,$_.Exception.Message
  if($b){try{$b.Delete()}catch{}}
  throw $detail
 } finally {if($template){Close-PangTemporaryPresentation $template}}

 return $b
}

function Get-PangShapeMainEffects {
 param($Slide,$Shape)
 $effects=@();$seq=$Slide.TimeLine.MainSequence
 for($i=1;$i -le $seq.Count;$i++){
  $effect=$seq.Item($i)
  if([int]$effect.Shape.Id -eq [int]$Shape.Id){$effects+=,$effect}
 }
 return $effects
}

function Set-PangLoopRepeatInFile {
 param([string]$Path,[int]$EffectIndex)
 # PowerPoint exposes "until the end of the slide" as a read-only negative
 # RepeatCount. Patch only a private, owned staging deck, then reopen it.
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 Add-Type -AssemblyName System.IO.Compression
 $zip=[IO.Compression.ZipFile]::Open($Path,[IO.Compression.ZipArchiveMode]::Update)
 try{
  $entry=$zip.GetEntry('ppt/slides/slide1.xml')
  if(-not $entry){throw 'Loop staging slide is missing.'}
  $reader=New-Object IO.StreamReader($entry.Open())
  try{$xml=New-Object Xml.XmlDocument;$xml.LoadXml($reader.ReadToEnd())}finally{$reader.Dispose()}
  $ns=New-Object Xml.XmlNamespaceManager($xml.NameTable)
  $ns.AddNamespace('p','http://schemas.openxmlformats.org/presentationml/2006/main')
  $nodes=$xml.SelectNodes('//p:cTn[@presetClass]',$ns)
  if($nodes.Count -lt $EffectIndex){throw 'Loop staging effect index is missing.'}
  $effect=$nodes.Item($EffectIndex-1)
  if($effect.GetAttribute('presetClass') -ne 'emph'){throw 'Loop staging target is not an emphasis effect.'}
  $targets=$effect.SelectNodes('.//p:spTgt',$ns)
  if($targets.Count -lt 1){throw 'Loop staging target is missing.'}
  foreach($target in $targets){if($target.SelectSingleNode('p:txEl',$ns)){throw 'Loop staging target is not the whole shape.'}}
  $effect.SetAttribute('repeatCount','indefinite')
  $entry.Delete();$entry=$zip.CreateEntry('ppt/slides/slide1.xml');$stream=$entry.Open()
  try{$xml.Save($stream)}finally{$stream.Dispose()}
 }finally{$zip.Dispose()}
}

function Add-PangLoopAnimation {
 param($Slide,[object[]]$Shapes,$Plan,[int]$Trigger,[double]$Delay,[bool]$ReplaceExisting,[object[]]$TargetEffects,[bool]$Updating)
 if(-not $Shapes.Count){throw '请先在 PPT 中选择元素。'}
 if($Plan.mode -eq 'text'){
  foreach($shape in $Shapes){if($shape.HasTextFrame -ne -1 -or $shape.TextFrame.HasText -ne -1){throw '此效果需要选择有文字的文本框。'}}
 }
 $duration=[double]$Plan.duration;$gap=[double]$Plan.stagger
 if($duration -lt .2 -or $duration -gt 8 -or $gap -lt 0 -or $gap -gt .2){throw '动画参数超出范围。'}
 $created=@();$entries=New-Object Collections.ArrayList;$mutated=New-Object Collections.ArrayList
 $stageRoot=Join-Path (Split-Path $PSScriptRoot -Parent) 'build/loop-stage'
 [void][IO.Directory]::CreateDirectory($stageRoot)
 try{
 for($j=0;$j -lt $Shapes.Count;$j++){
  $shape=$Shapes[$j];$temp=$null;$reopened=$null
  $path=Join-Path $stageRoot ([guid]::NewGuid().ToString('N')+'.pptx')
  try{
   $sourceEffects=@(Get-PangShapeMainEffects -Slide $Slide -Shape $shape)
   $interactiveCount=0
   $sourceSequences=Get-PangSlideSequences -Slide $Slide
   for($sequenceIndex=1;$sequenceIndex -lt $sourceSequences.Count;$sequenceIndex++){
    $sequence=$sourceSequences[$sequenceIndex]
    for($i=1;$i -le $sequence.Count;$i++){
     if([int]$sequence.Item($i).Shape.Id -eq [int]$shape.Id){$interactiveCount++}
    }
   }
   if($interactiveCount -and ($Updating -or -not $ReplaceExisting)){throw '此元素含触发器动画，循环效果暂无法安全保留其触发顺序；请先选择“替换原动画”。'}
   $drop=@()
   if($Updating){
    foreach($old in $TargetEffects){
     if([int]$old.Shape.Id -ne [int]$shape.Id){continue}
     $found=$false
     for($k=0;$k -lt $sourceEffects.Count;$k++){
      if([int]$sourceEffects[$k].Index -eq [int]$old.Index){$drop+=($k+1);$found=$true;break}
     }
     if(-not $found){throw '动画更新目标已变化，请重新点击动画卡片。'}
    }
   }
   $temp=$Slide.Application.Presentations.Add(0)
   $temp.PageSetup.SlideWidth=$Slide.Parent.PageSetup.SlideWidth
   $temp.PageSetup.SlideHeight=$Slide.Parent.PageSetup.SlideHeight
   $privateSlide=$temp.Slides.Add(1,12)
   $copy=Copy-PangShapeToSlide -Source $shape -Slide $privateSlide
   $backupSlide=$temp.Slides.Add(2,12)
   [void](Copy-PangShapeToSlide -Source $shape -Slide $backupSlide)
   $privateEffects=@(Get-PangShapeMainEffects -Slide $privateSlide -Shape $copy)
   if($privateEffects.Count -ne $sourceEffects.Count -and ($Updating -or -not $ReplaceExisting)){throw "PowerPoint clipboard changed existing shape animations ($($privateEffects.Count)/$($sourceEffects.Count))."}
   if($ReplaceExisting -and -not $Updating){
    foreach($sequence in (Get-PangSlideSequences -Slide $privateSlide)){
     for($i=$sequence.Count;$i -ge 1;$i--){
      $old=$sequence.Item($i);if([int]$old.Shape.Id -eq [int]$copy.Id){$old.Delete()}
     }
    }
   }elseif($Updating){
    foreach($ordinal in @($drop|Sort-Object -Unique -Descending)){$privateEffects[$ordinal-1].Delete()}
   }
   $newTrigger=$(if($j -eq 0){$Trigger}else{2})
   [void](Add-PangSelectionAnimationCore -Slide $privateSlide -Shapes @($copy) -Plan $Plan -Trigger $newTrigger -Delay ($Delay+$j*$gap))
   $fresh=@($script:PangLastCreatedEffects)
   if($fresh.Count -ne 1){throw 'Loop staging created an unexpected number of effects.'}
   $freshIndex=[int]$fresh[0].Index
   $temp.SaveAs($path,24);Close-PangTemporaryPresentation $temp;$temp=$null
   Set-PangLoopRepeatInFile -Path $path -EffectIndex $freshIndex
   $reopened=$Slide.Application.Presentations.Open($path,-1,0,0)
   $seedSlide=$reopened.Slides.Item(1);$seed=$seedSlide.Shapes.Item(1)
   $seedEffects=@(Get-PangShapeMainEffects -Slide $seedSlide -Shape $seed)
   $seedRepeats=@($seedEffects|ForEach-Object {$_.Timing.RepeatCount})
   if($freshIndex -gt $seedEffects.Count -or $seedEffects[$freshIndex-1].Timing.RepeatCount -ne [int]::MinValue){throw "Loop staging repeat setting was lost (index=$freshIndex count=$($seedEffects.Count) repeats=$($seedRepeats -join ','))."}
   [void]$entries.Add(@{path=$path;reopened=$reopened;shape=$shape;seed=$seed;backup=$reopened.Slides.Item(2).Shapes.Item(1);freshIndex=$freshIndex;count=$seedEffects.Count;oldCount=$sourceEffects.Count+$interactiveCount})
   $reopened=$null
  }catch{
   if($reopened){Close-PangTemporaryPresentation $reopened}
   if($temp){Close-PangTemporaryPresentation $temp}
   if([IO.File]::Exists($path)){[IO.File]::Delete($path)}
   throw
  }
 }
 try{
  foreach($entry in $entries){
   [void]$mutated.Add($entry)
   $entry.seed.PickupAnimation();$entry.shape.ApplyAnimation()
   $applied=@(Get-PangShapeMainEffects -Slide $Slide -Shape $entry.shape)
   if($applied.Count -ne $entry.count){throw 'PowerPoint animation brush omitted shape animations.'}
   $loop=$applied[$entry.freshIndex-1]
   if([int]$loop.Shape.Id -ne [int]$entry.shape.Id -or $loop.Timing.RepeatCount -ne [int]::MinValue){throw 'Loop animation target or repeat setting was lost.'}
   $created+=,$loop
  }
 }catch{
  $failure=$_
  for($j=$mutated.Count-1;$j -ge 0;$j--){
   $entry=$mutated[$j]
   try{
    if($entry.oldCount){$entry.backup.PickupAnimation();$entry.shape.ApplyAnimation()}
    else{
     foreach($sequence in (Get-PangSlideSequences -Slide $Slide)){
      for($i=$sequence.Count;$i -ge 1;$i--){if([int]$sequence.Item($i).Shape.Id -eq [int]$entry.shape.Id){$sequence.Item($i).Delete()}}
     }
    }
   }catch{}
  }
  throw $failure
 }
 $script:PangLastCreatedEffects=$created
 return @{count=$Shapes.Count;effects=$created.Count;message=('已应用到 '+$Shapes.Count+' 个元素')}
 }finally{
  foreach($entry in $entries){
   if($entry.reopened){Close-PangTemporaryPresentation $entry.reopened}
   if([IO.File]::Exists($entry.path)){[IO.File]::Delete($entry.path)}
  }
 }
}

function Get-PangOwner {param($Shape)
 $id=$Shape.Tags.Item('PANG_ANIM_OWNER');if(-not $id){$id=[guid]::NewGuid().ToString('N');$Shape.Tags.Add('PANG_ANIM_OWNER',$id)};return $id
}

function Add-PangSelectionAnimationCore {
 param($Slide,[object[]]$Shapes,$Plan,[int]$Trigger=1,[double]$Delay=0)
 if(-not $Shapes.Count){throw '请先在 PPT 中选择元素。'}
 if($Plan.id -in @('number-roll','number-count') -and $Shapes.Count -ne 1){throw '数值动画请一次选择一个数字文本框。'}
 $effectId=[string]$Plan.id;$category=[string]$Plan.category
 $duration=[double]$Plan.duration;$gap=[double]$Plan.stagger
 if($duration -lt .2 -or $duration -gt 8 -or $gap -lt 0 -or $gap -gt .2){throw '动画参数超出范围。'}
 if($Plan.mode -eq 'text') {foreach($s in $Shapes){if($s.HasTextFrame -ne -1 -or $s.TextFrame.HasText -ne -1){throw '此效果需要选择有文字的文本框。'}}}
 if($effectId -in @('grid-in','grid-out','alternate-in') -and $Shapes.Count -lt 2){throw '错峰动画需要至少选择两个元素。'}

 $ordered=@($Shapes)
 if($effectId -in @('grid-in','grid-out')){
  $cx=($Shapes | ForEach-Object {$_.Left+$_.Width/2} | Measure-Object -Average).Average
  $cy=($Shapes | ForEach-Object {$_.Top+$_.Height/2} | Measure-Object -Average).Average
  $ordered=@($Shapes | Sort-Object {[Math]::Pow(($_.Left+$_.Width/2-$cx),2)+[Math]::Pow(($_.Top+$_.Height/2-$cy),2)})
 }
 if($effectId -eq 'alternate-in'){$ordered=@($Shapes|Sort-Object {[Math]::Round($_.Top/10)},Left,Id)}
 $seq=$Slide.TimeLine.MainSequence;$first=$seq.Count+1
 $createdEffects=New-Object Collections.ArrayList
 $sw=[double]$Slide.Parent.PageSetup.SlideWidth;$sh=[double]$Slide.Parent.PageSetup.SlideHeight
 for($j=0;$j -lt $ordered.Count;$j++){
 $s=$ordered[$j];$start=$Delay+$j*$gap
  $trig=2;if($j -eq 0){$trig=$Trigger}
  $isExit=$category -eq 'exit';$isEmphasis=$category -in @('emphasis','loop')
  $branchBefore=$seq.Count;$numericCreated=$null
  if($effectId -in @('number-roll','number-count')){
   $numericCreated=Add-PangNumberAnimation -Slide $Slide -Shape $s -Plan $Plan -Trigger $trig -Delay $start
  } elseif($effectId -eq 'text-highlight'){
   Add-PangHighlight -Slide $Slide -Shape $s -Plan $Plan -Trigger $trig -Delay $start
  } elseif($effectId -in @('text-tracking','text-flip','text-scatter')){
   Add-PangCharacterAnimation -Slide $Slide -Shape $s -Plan $Plan -Trigger $trig -Delay $start
  } elseif($effectId -eq 'anvil') {
   $e=Add-PangRecipe -Slide $Slide -Shape $s -Recipe anvil -Duration $duration -Delay $start -Trigger $trig -SlideWidth $sw -SlideHeight $sh -Intensity $Plan.intensity
   if($Plan.dust){[void](Add-PangCloudContainer -Slide $Slide -Shape $s -Duration $duration -Delay $start -Owner (Get-PangOwner $s))}
  } elseif($effectId -in @('pivot-in','pivot-out','jack-in','roll-in','roll-out','flip-once','grid-in','grid-out')) {
    $recipe=@{'pivot-in'='pivot';'pivot-out'='pivot';'jack-in'='jack';'roll-in'='roll';'roll-out'='roll';'flip-once'='flip';'grid-in'='grid';'grid-out'='grid'}[$effectId]
    $directionName=[string]$Plan.direction
    $directionAngle=$(if($null -ne $Plan.directionAngle){[double]$Plan.directionAngle}else{
      switch($directionName){
       'up' { 0 }
       'up-right' { 45 }
       'right' { 90 }
       'down-right' { 135 }
       'down' { 180 }
       'down-left' { 225 }
       'left' { 270 }
       'up-left' { 315 }
       default { 0 }
      }
    })
    $rad=$directionAngle*[Math]::PI/180;$ux=[Math]::Sin($rad);$uy=-[Math]::Cos($rad)
    $distances=@();if([Math]::Abs($ux)-gt .0001){$distances+=$sw*.5/[Math]::Abs($ux)};if([Math]::Abs($uy)-gt .0001){$distances+=$sh*.5/[Math]::Abs($uy)}
    $travelDistance=$(if($distances.Count){($distances|Measure-Object -Minimum).Minimum}else{$sh*.5})
    $e=Add-PangRecipe -Slide $Slide -Shape $s -Recipe $recipe -Duration $duration -Delay $start -Trigger $trig -SlideWidth $sw -SlideHeight $sh -Intensity $Plan.intensity -Distance $travelDistance -Direction $Plan.nativeDirection -DirectionName $directionName -DirectionAngle $directionAngle -Exit:$isExit
  } elseif($effectId -in @('wipe-in','wipe-out','text-lines-in','text-lines-out')) {
   if([int]$Plan.nativeDirection -notin @(1,2,3,4)){throw '擦除和逐段揭示仅支持上、下、左、右。'}
   $level=0;if($Plan.mode -eq 'text'){$level=2}
   $before=$seq.Count;[void]$seq.AddEffect($s,22,$level,$trig)
   for($i=$before+1;$i -le $seq.Count;$i++){
    $e=$seq.Item($i);if($isExit){$e.Exit=-1};$e.EffectParameters.Direction=[int]$Plan.nativeDirection
    $e.Timing.Duration=[single]$duration;$e.Timing.TriggerType=2
    $e.Timing.TriggerDelayTime=[single]($start+($i-$before-1)*$gap)
   };$seq.Item($before+1).Timing.TriggerType=$trig
  } else {
   $e=New-PangEffect -Slide $Slide -Shape $s -Duration $duration -Delay $start -Trigger $trig -Exit:$isExit -Emphasis:$isEmphasis
   $frames=@();foreach($f in $Plan.frames){
    $v=@{t=[double]$f.t};foreach($key in @('x','y','sx','sy','r','opacity')){if($null -ne $f.$key){$v[$key]=[double]$f.$key}}
    if($effectId -eq 'alternate-in' -and $j%2 -eq 1 -and $v.ContainsKey('x')){$v.x=-$v.x}
    # Scale motion distance with the object, preserving the recipe's proportions.
    foreach($key in @('x','y')){if($v.ContainsKey($key)){$v[$key]*=[Math]::Min($s.Width,$s.Height)/184.0}}
    $frames+=$v
   }
   [void](Add-PangTransformTracks -Effect $e -Shape $s -SlideWidth $sw -SlideHeight $sh -Frames $frames -PositionMode Expression)
   if($Plan.mode -eq 'text' -and $effectId -ne 'text-breathe') {
    $unit=1;if($Plan.split -eq 'word'){$unit=2}
    $e=$seq.ConvertToTextUnitEffect($e,$unit)
   }
  }
  if($numericCreated){foreach($created in @($numericCreated.effects)){[void]$createdEffects.Add($created)}}
  else{for($i=$branchBefore+1;$i -le $seq.Count;$i++){[void]$createdEffects.Add($seq.Item($i))}}
 }
 $script:PangLastCreatedEffects=@($createdEffects)
 return @{count=$ordered.Count;effects=($seq.Count-$first+1);message=('已应用到 '+$ordered.Count+' 个元素')}
}

function Add-PangSelectionAnimation {
 param($Slide,[object[]]$Shapes,$Plan,[int]$Trigger=1,[double]$Delay=0,[bool]$ReplaceExisting=$false,[string]$UpdateToken,[string]$SelectionSignature)
 $seq=$Slide.TimeLine.MainSequence;$before=$seq.Count
 $shapeIds=@{};for($i=1;$i -le $Slide.Shapes.Count;$i++){$shapeIds[[int]$Slide.Shapes.Item($i).Id]=$true}
 $originals=@();foreach($s in $Shapes){$originals+=@{shape=$s;owner=$s.Tags.Item('PANG_ANIM_OWNER');text=$(if($s.HasTextFrame -eq -1){$s.TextFrame.TextRange.Text}else{$null})}}
 $targetEffects=@();$targetHelpers=@();$selectedIds=@{};$owners=@{}
 foreach($old in $originals){$selectedIds[[int]$old.shape.Id]=$true;if($old.owner){$owners[[string]$old.owner]=$true}}
 if($UpdateToken){
  $entry=$script:PangApplyTokens[$UpdateToken]
  if(-not $entry -or ($SelectionSignature -and $entry.signature -ne $SelectionSignature) -or [int]$entry.slideId -ne [int]$Slide.SlideID){throw '动画更新目标已变化，请重新点击动画卡片。'}
  $targetEffects=@($entry.effects);$targetHelpers=@($entry.helpers)
 } elseif($ReplaceExisting){
  for($i=1;$i -le $Slide.Shapes.Count;$i++){
   $candidate=$Slide.Shapes.Item($i);$owner=[string]$candidate.Tags.Item('PANG_OWNER')
   if($owner -and $owners.ContainsKey($owner)){$targetHelpers+=,$candidate}
  }
  $helperIds=@{};$pendingHelpers=New-Object Collections.Queue
  foreach($helper in $targetHelpers){$pendingHelpers.Enqueue($helper)}
  while($pendingHelpers.Count){
   $helper=$pendingHelpers.Dequeue()
   try{
    $helperIds[[int]$helper.Id]=$true
    if($helper.Type -eq 6){for($i=1;$i -le $helper.GroupItems.Count;$i++){$pendingHelpers.Enqueue($helper.GroupItems.Item($i))}}
   }catch{}
  }
  $allSequences=Get-PangSlideSequences -Slide $Slide
  foreach($oldSequence in $allSequences){
   for($i=1;$i -le $oldSequence.Count;$i++){
    $oldEffect=$oldSequence.Item($i);try{$effectShapeId=[int]$oldEffect.Shape.Id;if($selectedIds.ContainsKey($effectShapeId) -or $helperIds.ContainsKey($effectShapeId)){$targetEffects+=,$oldEffect}}catch{}
   }
  }
 }
 $script:PangLastCreatedEffects=@()
 $isLoop=[string]$Plan.category -eq 'loop'
 try {
  if($isLoop){$result=Add-PangLoopAnimation -Slide $Slide -Shapes $Shapes -Plan $Plan -Trigger $Trigger -Delay $Delay -ReplaceExisting $ReplaceExisting -TargetEffects $targetEffects -Updating ([bool]$UpdateToken)}
  else{$result=Add-PangSelectionAnimationCore -Slide $Slide -Shapes $Shapes -Plan $Plan -Trigger $Trigger -Delay $Delay}
 }
 catch {
  $failure=$_
  if(-not $isLoop){for($i=$seq.Count;$i -gt $before;$i--){try{$seq.Item($i).Delete()}catch{}}}
  for($i=$Slide.Shapes.Count;$i -ge 1;$i--){$s=$Slide.Shapes.Item($i);if(-not $shapeIds.ContainsKey([int]$s.Id)){try{$s.Delete()}catch{}}}
  foreach($old in $originals){
   try {if($Plan.id -in @('number-roll','number-count') -and $null -ne $old.text -and $old.shape.TextFrame.TextRange.Text -ne $old.text){$old.shape.TextFrame.TextRange.Text=$old.text}} catch {}
   try {if(-not $old.owner){$old.shape.Tags.Delete('PANG_ANIM_OWNER')}} catch {}
  }
  throw $failure
 }
 $newHelpers=@();for($i=1;$i -le $Slide.Shapes.Count;$i++){$candidate=$Slide.Shapes.Item($i);if(-not $shapeIds.ContainsKey([int]$candidate.Id)){$newHelpers+=,$candidate}}
 for($i=$targetEffects.Count-1;$i -ge 0;$i--){
  try{
   # Applying the staged loop replaces the selected shape's effects. The old
   # COM references now point to replaced events; helper effects still need
   # their normal cleanup below.
   if($isLoop -and $selectedIds.ContainsKey([int]$targetEffects[$i].Shape.Id)){continue}
   $targetEffects[$i].Delete()
  }catch{}
 }
 for($i=$targetHelpers.Count-1;$i -ge 0;$i--){try{$targetHelpers[$i].Delete()}catch{}}
 if($UpdateToken){$script:PangApplyTokens.Remove($UpdateToken)}
 $token=[guid]::NewGuid().ToString('N')
 $script:PangApplyTokens[$token]=@{signature=$SelectionSignature;slideId=[int]$Slide.SlideID;effects=@($script:PangLastCreatedEffects);helpers=@($newHelpers)}
 $script:PangApplyTokenOrder.Enqueue($token)
 while($script:PangApplyTokenOrder.Count -gt 24){$expired=[string]$script:PangApplyTokenOrder.Dequeue();if($expired -ne $token){$script:PangApplyTokens.Remove($expired)}}
 $result.token=$token;$result.removedEffects=$targetEffects.Count
 if($UpdateToken){$result.message='已更新动画'}
 elseif($ReplaceExisting -and $targetEffects.Count){$result.message=('已替换 '+$targetEffects.Count+' 个旧动画，并应用到 '+$result.count+' 个元素')}
 elseif($ReplaceExisting){$result.message=('已应用到 '+$result.count+' 个元素')}
 else{$result.message=('已保留原动画，并新增到 '+$result.count+' 个元素')}
 return $result
}

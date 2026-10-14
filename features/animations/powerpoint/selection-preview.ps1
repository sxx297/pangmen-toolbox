# Read selected animation availability without copying or changing the timeline.
function Get-PangPreviewTargetIds {
 param($Slide,[object[]]$Shapes)
 $ids=@{};$owners=@{};$queue=New-Object Collections.Queue
 foreach($shape in $Shapes){$queue.Enqueue($shape)}
 foreach($pass in @(0,1)){
  if($pass -eq 1){for($i=1;$i -le $Slide.Shapes.Count;$i++){$shape=$Slide.Shapes.Item($i);$owner=[string]$shape.Tags.Item('PANG_OWNER');if($owner -and $owners.ContainsKey($owner)){$queue.Enqueue($shape)}}}
  while($queue.Count){
   $shape=$queue.Dequeue();if($ids.ContainsKey([int]$shape.Id)){continue};$ids[[int]$shape.Id]=$true
   $owner=[string]$shape.Tags.Item('PANG_ANIM_OWNER');if($owner){$owners[$owner]=$true}
   if($shape.Type -eq 6){for($i=1;$i -le $shape.GroupItems.Count;$i++){$queue.Enqueue($shape.GroupItems.Item($i))}}
  }
 }
 return $ids
}
function Get-PangPreviewEffectCount {
 param($Slide,[object[]]$Shapes,[switch]$FirstMatch)
 $ids=Get-PangPreviewTargetIds $Slide $Shapes;$count=0
 foreach($sequence in (Get-PangSlideSequences $Slide)){for($i=1;$i -le $sequence.Count;$i++){if($ids.ContainsKey([int]$sequence.Item($i).Shape.Id)){if($FirstMatch){return 1};$count++}}}
 return $count
}

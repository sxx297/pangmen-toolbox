$ErrorActionPreference='Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'powerpoint/selection-animations.ps1')
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'powerpoint/selection-preview.ps1')
$script:PangAllowed=Get-Content -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'powerpoint/native-catalog.json') -Raw -Encoding UTF8 | ConvertFrom-Json
function Get-PangEmbeddedSelection {
 $app=$PangApplication
 if($app.Presentations.Count -eq 0){return @{ok=$true;count=0;signature=''}}
 $window=$app.ActiveWindow
 if($null -eq $window -or $window.Selection.Type -notin @(2,3)){return @{ok=$true;count=0;signature=''}}
 $range=$window.Selection.ShapeRange;$slide=$window.View.Slide;$shapes=@()
 for($i=1;$i -le $range.Count;$i++){$shapes+=,$range.Item($i)}
 $signature=([string]$slide.SlideID)+':'+(($shapes|ForEach-Object {$_.Id})-join ',')
 $numeric=$null;$numericError=$null
 if($shapes.Count -eq 1){
  try{$numeric=Get-PangNumberSpec $shapes[0]}catch{$numericError=$_.Exception.Message}
 }else{$numericError='数值动画请一次选择一个数字文本框。'}
 # The UI only needs availability; stop after the first matching animation.
 $animationCount=Get-PangPreviewEffectCount $slide $shapes -FirstMatch
 return @{ok=$true;count=$shapes.Count;name=$shapes[0].Name;signature=$signature;slide=$slide;shapes=$shapes;numeric=$numeric;numericError=$numericError;animationCount=$animationCount}
}
function Invoke-PangEmbedded {
 param([string]$Route,[string]$Json)
 $v=Get-PangEmbeddedSelection
 if($Route -eq 'selection'){return (@{ok=$true;count=$v.count;name=$v.name;signature=$v.signature;numeric=$v.numeric;numericError=$v.numericError;animationCount=$v.animationCount}|ConvertTo-Json -Depth 6 -Compress)}
 if($Route -eq 'preview'){
  $data=$Json|ConvertFrom-Json
  if(-not $v.count -or $v.signature -ne $data.selection){throw 'PPT 选区已变化，请重新点击预览。'}
  if(-not $v.animationCount){throw '选中元素还没有动画。'}
  $bars=$PangApplication.CommandBars
  if(-not $bars.GetEnabledMso('AnimationPreview')){throw '当前编辑视图无法预览动画。'}
  $bars.ExecuteMso('AnimationPreview')
  return (@{ok=$true;previewed=$true;scope='native-page'}|ConvertTo-Json -Compress)
 }
 if($Route -ne 'apply'){throw '请求不支持。'}
 $data=$Json|ConvertFrom-Json
 $known=@($script:PangAllowed|Where-Object {$_.id -eq $data.plan.id})
 if($known.Count -ne 1 -or $data.plan.mode -ne $known[0].mode -or $data.plan.category -ne $known[0].category){throw '动画配方无效。'}
 if($data.trigger -notin @(1,2,3) -or @($data.plan.frames).Count -gt 100){throw '动画参数无效。'}
 if(-not $v.count -or $v.signature -ne $data.selection){throw 'PPT 选区已变化，请重新点击应用。'}
 $PangApplication.StartNewUndoEntry()
 if($null -ne $data.replaceExisting -and $data.replaceExisting -isnot [bool]){throw '已有动画处理方式无效。'}
 $replaceExisting=$false;if($null -ne $data.replaceExisting){$replaceExisting=[bool]$data.replaceExisting}
 $updateToken='';if($data.updateToken){$updateToken=[string]$data.updateToken;if($updateToken -notmatch '^[0-9a-f]{32}$'){throw '动画更新标识无效。'}}
 $result=Add-PangSelectionAnimation -Slide $v.slide -Shapes $v.shapes -Plan $data.plan -Trigger $data.trigger -ReplaceExisting:$replaceExisting -UpdateToken $updateToken -SelectionSignature $v.signature
 for($i=0;$i -lt $v.shapes.Count;$i++){$v.shapes[$i].Select($(if($i -eq 0){-1}else{0}))}
 $result.ok=$true
 return ($result|ConvertTo-Json -Depth 6 -Compress)
}

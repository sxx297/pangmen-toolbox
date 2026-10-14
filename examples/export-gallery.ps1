param([string]$SourceRoot=(Split-Path $PSScriptRoot -Parent),[string]$OutputDir=(Join-Path $PSScriptRoot 'output/gallery'),[switch]$Resume)
$ErrorActionPreference='Stop'
$SourceRoot=[IO.Path]::GetFullPath($SourceRoot);$OutputDir=[IO.Path]::GetFullPath($OutputDir)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport,Guid("00000016-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMessageFilter { [PreserveSig] int HandleInComingCall(int type,IntPtr caller,int ticks,IntPtr info); [PreserveSig] int RetryRejectedCall(IntPtr callee,int ticks,int type); [PreserveSig] int MessagePending(IntPtr callee,int ticks,int type); }
public class GalleryMessageFilter:IMessageFilter {
 [DllImport("ole32.dll")] static extern int CoRegisterMessageFilter(IMessageFilter next,out IMessageFilter previous);
 public int HandleInComingCall(int t,IntPtr c,int k,IntPtr i){return 0;}
 public int RetryRejectedCall(IntPtr c,int ticks,int type){return ticks<10000?200:-1;}
 public int MessagePending(IntPtr c,int t,int type){return 2;}
 public static void Register(){IMessageFilter old;CoRegisterMessageFilter(new GalleryMessageFilter(),out old);}
 public static void Revoke(){IMessageFilter old;CoRegisterMessageFilter(null,out old);}
}
'@
[GalleryMessageFilter]::Register()
. (Join-Path $SourceRoot 'features/animations/powerpoint/selection-animations.ps1')
function Color([string]$hex){$v=[Convert]::ToInt32($hex,16);return (($v -shr 16) -band 255)+($v -band 65280)+(($v -band 255) -shl 16)}
function StyleText($shape,[string]$value,[single]$size,[string]$color){
 $shape.TextFrame.MarginLeft=0;$shape.TextFrame.MarginRight=0;$shape.TextFrame.MarginTop=0;$shape.TextFrame.MarginBottom=0
 $shape.TextFrame.TextRange.Text=$value
 $shape.TextFrame.TextRange.Font.Name='思源黑体 CN Bold'
 $shape.TextFrame.TextRange.Font.NameFarEast='思源黑体 CN Bold'
 $shape.TextFrame.TextRange.Font.Size=$size;$shape.TextFrame.TextRange.Font.Color.RGB=(Color $color)
 $shape.TextFrame.TextRange.ParagraphFormat.Alignment=2;$shape.TextFrame.VerticalAnchor=3
}
$app=New-Object -ComObject PowerPoint.Application;$owned=$null
try {
 foreach($entry in (Get-Content -LiteralPath (Join-Path $OutputDir 'plans.json') -Raw -Encoding UTF8 | ConvertFrom-Json)){
  if($Resume -and (Test-Path -LiteralPath (Join-Path $OutputDir ($entry.id+'.mp4')))){Write-Output ('Reused '+$entry.id);continue}
  $owned=$app.Presentations.Add(0);$owned.PageSetup.SlideWidth=640;$owned.PageSetup.SlideHeight=440
  $slide=$owned.Slides.Add(1,12);$slide.FollowMasterBackground=0;$slide.Background.Fill.Solid();$slide.Background.Fill.ForeColor.RGB=(Color 'F4F2EF')
  $slide.SlideShowTransition.AdvanceOnTime=-1;$slide.SlideShowTransition.AdvanceTime=5
  if($entry.mode -eq 'text'){
   $target=$slide.Shapes.AddTextbox(1,50,140,540,160)
   if($entry.id -in @('number-roll','number-count')){StyleText $target '128,640' 72 'FF5500'}else{StyleText $target '灵感跃然' 60 'FF5500'}
  } elseif($entry.id -in @('grid-in','grid-out','alternate-in')){
   $targets=@()
   for($i=0;$i -lt 6;$i++){
    $t=$slide.Shapes.AddShape(5,(150+($i%3)*116),(122+[Math]::Floor($i/3)*108),108,96)
    $t.Fill.Solid();$t.Fill.ForeColor.RGB=(Color 'FF5500');$t.Line.Visible=0;$t.Adjustments.Item(1)=.12
    StyleText $t ([string]($i+1)) 26 'FFFFFF';$targets+=,$t
   }
  } else {
   $target=$slide.Shapes.AddShape(5,215,145,210,150);$target.Fill.Solid();$target.Fill.ForeColor.RGB=(Color 'FF5500');$target.Line.Visible=0
   $target.Adjustments.Item(1)=.16
   StyleText $target $(if($entry.category -eq 'entrance'){'登场'}elseif($entry.category -eq 'exit'){'再会'}elseif($entry.category -eq 'loop'){'轻盈'}else{'重点'}) 40 'FFFFFF'
  }
  if($entry.id -notin @('grid-in','grid-out','alternate-in')){$targets=@($target)}
  [void](Add-PangSelectionAnimation -Slide $slide -Shapes $targets -Plan $entry.plan -Trigger 2 -Delay .45)
  $owned.SaveAs((Join-Path $OutputDir ($entry.id+'.pptx')),24)
  $owned.CreateVideo((Join-Path $OutputDir ($entry.id+'.mp4')),$true,5,660,24,85)
  $deadline=[DateTime]::UtcNow.AddMinutes(5)
  do{Start-Sleep -Milliseconds 400;$status=$owned.CreateVideoStatus}while($status -in @(1,2) -and [DateTime]::UtcNow -lt $deadline)
  if($status -ne 3){throw "Video export failed: $($entry.id), status=$status"}
  Write-Output "Native PowerPoint export: $($entry.id)"
  $owned.Close();$owned=$null
 }
}finally{if($null -ne $owned){try{$owned.Saved=-1;$owned.Close()}catch{}};[void][Runtime.InteropServices.Marshal]::ReleaseComObject($app);[GalleryMessageFilter]::Revoke()}

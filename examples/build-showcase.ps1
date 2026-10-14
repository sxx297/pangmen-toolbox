param([string]$SourceRoot=(Split-Path $PSScriptRoot -Parent),[string]$OutputDir=(Join-Path $PSScriptRoot 'output'),[switch]$MaterialsOnly)
$ErrorActionPreference='Stop'
$SourceRoot=[IO.Path]::GetFullPath($SourceRoot);$OutputDir=[IO.Path]::GetFullPath($OutputDir)
[void][IO.Directory]::CreateDirectory($OutputDir)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport,Guid("00000016-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMessageFilter { [PreserveSig] int HandleInComingCall(int type,IntPtr caller,int ticks,IntPtr info); [PreserveSig] int RetryRejectedCall(IntPtr callee,int ticks,int type); [PreserveSig] int MessagePending(IntPtr callee,int ticks,int type); }
public class ShowcaseMessageFilter:IMessageFilter {
 [DllImport("ole32.dll")] static extern int CoRegisterMessageFilter(IMessageFilter next,out IMessageFilter previous);
 public int HandleInComingCall(int t,IntPtr c,int k,IntPtr i){return 0;}
 public int RetryRejectedCall(IntPtr c,int ticks,int type){return ticks<10000?200:-1;}
 public int MessagePending(IntPtr c,int t,int type){return 2;}
 public static void Register(){IMessageFilter old;CoRegisterMessageFilter(new ShowcaseMessageFilter(),out old);}
 public static void Revoke(){IMessageFilter old;CoRegisterMessageFilter(null,out old);}
}
'@
[ShowcaseMessageFilter]::Register()
. (Join-Path $SourceRoot 'features/animations/powerpoint/selection-animations.ps1')
function Color([string]$hex){$v=[Convert]::ToInt32($hex,16);return (($v -shr 16) -band 255)+($v -band 65280)+(($v -band 255) -shl 16)}
function Text($slide,[string]$value,[single]$x,[single]$y,[single]$w,[single]$h,[single]$size,[string]$color='FFFFFF',[bool]$bold=$false){
 $s=$slide.Shapes.AddTextbox(1,$x,$y,$w,$h);$s.TextFrame.MarginLeft=0;$s.TextFrame.MarginRight=0;$s.TextFrame.MarginTop=0;$s.TextFrame.MarginBottom=0
 $s.TextFrame.TextRange.Text=$value;$s.TextFrame.TextRange.Font.Name='Microsoft YaHei';$s.TextFrame.TextRange.Font.Size=$size;$s.TextFrame.TextRange.Font.Color.RGB=(Color $color);$s.TextFrame.TextRange.Font.Bold=$(if($bold){-1}else{0});return $s
}
function Base($doc,[string]$title,[string]$subtitle){
 $s=$doc.Slides.Add($doc.Slides.Count+1,12);$s.FollowMasterBackground=0;$s.Background.Fill.Solid();$s.Background.Fill.ForeColor.RGB=(Color '151719')
 [void](Text $s $title 56 42 830 60 32 'FFFFFF' $true)
 [void](Text $s $subtitle 58 104 820 36 15 'A9AFB5')
 [void](Text $s '旁门工具箱  /  PowerPoint 实例' 58 494 770 25 12 '81878D')
 $s.SlideShowTransition.AdvanceOnTime=-1;$s.SlideShowTransition.AdvanceTime=5;return $s
}
function NewDoc($app){$p=$app.Presentations.Add(0);$p.PageSetup.SlideWidth=960;$p.PageSetup.SlideHeight=540;return $p}
function SaveVideo($p,[string]$name){
 $p.SaveAs((Join-Path $OutputDir ($name+'.pptx')),24)
 $p.Slides.Item(1).Export((Join-Path $OutputDir ($name+'.png')),'PNG',1440,810)
 $p.CreateVideo((Join-Path $OutputDir ($name+'.mp4')),$true,5,720,24,85)
 $deadline=[DateTime]::UtcNow.AddMinutes(6)
 do{Start-Sleep -Milliseconds 400;$status=$p.CreateVideoStatus}while($status -in @(1,2) -and [DateTime]::UtcNow -lt $deadline)
 if($status -ne 3){throw "Video export failed: $name ($status)"};Write-Output "Rendered $name in PowerPoint"
}
$app=New-Object -ComObject PowerPoint.Application;$owned=@()
try{
 if(-not $MaterialsOnly){
 $p=NewDoc $app;$owned+=,$p;$s=Base $p '轰然坠落' '急速坠落、落地震动与尘雾扩散。适合产品、章节标题与重点登场。'
 $target=$s.Shapes.AddShape(5,355,216,250,170);$target.Fill.Solid();$target.Fill.ForeColor.RGB=(Color 'FF5500');$target.Line.Visible=0
 $target.TextFrame.TextRange.Text='登场。';$target.TextFrame.TextRange.Font.Name='Microsoft YaHei';$target.TextFrame.TextRange.Font.Size=40;$target.TextFrame.TextRange.Font.Bold=-1;$target.TextFrame.TextRange.Font.Color.RGB=(Color 'FFFFFF');$target.TextFrame.VerticalAnchor=3;$target.TextFrame.TextRange.ParagraphFormat.Alignment=2
 $plan=[pscustomobject]@{id='anvil';mode='element';category='entrance';duration=1.8;stagger=0;intensity=1;dust=$true}
 [void](Add-PangSelectionAnimation -Slide $s -Shapes @($target) -Plan $plan -Trigger 2 -Delay .6)
 SaveVideo $p 'anvil';$p.Close();$owned=@()
 $p=NewDoc $app;$owned+=,$p;$s=Base $p '数字滚动' '每一位数字依次滚动停稳。适合金额、里程碑与经营成果。'
 $target=Text $s '128,640' 140 216 680 128 88 'FF6A20' $true;$target.TextFrame.TextRange.ParagraphFormat.Alignment=2
 [void](Text $s '年度成果 · 示例数据' 346 366 350 35 19 'B7BDC2')
 $plan=[pscustomobject]@{id='number-roll';mode='text';category='entrance';duration=2.4;stagger=0;intensity=1}
 [void](Add-PangSelectionAnimation -Slide $s -Shapes @($target) -Plan $plan -Trigger 2 -Delay .6)
 SaveVideo $p 'number-roll';$p.Close();$owned=@()
 }
 $p=NewDoc $app;$owned+=,$p
 foreach($kind in @('gradient','glass')){
  $title=$(if($kind -eq 'gradient'){'弥散渐变 · 卡片与数据展示'}else{'液态玻璃 · 信息叠层'})
  $sub=$(if($kind -eq 'gradient'){'同一个形状，使用不同色光预设。文字保持独立编辑。'}else{'玻璃材质采样背景，呈现折射、柔化与边缘高光。'})
  $s=Base $p $title $sub
  $keys=$(if($kind -eq 'gradient'){@('blue','purple','aurora')}else{@('glass','mistLens','cloudPane')})
  $labels=$(if($kind -eq 'gradient'){@('深海蓝光','紫晶辉光','极光弥散')}else{@('清透玻璃','雾面透镜','云蓝玻璃')})
  for($i=0;$i -lt 3;$i++){
   $x=58+$i*286
   [void]$s.Shapes.AddPicture((Join-Path $OutputDir ('material-'+$keys[$i]+'.png')),0,-1,$x,181,270,207)
   if($kind -eq 'gradient'){
    [void](Text $s (@('功能介绍','成果汇报','章节过渡')[$i]) ($x+24) 217 225 36 21 'FFFFFF' $true)
    [void](Text $s (@('CREATE','+28%','START')[$i]) ($x+24) 269 225 61 37 'FFFFFF' $true)
    [void](Text $s '示例内容 · 可编辑文字' ($x+24) 341 225 24 12 'D1DBED')
   }else{
    [void](Text $s (@('项目概览','关键进展','下一步')[$i]) ($x+55) 243 170 36 20 'FFFFFF' $true)
    [void](Text $s '示例信息' ($x+55) 287 170 26 13 'FFFFFF')
   }
   [void](Text $s $labels[$i] ($x+6) 409 260 35 19 'E6E9EC')
  }
  $s.Export((Join-Path $OutputDir ($kind+'.png')),'PNG',1440,810)
 }
 $p.SaveAs((Join-Path $OutputDir 'materials.pptx'),24);$p.Close();$owned=@()
 $p=NewDoc $app;$owned+=,$p
 foreach($file in @('anvil.pptx','number-roll.pptx','materials.pptx')){[void]$p.Slides.InsertFromFile((Join-Path $OutputDir $file),$p.Slides.Count)}
 $p.SaveAs((Join-Path $OutputDir 'pangmen-toolbox-examples.pptx'),24)
 Write-Output 'Saved four-slide example deck'
}finally{foreach($doc in $owned){try{$doc.Saved=-1;$doc.Close()}catch{}};[void][Runtime.InteropServices.Marshal]::ReleaseComObject($app);[ShowcaseMessageFilter]::Revoke()}

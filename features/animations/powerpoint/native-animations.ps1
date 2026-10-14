# Pangmen native PowerPoint animation library. Dot-source this file.
# No application, presentation, window, or COM session is created or closed here.
# Sources checked 2026-09-13:
# https://learn.microsoft.com/en-us/office/vba/api/powerpoint.sequence.addeffect
# https://learn.microsoft.com/en-us/office/vba/api/powerpoint.animationpoint.time
# https://learn.microsoft.com/en-us/office/vba/api/powerpoint.msoanimproperty
# https://learn.microsoft.com/en-us/office/vba/api/powerpoint.msoanimtype
# https://learn.microsoft.com/en-us/office/vba/api/powerpoint.scaleeffect
# https://learn.microsoft.com/en-us/office/vba/api/powerpoint.motioneffect.path
# Anvil timing reference, independent reimplementation of its mathematical motion:
# https://github.com/1998code/Keynote2Website/blob/69b741fff2d620b25b823ee40f381f5c2bc4e17e/assets/player/main.js

if (-not ('Pangmen.Motion.NativeTrackWriter' -as [type])) {
    Add-Type -Path (Join-Path $PSScriptRoot 'NativeTrackWriter.cs') -ReferencedAssemblies @('Microsoft.CSharp','System.Core')
}

$script:PangAnim = @{
    Custom = 0; Appear = 1; Fade = 10; Wipe = 22; Flip = 51
    Motion = 1; Color = 2; Scale = 3; Rotation = 4; Property = 5; Set = 8
    X = 1; Y = 2; Width = 3; Height = 4; Opacity = 5; Angle = 6; Visibility = 8
    FillColor = 1005; TextColor = 101
    OnClick = 1; WithPrevious = 2; AfterPrevious = 3
}
$script:PangEmphasisSeeds = @{}

function New-PangEffect {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Slide,
        [Parameter(Mandatory)] $Shape,
        [ValidateRange(0.001, 600)] [double] $Duration = 1,
        [ValidateRange(0, 3600)] [double] $Delay = 0,
        [ValidateSet(1, 2, 3)] [int] $Trigger = 2,
        [int] $EffectId = 0,
        [switch] $Exit,
        [switch] $Emphasis
    )
    if ($Exit -and $Emphasis) { throw 'An effect cannot be both emphasis and exit.' }
    # Custom=0 is an entrance in PowerPoint and hides its target before start.
    # Seed custom emphasis with a native Grow/Shrink preset (emphasis class),
    # then remove its neutral seed after the first real track has been added.
    if ($Emphasis -and $EffectId -eq 0) { $EffectId = 59 }
    $effect = $Slide.TimeLine.MainSequence.AddEffect($Shape, $EffectId, 0, $Trigger)
    if ($Exit) { $effect.Exit = -1 }
    if ($Emphasis) {
        $seedBehaviors = @()
        for ($i = 1; $i -le $effect.Behaviors.Count; $i++) {
            $seed = $effect.Behaviors.Item($i)
            if ($seed.Type -eq 3) {
                $seed.ScaleEffect.FromX = [single]100
                $seed.ScaleEffect.FromY = [single]100
                $seed.ScaleEffect.ToX = [single]100
                $seed.ScaleEffect.ToY = [single]100
            }
            $seedBehaviors += $seed
        }
        $key = [Runtime.CompilerServices.RuntimeHelpers]::GetHashCode($effect)
        $script:PangEmphasisSeeds[$key] = $seedBehaviors
    }
    # Setting Exit may reset COM timings, so it must precede these assignments.
    $effect.Timing.Duration = [single]$Duration
    $effect.Timing.TriggerDelayTime = [single]$Delay
    $effect.Timing.Accelerate = [single]0
    $effect.Timing.Decelerate = [single]0
    $effect.Timing.SmoothStart = 0
    $effect.Timing.SmoothEnd = 0
    return $effect
}

function Reset-PangEntryVisibility {
    param([Parameter(Mandatory)] $Effect)
    $key = [Runtime.CompilerServices.RuntimeHelpers]::GetHashCode($Effect)
    if ($script:PangEmphasisSeeds.ContainsKey($key)) {
        foreach ($seed in $script:PangEmphasisSeeds[$key]) { $seed.Delete() }
        $script:PangEmphasisSeeds.Remove($key)
    }
    if ($Effect.EffectType -ne 0 -or $Effect.Exit -eq -1) { return }
    # Do this after adding a duration-bearing track. If the default setter is
    # the only behavior, shrinking it could also shrink Effect.Timing.Duration.
    for ($i = 1; $i -le $Effect.Behaviors.Count; $i++) {
        $behavior = $Effect.Behaviors.Item($i)
        if ($behavior.Type -eq $script:PangAnim.Set -and $behavior.SetEffect.Property -eq $script:PangAnim.Visibility) {
            $behavior.Timing.Duration = [single]0.001
            $behavior.Timing.TriggerDelayTime = [single]0
        }
    }
}

function Add-PangPropertyTrack {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Effect,
        [Parameter(Mandatory)] [int] $PropertyId,
        [Parameter(Mandatory)] [object[]] $Frames,
        [switch] $Smooth
    )
    if ($Frames.Count -lt 2) { throw 'A property track needs at least two frames.' }
    $previousTime = -1.0
    foreach ($frame in $Frames) {
        $time = [double]$frame.t
        if ([double]::IsNaN($time) -or [double]::IsInfinity($time) -or $time -lt 0 -or $time -gt 1 -or $time -le $previousTime) {
            throw 'Frame times must be finite, strictly increasing, and in the range 0..1.'
        }
        if ($null -eq $frame.v) { throw 'Each frame must contain t and v.' }
        $previousTime = $time
    }
    if ($PropertyId -eq $script:PangAnim.Opacity -and $Effect.Exit -eq -1) {
        # Office ignores interpolated style.opacity on several native shape fills.
        # Use its native fade filter so the complete shape fades during the motion.
        # The existing end-of-effect visibility setter still hides the final result.
        $duration=[single]$Effect.Timing.Duration
        $fade=$Effect.Behaviors.Add(7)
        $fade.FilterEffect.Type=8
        $fade.FilterEffect.Reveal=0
        $fade.Timing.Duration=$duration
        $fade.Timing.TriggerDelayTime=[single]0
        $fade.Timing.Accelerate=[single].25
        $fade.Timing.Decelerate=[single].25
        return $fade
    }
    $times = [single[]]@($Frames | ForEach-Object { [single]$_.t })
    $values = [object[]]@($Frames | ForEach-Object { $_.v })
    $behavior = [Pangmen.Motion.NativeTrackWriter]::AddProperty($Effect, $PropertyId, $times, $values, [bool]$Smooth)

    Reset-PangEntryVisibility -Effect $Effect
    return $behavior
}

function Add-PangMotionPath {
    [CmdletBinding()]
    param([Parameter(Mandatory)] $Effect, [Parameter(Mandatory)] [string] $Path)
    $desiredDuration = [single]$Effect.Timing.Duration
    $behavior = $Effect.Behaviors.Add($script:PangAnim.Motion)
    $behavior.Timing.Duration = $desiredDuration
    $behavior.MotionEffect.Path = $Path
    Reset-PangEntryVisibility -Effect $Effect
    return $behavior
}

function Add-PangMove {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Effect,
        [double] $FromX = 0, [double] $FromY = 0,
        [double] $ToX = 0, [double] $ToY = 0
    )
    # MotionEffect coordinates use fractions of the slide width / height.
    $desiredDuration = [single]$Effect.Timing.Duration
    $behavior = $Effect.Behaviors.Add($script:PangAnim.Motion)
    $behavior.Timing.Duration = $desiredDuration
    $behavior.MotionEffect.FromX = [single]$FromX
    $behavior.MotionEffect.FromY = [single]$FromY
    $behavior.MotionEffect.ToX = [single]$ToX
    $behavior.MotionEffect.ToY = [single]$ToY
    Reset-PangEntryVisibility -Effect $Effect
    return $behavior
}

function Add-PangRotation {
    [CmdletBinding()]
    param([Parameter(Mandatory)] $Effect, [double] $From = 0, [double] $To = 0)
    $desiredDuration = [single]$Effect.Timing.Duration
    $behavior = $Effect.Behaviors.Add($script:PangAnim.Rotation)
    $behavior.Timing.Duration = $desiredDuration
    $behavior.RotationEffect.From = [single]$From
    $behavior.RotationEffect.To = [single]$To
    Reset-PangEntryVisibility -Effect $Effect
    return $behavior
}

function Add-PangScale {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Effect,
        [double] $FromX = 1, [double] $FromY = 1,
        [double] $ToX = 1, [double] $ToY = 1
    )
    # Public API uses ratios. COM ScaleEffect uses percentages, unlike MotionEffect.
    $desiredDuration = [single]$Effect.Timing.Duration
    $behavior = $Effect.Behaviors.Add($script:PangAnim.Scale)
    $behavior.Timing.Duration = $desiredDuration
    $behavior.ScaleEffect.FromX = [single](100 * $FromX)
    $behavior.ScaleEffect.FromY = [single](100 * $FromY)
    $behavior.ScaleEffect.ToX = [single](100 * $ToX)
    $behavior.ScaleEffect.ToY = [single](100 * $ToY)
    Reset-PangEntryVisibility -Effect $Effect
    return $behavior
}

function Add-PangVisibility {
    [CmdletBinding()]
    param([Parameter(Mandatory)] $Effect, [bool] $Visible = $true)
    $behavior = $Effect.Behaviors.Add($script:PangAnim.Set)
    $behavior.Timing.Duration = [single]0.001
    $behavior.Timing.TriggerDelayTime = [single]0
    $behavior.SetEffect.Property = $script:PangAnim.Visibility
    $behavior.SetEffect.To = $(if ($Visible) { 'visible' } else { 'hidden' })
    return $behavior
}

function Add-PangTransformTracks {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Effect,
        [Parameter(Mandatory)] $Shape,
        [Parameter(Mandatory)] [ValidateRange(1, 100000)] [double] $SlideWidth,
        [Parameter(Mandatory)] [ValidateRange(1, 100000)] [double] $SlideHeight,
        [Parameter(Mandatory)] [object[]] $Frames,
        [ValidateSet('Absolute', 'Expression')] [string] $PositionMode = 'Absolute'
    )
    # x/y are offsets in points from the saved shape centre; sx/sy are ratios.
    # Native ppt_x/y/w/h values are normalized to the slide; rotation is degrees.
    $cx = ([double]$Shape.Left + [double]$Shape.Width / 2) / $SlideWidth
    $cy = ([double]$Shape.Top + [double]$Shape.Height / 2) / $SlideHeight
    $baseWidth = [double]$Shape.Width / $SlideWidth
    $baseHeight = [double]$Shape.Height / $SlideHeight
    $invariant = [Globalization.CultureInfo]::InvariantCulture
    foreach ($channel in @('x', 'y', 'sx', 'sy', 'r', 'opacity')) {
        $baseline=0;if($channel -in @('sx','sy','opacity')){$baseline=1}
        $varying=@($Frames | Where-Object {$null -ne $_[$channel] -and [Math]::Abs([double]$_[$channel]-$baseline) -gt 0.0000001})
        if($varying.Count -eq 0){continue}
        $track = @()
        foreach ($frame in $Frames) {
            if ($null -eq $frame[$channel]) { continue }
            $value = [double]$frame[$channel]
            if ([double]::IsNaN($value) -or [double]::IsInfinity($value)) { throw "Invalid $channel value." }
            switch ($channel) {
                'x' {
                    $value = $value / $SlideWidth
                    if ($PositionMode -eq 'Expression') { $value = '#ppt_x' + $(if ($value -ge 0) { '+' } else { '' }) + $value.ToString('R', $invariant) }
                    else { $value += $cx }
                    $id = $script:PangAnim.X
                }
                'y' {
                    $value = $value / $SlideHeight
                    if ($PositionMode -eq 'Expression') { $value = '#ppt_y' + $(if ($value -ge 0) { '+' } else { '' }) + $value.ToString('R', $invariant) }
                    else { $value += $cy }
                    $id = $script:PangAnim.Y
                }
                'sx' { if ($PositionMode -eq 'Expression') { $value = '#ppt_w*' + $value.ToString('R', $invariant) } else { $value *= $baseWidth }; $id = $script:PangAnim.Width }
                'sy' { if ($PositionMode -eq 'Expression') { $value = '#ppt_h*' + $value.ToString('R', $invariant) } else { $value *= $baseHeight }; $id = $script:PangAnim.Height }
                'r' { $value += [double]$Shape.Rotation; $id = $script:PangAnim.Angle }
                'opacity' { $id = $script:PangAnim.Opacity }
            }
            $track += @{ t = [double]$frame.t; v = $value }
        }
        if ($track.Count -gt 1) { [void](Add-PangPropertyTrack -Effect $Effect -PropertyId $id -Frames $track) }
    }
    return $Effect
}

function New-PangSampledFrames {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [scriptblock] $Sampler, [ValidateRange(2, 600)] [int] $Samples = 61)
    for ($i = 0; $i -lt $Samples; $i++) {
        $t = $i / [double]($Samples - 1)
        $frame = & $Sampler $t
        $frame.t = $t
        $frame
    }
}

function Get-PangAnvilFrames {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [double] $DropDistance,
        [Parameter(Mandatory)] [double] $SlideWidth,
        [Parameter(Mandatory)] [double] $SlideHeight,
        [ValidateRange(0.2, 30)] [double] $Duration = 1.8,
        [ValidateRange(0, 3)] [double] $Intensity = 1,
        [ValidateRange(0.001, 100000)] [double] $Width = 186,
        [ValidateRange(0.001, 100000)] [double] $Height = 186
    )
    # Include the exact contact time and all 10 shake turning points so a 0.2 s
    # drop does not lose its edge in a uniformly sampled 1.8 s timeline.
    $drop = [Math]::Min(0.2, 0.4 * $Duration)
    $shake = [Math]::Min(0.25, 0.5 * $Duration)
    $objectScale = [Math]::Min($Width, $Height) / 186.0
    $shakeX = [Math]::Min(9.6 * $objectScale, 0.01 * $SlideWidth)
    $shakeY = [Math]::Min(13.5 * $objectScale, 0.025 * $SlideHeight)
    $times = [Collections.Generic.SortedSet[double]]::new()
    [void]$times.Add(0)
    for ($i = 1; $i -le 16; $i++) { [void]$times.Add(($drop * $i / 16)) }
    for ($i = 1; $i -le 10; $i++) { [void]$times.Add(($drop + $shake * $i / 10)) }
    [void]$times.Add($Duration)
    foreach ($time in $times) {
        $x = 0.0; $y = 0.0
        if ($time -lt $drop) {
            $k = $time / $drop
            $y = -$DropDistance * (1 - $k * $k)
        } elseif ($time -lt $drop + $shake) {
            $j = [Math]::Round(10 * ($time - $drop) / $shake)
            $envelope = [Math]::Pow(1 - $j / 10.0, 2)
            $seed = [Math]::Sin(($j + 1) * 127.1 + 31.7) * 43758.5453
            $unit = $seed - [Math]::Floor($seed)
            $x = (2 * $unit - 1) * $envelope * $shakeX * $Intensity
            $y = -$(if ($j % 2) { -1 } else { 1 }) * $envelope * $shakeY * $Intensity
        }
        @{ t = $time / $Duration; x = $x; y = $y }
    }
}

function Get-PangRecipeFrames {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Recipe,
        [double] $Width = 180, [double] $Height = 120,
        [double] $SlideWidth = 960, [double] $SlideHeight = 540,
        [double] $Duration = 1.2,
        [double] $Intensity = 1,
        [double] $Distance = 420,
        [int] $Direction = 4,
        [string] $DirectionName = 'up',
        [double] $DirectionAngle = [double]::NaN,
        [switch] $Exit
    )
    if ($Recipe -eq 'anvil') {
        return Get-PangAnvilFrames -DropDistance $Distance -SlideWidth $SlideWidth -SlideHeight $SlideHeight -Duration $Duration -Intensity $Intensity -Width $Width -Height $Height
    }
    $sampler = {
        param($p)
        $q = $(if ($Exit) { 1 - $p } else { $p })
        $ease = $(if ($Exit) { 1 - $p*$p } else { 1 - [Math]::Pow(1 - $q, 3) })
        if ([double]::IsNaN($DirectionAngle)) {
            $DirectionAngle = switch ($DirectionName) { 'up' {0} 'up-right' {45} 'right' {90} 'down-right' {135} 'down' {180} 'down-left' {225} 'left' {270} 'up-left' {315} default {0} }
        }
        $directionRadians = $DirectionAngle * [Math]::PI / 180
        $dx = [Math]::Sin($directionRadians); $dy = -[Math]::Cos($directionRadians)
        switch ($Recipe) {
            'pivot' {
                # Rotate around the chosen corner while keeping the selected object editable.
                $corner = $(if ($DirectionName -in @('top-left','top-right','bottom-left','bottom-right')) { $DirectionName } else { 'bottom-left' })
                $angle = $(if ($corner.EndsWith('right')) { 88 } else { -88 }) * (1 - $ease) * $Intensity
                $rad = $angle * [Math]::PI / 180
                $vx = $(if ($corner.EndsWith('right')) { -$Width / 2 } else { $Width / 2 })
                $vy = $(if ($corner.StartsWith('bottom')) { -$Height / 2 } else { $Height / 2 })
                @{ x = $vx * [Math]::Cos($rad) - $vy * [Math]::Sin($rad) - $vx; y = $vx * [Math]::Sin($rad) + $vy * [Math]::Cos($rad) - $vy; r = $angle; opacity = [Math]::Min(1, $q * 5) }
            }
            'jack' {
                # Animate.css jack-in-the-box design: scale from bottom centre with
                # a damped left/right wobble. This is native 2D, not a 3D renderer.
                $s = 0.1 + 0.9 * $ease
                $r = 30 * [Math]::Exp(-5 * $q) * [Math]::Cos(3 * [Math]::PI * $q) * (1 - $q) * $Intensity
                @{ sx = $s; sy = $s; y = $Height * (1 - $s) / 2; r = $r; opacity = [Math]::Min(1, $q * 5) }
            }
            'roll' {
                $sign=$(if($Exit){1}else{-1})
                @{ x = $sign*$dx*$Distance * (1 - $ease); y = $sign*$dy*$Distance * (1 - $ease); r = $sign*135 * (1 - $ease) * $Intensity; opacity = $(if($Exit){1-$p*$p*(3-2*$p)}else{[Math]::Min(1, $q * 3)}) }
            }
            'grid' {
                @{ y = 24 * (1 - $ease); sx = 0.82 + 0.18 * $ease; sy = 0.82 + 0.18 * $ease; opacity = $ease }
            }
            'text-read' {
                @{ y = 22 * (1 - $ease); opacity = [Math]::Min(1, $q * 2.5) }
            }
            'text-cycle' {
                $edge = 0.22
                if ($p -lt $edge) {
                    $a = 1 - [Math]::Pow(1 - $p / $edge, 3)
                    @{ y = $Height * 0.7 * (1 - $a); opacity = $a }
                } elseif ($p -gt 1 - $edge) {
                    $a = ($p - 1 + $edge) / $edge
                    @{ y = -$Height * 0.7 * $a * $a; opacity = 1 - $a }
                } else { @{ y = 0; opacity = 1 } }
            }
            'flip' {
                # Native shape widths provide a front-only hinge illusion. Use two
                # faces with complementary visibility for an actual two-sided card.
                $progress=$p*$p*(3-2*$p)
                $widthRatio = [Math]::Max(0.012, [Math]::Abs([Math]::Cos(2 * [Math]::PI * $progress)))
                $scale=1-.12*$Intensity*[Math]::Pow([Math]::Sin([Math]::PI*$p),2)
                if($DirectionName -eq 'left'){@{sx=$widthRatio*$scale;sy=$scale}}else{@{sx=$scale;sy=$widthRatio*$scale}}
            }
            default { throw "Unknown sampled recipe '$Recipe'." }
        }
    }
    return New-PangSampledFrames -Sampler $sampler -Samples 61
}

function Add-PangRecipe {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Slide,
        [Parameter(Mandatory)] $Shape,
        [Parameter(Mandatory)] [ValidateSet('anvil', 'pivot', 'jack', 'roll', 'grid', 'text-read', 'text-cycle', 'flip', 'line-draw', 'color-sweep', 'number-roll', 'flow-dots')] [string] $Recipe,
        [ValidateRange(0.2, 30)] [double] $Duration = 1.2,
        [ValidateRange(0, 3600)] [double] $Delay = 0,
        [ValidateSet(1, 2, 3)] [int] $Trigger = 2,
        [double] $SlideWidth = 960,
        [double] $SlideHeight = 540,
        [double] $Intensity = 1,
        [double] $Distance = 420,
        [int] $Direction = 4,
        [string] $DirectionName = 'up',
        [double] $DirectionAngle = [double]::NaN,
        [switch] $Exit
    )
    if ($Recipe -in @('line-draw', 'color-sweep')) {
        # The color-sweep target is a colored overlay supplied by the caller;
        # line-draw should be called once per ordered stroke / path segment.
        $effect = New-PangEffect -Slide $Slide -Shape $Shape -Duration $Duration -Delay $Delay -Trigger $Trigger -EffectId $script:PangAnim.Wipe -Exit:$Exit
        $effect.EffectParameters.Direction = $Direction
        return $effect
    }
    $effect = New-PangEffect -Slide $Slide -Shape $Shape -Duration $Duration -Delay $Delay -Trigger $Trigger -Exit:$Exit -Emphasis:($Recipe -eq 'flip')
    try {
        if ($Recipe -eq 'number-roll') {
            # The caller supplies a clipped / masked digit strip. Position values
            # are editable, and changing number formatting requires regeneration.
            $frames = New-PangSampledFrames -Samples 61 -Sampler {
                param($p)
                @{ y = $Distance * (1 - [Math]::Pow(1 - $p, 4)) }
            }
        } elseif ($Recipe -eq 'flow-dots') {
            $frames = New-PangSampledFrames -Samples 61 -Sampler {
                param($p)
                @{ x = $Distance * $p; opacity = [Math]::Min(1, [Math]::Min($p * 8, (1 - $p) * 8)) }
            }
            $effect.Timing.RepeatCount = [single]2
        } else {
            if ($Recipe -eq 'anvil' -and -not $PSBoundParameters.ContainsKey('Distance')) {
                $Distance = [double]$Shape.Top + [double]$Shape.Height + 2
            }
            $frames = Get-PangRecipeFrames -Recipe $Recipe -Width $Shape.Width -Height $Shape.Height -SlideWidth $SlideWidth -SlideHeight $SlideHeight -Duration $Duration -Intensity $Intensity -Distance $Distance -Direction $Direction -DirectionName $DirectionName -DirectionAngle $DirectionAngle -Exit:$Exit
        }
        # Use one native, uniform scale behavior for staggered pictures. Writing
        # independent absolute width/height tracks can restore stale dimensions
        # and does not reliably preserve the picture's displayed crop/ratio.
        if ($Recipe -eq 'grid') {
            foreach ($frame in $frames) {$frame.Remove('sx');$frame.Remove('sy')}
            $from = $(if ($Exit) { 1.0 } else { .82 })
            $to = $(if ($Exit) { .82 } else { 1.0 })
            $scale = Add-PangScale -Effect $effect -FromX $from -FromY $from -ToX $to -ToY $to
            if ($Exit) {$scale.Timing.Accelerate=[single]1} else {$scale.Timing.Decelerate=[single]1}
        }
        $positionMode = $(if ($Recipe -eq 'grid') { 'Expression' } else { 'Absolute' })
        [void](Add-PangTransformTracks -Effect $effect -Shape $Shape -SlideWidth $SlideWidth -SlideHeight $SlideHeight -Frames $frames -PositionMode $positionMode)
        return $effect
    } catch {
        # Only roll back the effect created by this function, never existing work.
        try { $effect.Delete() } catch { }
        throw
    }
}

function Get-PangNamedShape {
    [CmdletBinding()]
    param([Parameter(Mandatory)] $Slide, [Parameter(Mandatory)] [string] $Name)
    for ($i = 1; $i -le $Slide.Shapes.Count; $i++) {
        $shape = $Slide.Shapes.Item($i)
        if ($shape.Name -eq $Name) { return $shape }
    }
    throw "Required demo shape '$Name' was not found on slide $($Slide.SlideIndex)."
}

function Add-PangShowHide {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Slide, [Parameter(Mandatory)] $Shape,
        [double] $Start = 0, [double] $End = -1
    )
    if ($End -ge 0 -and $End -le $Start) { throw 'A visibility window must end after it starts.' }
    [void](New-PangEffect -Slide $Slide -Shape $Shape -EffectId 1 -Duration 0.001 -Delay $Start)
    if ($End -ge 0) {
        [void](New-PangEffect -Slide $Slide -Shape $Shape -EffectId 1 -Duration 0.001 -Delay $End -Exit)
    }
}

function Add-PangCloudFrames {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Slide,
        [Parameter(Mandatory)] [object[]] $Frames,
        [double] $Start = 0.7,
        [double] $SlideWidth = 960, [double] $SlideHeight = 540
    )
    $index = 0
    foreach ($frame in $Frames) {
        if (-not (Test-Path -LiteralPath $frame.file -PathType Leaf)) { throw "Missing cloud frame: $($frame.file)" }
        if ([double]$frame.duration -le 0) { throw 'Cloud frame durations must be positive.' }
        $picture = $Slide.Shapes.AddPicture([string]$frame.file, 0, -1, 0, 0, [single]$SlideWidth, [single]$SlideHeight)
        $picture.Name = 'PANG_CLOUD_' + $index.ToString('000')
        $begin = $Start + [double]$frame.time
        Add-PangShowHide -Slide $Slide -Shape $picture -Start $begin -End ($begin + [double]$frame.duration)
        $index++
    }
    return $index
}

function Add-PangNumberDemo {
    [CmdletBinding()]
    param([Parameter(Mandatory)] $Slide, [double] $Start = 0.5, [double] $Duration = 3.5)
    # The caller owns this generated demo. Only its explicitly named placeholder
    # is replaced; this function must not be used to alter arbitrary user slides.
    $placeholder = Get-PangNamedShape -Slide $Slide -Name 'PANG_NUMBER_TARGET'
    $left = [double]$placeholder.Left
    $top = [double]$placeholder.Top
    $windowWidth = [double]$placeholder.Width
    $cellHeight = [double]$placeholder.Height
    $fontSize = [double]$placeholder.TextFrame.TextRange.Font.Size
    $placeholder.Delete()
    $orange = 0x0055FF
    $background = 0x212325
    $digitWidth = 55.0
    $commaWidth = 25.0
    $cursor = $left
    $target = '12860'
    $digitGroups = @()
    for ($digitIndex = 0; $digitIndex -lt $target.Length; $digitIndex++) {
        if ($digitIndex -eq 2) {
            $comma = $Slide.Shapes.AddTextbox(1, [single]$cursor, [single]$top, [single]$commaWidth, [single]$cellHeight)
            $comma.Name = 'PANG_NUMBER_SEPARATOR'
            $comma.TextFrame.AutoSize = 0
            $comma.TextFrame.WordWrap = 0
            $comma.TextFrame.MarginLeft = 0; $comma.TextFrame.MarginRight = 0
            $comma.TextFrame.MarginTop = 0; $comma.TextFrame.MarginBottom = 0
            $comma.TextFrame.VerticalAnchor = 3
            $comma.TextFrame.TextRange.Text = ','
            $comma.TextFrame.TextRange.Font.Name = 'Microsoft YaHei'
            $comma.TextFrame.TextRange.Font.Size = [single]$fontSize
            $comma.TextFrame.TextRange.Font.Bold = -1
            $comma.TextFrame.TextRange.Font.Color.RGB = $orange
            $comma.Left = [single]$cursor; $comma.Top = [single]$top
            $comma.Width = [single]$commaWidth; $comma.Height = [single]$cellHeight
            $cursor += $commaWidth
        }
        $steps = 10 + [int]::Parse($target.Substring($digitIndex, 1))
        $names = @()
        for ($row = 0; $row -le $steps; $row++) {
            $digit = $Slide.Shapes.AddTextbox(1, [single]$cursor, [single]($top + $row * $cellHeight), [single]$digitWidth, [single]$cellHeight)
            $digit.Name = "PANG_DIGIT_${digitIndex}_$row"
            $digit.TextFrame.AutoSize = 0
            $digit.TextFrame.WordWrap = 0
            $digit.TextFrame.MarginLeft = 0; $digit.TextFrame.MarginRight = 0
            $digit.TextFrame.MarginTop = 0; $digit.TextFrame.MarginBottom = 0
            $digit.TextFrame.VerticalAnchor = 3
            $digit.TextFrame.TextRange.Text = [string]($row % 10)
            $digit.TextFrame.TextRange.Font.Name = 'Microsoft YaHei'
            $digit.TextFrame.TextRange.Font.Size = [single]$fontSize
            $digit.TextFrame.TextRange.Font.Bold = -1
            $digit.TextFrame.TextRange.Font.Color.RGB = $orange
            $digit.TextFrame.TextRange.ParagraphFormat.Alignment = 2
            # Font changes in an AutoSize textbox can shift Top as well as its
            # height. Keep every glyph on the exact same fixed grid as the mask.
            $digit.Left = [single]$cursor; $digit.Top = [single]($top + $row * $cellHeight)
            $digit.Width = [single]$digitWidth; $digit.Height = [single]$cellHeight
            $names += $digit.Name
        }
        $group = $Slide.Shapes.Range([object[]]$names).Group()
        $group.Name = 'PANG_NUMBER_STRIP_' + $digitIndex
        $digitGroups += $group
        [void](Add-PangRecipe -Slide $Slide -Shape $group -Recipe number-roll -Duration ($Duration - $digitIndex * 0.12) -Delay ($Start + $digitIndex * 0.12) -Distance (-$steps * $cellHeight))
        $cursor += $digitWidth
    }
    # Solid masks are part of this dark-background demo, not universal clipping.
    $topMask = $Slide.Shapes.AddShape(1, [single]($left - 1), 0, [single]($windowWidth + 2), [single]$top)
    $topMask.Name = 'PANG_NUMBER_MASK_TOP'
    $bottomMask = $Slide.Shapes.AddShape(1, [single]($left - 1), [single]($top + $cellHeight), [single]($windowWidth + 2), [single](540 - $top - $cellHeight))
    $bottomMask.Name = 'PANG_NUMBER_MASK_BOTTOM'
    foreach ($mask in @($topMask, $bottomMask)) {
        $mask.Fill.Solid()
        $mask.Fill.ForeColor.RGB = $background
        $mask.Line.Visible = 0
    }
    foreach ($name in @('PANG_TITLE', 'PANG_DESCRIPTION', 'PANG_FOOTER', 'PANG_NUMBER_LABEL')) {
        $foreground = Get-PangNamedShape -Slide $Slide -Name $name
        $foreground.ZOrder(0)
    }
    return [pscustomobject]@{ DigitGroups = $digitGroups.Count; Target = '12,860'; Masks = 2; Editable = $true }
}

function Add-PangFontColorEffect {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Slide,
        [Parameter(Mandatory)] $Shape,
        [double] $Duration = 0.22,
        [double] $Delay = 0,
        [int] $FromRgb = 0x9CA5AD,
        [int] $ToRgb = 0x0055FF
    )
    # Native Change Font Color is already an emphasis preset. Use its ColorFormat
    # properties instead of integer-valued custom font-color animation points.
    # RGB parameters are Office RGB integers (R + G*256 + B*65536).
    $Shape.TextFrame.TextRange.Font.Color.RGB = [int]$FromRgb
    $effect = New-PangEffect -Slide $Slide -Shape $Shape -EffectId 56 -Duration $Duration -Delay $Delay
    $colorBehaviorFound = $false
    for ($i = 1; $i -le $effect.Behaviors.Count; $i++) {
        $behavior = $effect.Behaviors.Item($i)
        if ($behavior.Type -eq $script:PangAnim.Color) {
            $behavior.ColorEffect.From.RGB = [int]$FromRgb
            $behavior.ColorEffect.To.RGB = [int]$ToRgb
            $colorBehaviorFound = $true
        }
    }
    if (-not $colorBehaviorFound) {
        # Retain the native preset on hosts exposing its color through parameters.
        $effect.EffectParameters.Color2.RGB = [int]$ToRgb
    }
    return $effect
}

function Add-PangReadingDemo {
    [CmdletBinding()]
    param([Parameter(Mandatory)] $Slide)
    $words = @()
    for ($i = 0; $i -lt 4; $i++) {
        $words += Get-PangNamedShape -Slide $Slide -Name "PANG_WORD_$i"
    }
    for ($i = 0; $i -lt 4; $i++) {
        [void](Add-PangFontColorEffect -Slide $Slide -Shape $words[$i] -Duration 0.22 -Delay (0.5 + $i * 0.9))
    }
    return [pscustomobject]@{ Words = 4; Preset = 'ChangeFontColor'; EffectId = 56; InitiallyVisible = $true }
}

function Add-PangDemoAnimations {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Presentation,
        [object] $CloudManifest,
        [ValidateRange(5.5, 60)] [double] $SecondsPerSlide = 6
    )
    if ($Presentation.Slides.Count -ne 12) { throw 'This scheduler requires the generated 12-slide demo.' }
    if ($Presentation.Tags.Item('PANG_NATIVE_DEMO') -eq '1') { throw 'Animations already applied; regenerate the base demo before reapplying.' }
    $width = [double]$Presentation.PageSetup.SlideWidth
    $height = [double]$Presentation.PageSetup.SlideHeight
    if ([Math]::Abs($width - 960) -gt 0.5 -or [Math]::Abs($height - 540) -gt 0.5) {
        throw 'The demo requires a 960 x 540 pt slide size.'
    }
    $results = @()
    for ($slideIndex = 1; $slideIndex -le 12; $slideIndex++) {
        $slide = $Presentation.Slides.Item($slideIndex)
        if ($slide.TimeLine.MainSequence.Count -gt 0) { throw "Slide $slideIndex already has animations; this scheduler only accepts a fresh generated deck." }
        switch ($slideIndex) {
            1 {
                $shape = Get-PangNamedShape -Slide $slide -Name 'PANG_TARGET'
                [void](Add-PangRecipe -Slide $slide -Shape $shape -Recipe anvil -Duration 1.8 -Delay 0.5)
                if ($null -ne $CloudManifest) {
                    $frames = $(if ($CloudManifest -is [string]) { @(Get-Content -LiteralPath $CloudManifest -Raw -Encoding UTF8 | ConvertFrom-Json) } else { @($CloudManifest) })
                    [void](Add-PangCloudFrames -Slide $slide -Frames $frames -Start 0.7)
                }
            }
            2 {
                $shape = Get-PangNamedShape -Slide $slide -Name 'PANG_TARGET'
                [void](Add-PangRecipe -Slide $slide -Shape $shape -Recipe pivot -Duration 1.2 -Delay 0.5)
                [void](Add-PangRecipe -Slide $slide -Shape $shape -Recipe pivot -Duration 1 -Delay 3.5 -Exit)
            }
            3 {
                for ($i = 0; $i -lt 6; $i++) {
                    $shape = Get-PangNamedShape -Slide $slide -Name "PANG_LINE_$i"
                    [void](Add-PangRecipe -Slide $slide -Shape $shape -Recipe line-draw -Duration 0.32 -Delay (0.5 + $i * 0.3))
                    [void](Add-PangRecipe -Slide $slide -Shape $shape -Recipe line-draw -Duration 0.25 -Delay (3.5 + $i * 0.22) -Exit)
                }
            }
            4 {
                $shape = Get-PangNamedShape -Slide $slide -Name 'PANG_TARGET'
                [void](Add-PangRecipe -Slide $slide -Shape $shape -Recipe flip -Duration 1.7 -Delay 0.5)
            }
            5 {
                $shape = Get-PangNamedShape -Slide $slide -Name 'PANG_TARGET'
                [void](Add-PangRecipe -Slide $slide -Shape $shape -Recipe jack -Duration 1.3 -Delay 0.5)
            }
            6 {
                $shape = Get-PangNamedShape -Slide $slide -Name 'PANG_TARGET'
                [void](Add-PangRecipe -Slide $slide -Shape $shape -Recipe roll -Duration 1.2 -Delay 0.5 -Distance 500)
                [void](Add-PangRecipe -Slide $slide -Shape $shape -Recipe roll -Duration 1 -Delay 3.5 -Distance -500 -Exit)
            }
            7 {
                $shape = Get-PangNamedShape -Slide $slide -Name 'PANG_OVERLAY'
                [void](Add-PangRecipe -Slide $slide -Shape $shape -Recipe color-sweep -Duration 1.4 -Delay 0.5)
            }
            8 {
                # Centre, cardinal neighbours, then corners.
                $order = @(4, 1, 3, 5, 7, 0, 2, 6, 8)
                for ($i = 0; $i -lt 9; $i++) {
                    $shape = Get-PangNamedShape -Slide $slide -Name ('PANG_GRID_' + $order[$i])
                    [void](Add-PangRecipe -Slide $slide -Shape $shape -Recipe grid -Duration 0.55 -Delay (0.5 + $i * 0.095))
                    [void](Add-PangRecipe -Slide $slide -Shape $shape -Recipe grid -Duration 0.45 -Delay (3.5 + (8 - $i) * 0.075) -Exit)
                }
            }
            9 {
                for ($i = 0; $i -lt 3; $i++) {
                    $shape = Get-PangNamedShape -Slide $slide -Name "PANG_DOT_$i"
                    [void](Add-PangRecipe -Slide $slide -Shape $shape -Recipe flow-dots -Duration 1.8 -Delay (0.5 + $i * 0.55) -Distance 435)
                }
            }
            10 { [void](Add-PangNumberDemo -Slide $slide) }
            11 { [void](Add-PangReadingDemo -Slide $slide) }
            12 {
                for ($i = 0; $i -lt 3; $i++) {
                    $shape = Get-PangNamedShape -Slide $slide -Name "PANG_CYCLE_$i"
                    $start = 0.5 + $i * 1.65
                    Add-PangShowHide -Slide $slide -Shape $shape -Start $start -End ($start + 1.65)
                    [void](Add-PangRecipe -Slide $slide -Shape $shape -Recipe text-cycle -Duration 1.65 -Delay $start)
                }
            }
        }
        $slide.SlideShowTransition.AdvanceOnClick = 0
        $slide.SlideShowTransition.AdvanceOnTime = -1
        $slide.SlideShowTransition.AdvanceTime = [single]$SecondsPerSlide
        $results += [pscustomobject]@{ Slide = $slideIndex; Shapes = $slide.Shapes.Count; Effects = $slide.TimeLine.MainSequence.Count; Seconds = $SecondsPerSlide }
    }
    $Presentation.Tags.Add('PANG_NATIVE_DEMO', '1')
    return $results
}

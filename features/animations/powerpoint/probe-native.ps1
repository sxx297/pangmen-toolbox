$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject PowerPoint.Application
$presentation = $null
try {
    Write-Output ('PowerPoint ' + $app.Version + ' existing presentations: ' + $app.Presentations.Count)
    $presentation = $app.Presentations.Add(0)
    $slide = $presentation.Slides.Add(1,12)
    $shape = $slide.Shapes.AddShape(1,300,200,180,120)
    $effect = $slide.TimeLine.MainSequence.AddEffect($shape,0,0,2)
    $effect.Timing.Duration = 1.2
    $behavior = $effect.Behaviors.Add(5)
    $property = $behavior.PropertyEffect
    $property.Property = 1
    $point = $property.Points.Add()
    $point.Time = 0
    $point.Value = [single]0.1
    $point = $property.Points.Add()
    $point.Time = 1
    $point.Value = [single]0.5
    $property.Points.Smooth = 0
    Write-Output ('Property points: ' + $property.Points.Count + ', value: ' + $property.Points.Item(1).Value)
    $motion = $effect.Behaviors.Add(1)
    $motion.MotionEffect.Path = 'M 0 0 L 0.1 0 E'
    Write-Output ('Motion path: ' + $motion.MotionEffect.Path)
    $presentation.Saved = -1
} finally {
    if ($presentation) { $presentation.Close() }
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}

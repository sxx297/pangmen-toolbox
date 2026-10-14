using PangmenToolbox.AddIn;
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace PangmenToolbox.Shapes
{
    internal static class BrandAssets
    {
        internal static Bitmap LoadLogo()
        {
            try
            {
                using (var stream = typeof(BrandAssets).Assembly.GetManifestResourceStream("ShapeEffects.Pang.png"))
                {
                    if (stream == null) return null;
                    using (var source = Image.FromStream(stream)) return new Bitmap(source);
                }
            }
            catch (Exception ex) { HostDiagnostics.Log("Brand.Logo", ex.ToString()); return null; }
        }
        internal static Icon LoadIcon()
        {
            try
            {
                using (var logo = LoadLogo())
                {
                    if (logo == null) return null;
                    using (var small = new Bitmap(32, 32))
                    {
                        using (var g = Graphics.FromImage(small))
                        {
                            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                            g.DrawImage(logo, new Rectangle(0, 0, 32, 32));
                        }
                        IntPtr handle = small.GetHicon();
                        try { using (var borrowed = Icon.FromHandle(handle)) return (Icon)borrowed.Clone(); }
                        finally { DestroyIcon(handle); }
                    }
                }
            }
            catch (Exception ex) { HostDiagnostics.Log("Brand.Icon", ex.ToString()); return null; }
        }
        [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
    }
}

using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace PangmenToolbox.AddIn
{
    internal static class FloatingPanelLayout
    {
        [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
        internal static void Apply(Form form, IntPtr owner)
        {
            var area=Screen.FromHandle(owner==IntPtr.Zero ? form.Handle : owner).WorkingArea;
            double scale=1;
            try { scale=Math.Max(1,GetDpiForWindow(owner==IntPtr.Zero ? form.Handle : owner)/96.0); } catch { }
            int margin=Math.Max(12,(int)(16*scale));
            int width=Math.Min((int)(ToolboxTheme.FloatingWidth*scale),area.Width-margin*2);
            int height=Math.Min((int)(ToolboxTheme.FloatingHeight*scale),area.Height-margin*2);
            form.MinimumSize=new Size(Math.Min((int)(760*scale),width),Math.Min((int)(560*scale),height));
            form.Bounds=new Rectangle(area.Left+(area.Width-width)/2,area.Top+(area.Height-height)/2,width,height);
        }
    }
}

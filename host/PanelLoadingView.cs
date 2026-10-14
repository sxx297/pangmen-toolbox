using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace PangmenToolbox.AddIn {
    // One opaque, double-buffered cover until the local editor has laid out and painted.
    internal sealed class PanelLoadingView : Label {
        private readonly Bitmap logo;
        private readonly Timer pulse = new Timer { Interval=40 };
        private readonly System.Diagnostics.Stopwatch clock = new System.Diagnostics.Stopwatch();
        internal const string ReadyScript = "Promise.all([document.fonts.ready,globalThis.PangPanelReady]).then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>chrome.webview.postMessage({type:'toolbox.ui.ready'}))))";
        internal static bool IsReadyMessage(string json) {
            try { var value=new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(json); object type; return value.Count==1 && value.TryGetValue("type",out type) && (type as string)=="toolbox.ui.ready"; } catch { return false; }
        }
        internal PanelLoadingView() {
            Dock=DockStyle.Fill; BackColor=ToolboxTheme.Paper; ForeColor=ToolboxTheme.Muted;
            Font=ToolboxTheme.Font(ToolboxTheme.BodySize); TextAlign=ContentAlignment.MiddleCenter;
            Text="正在加载…"; Padding=new Padding(20); DoubleBuffered=true;
            using(var stream=typeof(PanelLoadingView).Assembly.GetManifestResourceStream("ShapeEffects.Pang.png")) {
                if(stream!=null)using(var source=Image.FromStream(stream))logo=new Bitmap(source);
            }
            pulse.Tick+=(s,e)=>Invalidate();
        }
        private void SyncPulse() {
            if(Visible && IsHandleCreated && Text=="正在加载…") { clock.Start(); pulse.Start(); }
            else { pulse.Stop(); clock.Stop(); }
        }
        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); SyncPulse(); }
        protected override void OnVisibleChanged(EventArgs e) { base.OnVisibleChanged(e); if(pulse!=null)SyncPulse(); }
        protected override void OnTextChanged(EventArgs e) { base.OnTextChanged(e); if(pulse!=null)SyncPulse(); }
        protected override void Dispose(bool disposing) {
            if(disposing) { pulse.Dispose(); if(logo!=null)logo.Dispose(); }
            base.Dispose(disposing);
        }
        private static GraphicsPath Rounded(RectangleF box,float radius) {
            var path=new GraphicsPath();float d=radius*2;
            path.AddArc(box.X,box.Y,d,d,180,90);path.AddArc(box.Right-d,box.Y,d,d,270,90);
            path.AddArc(box.Right-d,box.Bottom-d,d,d,0,90);path.AddArc(box.X,box.Bottom-d,d,d,90,90);
            path.CloseFigure();return path;
        }
        protected override void OnPaint(PaintEventArgs e) {
            if(Text!="正在加载…") { base.OnPaint(e); return; }
            var g=e.Graphics;var saved=g.Save();float scale=DeviceDpi/96f;
            g.ScaleTransform(scale,scale);g.SmoothingMode=SmoothingMode.AntiAlias;
            g.InterpolationMode=InterpolationMode.HighQualityBicubic;
            float width=ClientSize.Width/scale,top=(ClientSize.Height/scale-140)/2;
            var box=new RectangleF((width-56)/2,top,56,56);
            // Use the same transparent, rounded brand artwork as the installed product.
            if(logo!=null)g.DrawImage(logo,box);
            using(var centered=new StringFormat { Alignment=StringAlignment.Center, LineAlignment=StringAlignment.Center })
            using(var title=ToolboxTheme.Font(ToolboxTheme.SectionSize,FontStyle.Bold))
            using(var caption=ToolboxTheme.Font(ToolboxTheme.BodySize))
            using(var ink=new SolidBrush(ToolboxTheme.Ink))
            using(var muted=new SolidBrush(ToolboxTheme.Muted)) {
                g.DrawString("旁门工具箱",title,ink,new RectangleF(12,top+70,width-24,22),centered);
                g.DrawString("正在准备工作区",caption,muted,new RectangleF(12,top+96,width-24,20),centered);
            }
            var rail=new RectangleF((width-72)/2,top+130,72,3);
            using(var path=Rounded(rail,1.5f))using(var brush=new SolidBrush(ToolboxTheme.Line))g.FillPath(brush,path);
            float phase=(float)((1-Math.Cos(clock.Elapsed.TotalSeconds*Math.PI))/2);
            var mark=new RectangleF(rail.X+phase*52,rail.Y,20,3);
            using(var path=Rounded(mark,1.5f))using(var brush=new SolidBrush(ToolboxTheme.Accent))g.FillPath(brush,path);
            g.Restore(saved);
        }
    }
}

using PangmenToolbox.AddIn;
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace PangmenToolbox.Shapes
{
    internal sealed class AboutLinkCard : Button
    {
        private readonly string domain, action;
        private readonly Timer animation = new Timer { Interval = 16 };
        private bool hovered;
        private float progress;
        private static readonly Color Orange = ToolboxTheme.Accent;
        internal AboutLinkCard(string title, string domain, string action)
        {
            Text = title; AccessibleName = title; this.domain = domain; this.action = action;
            Cursor = Cursors.Hand; FlatStyle = FlatStyle.Flat; FlatAppearance.BorderSize = 0;
            BackColor = ToolboxTheme.Paper; UseVisualStyleBackColor = false;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            animation.Tick += (sender, args) =>
            {
                float target = hovered ? 1f : 0f;
                progress += (target - progress) * .25f;
                if (Math.Abs(target - progress) < .01f) { progress = target; animation.Stop(); }
                Invalidate();
            };
        }
        private void Animate() { animation.Start(); Invalidate(); }
        protected override void OnMouseEnter(EventArgs e) { hovered = true; Animate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hovered = false; Animate(); base.OnMouseLeave(e); }
        protected override void OnGotFocus(EventArgs e) { Animate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Animate(); base.OnLostFocus(e); }
        private static Color Mix(Color a, Color b, float t) { return Color.FromArgb((int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t)); }
        private const TextFormatFlags TextFlags = TextFormatFlags.Left | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding;
        private Font CardFont(float pixels, float scale, FontStyle style = FontStyle.Regular)
        {
            // Pixel units keep glyph size and owner-drawn coordinates in the same DPI space.
            return new Font(Font.FontFamily, pixels * scale, style, GraphicsUnit.Pixel);
        }
        public override Size GetPreferredSize(Size proposedSize)
        {
            float s = Width / 284f;
            using (var g = CreateGraphics())
            using (var titleFont = CardFont(ToolboxTheme.SectionSize, s, FontStyle.Bold))
            using (var smallFont = CardFont(ToolboxTheme.BodySize, s))
            {
                var titleSize = TextRenderer.MeasureText(g, Text, titleFont, Size.Empty, TextFlags);
                var domainSize = TextRenderer.MeasureText(g, domain, smallFont, Size.Empty, TextFlags);
                var actionSize = TextRenderer.MeasureText(g, action, smallFont, Size.Empty, TextFlags);
                int width = (int)Math.Ceiling(Math.Max(260*s, Math.Max(Math.Max(titleSize.Width, domainSize.Width)+36*s, actionSize.Width+64*s)));
                int height = (int)Math.Ceiling(Math.Max(156*s, 114*s+titleSize.Height+domainSize.Height+actionSize.Height));
                return new Size(width, height);
            }
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; g.Clear(BackColor); g.SmoothingMode = SmoothingMode.AntiAlias;
            float s = Width / 284f;
            if (Width < 8 || Height < 8) return;
            float d = Math.Min(24*s, Math.Min(Width, Height)/2f), right = Width-2, bottom = Height-2;
            using (var shape = new GraphicsPath())
            using (var fill = new SolidBrush(Mix(Color.White, ToolboxTheme.AccentSoft, progress)))
            using (var edge = new Pen(Mix(ToolboxTheme.Line, Color.FromArgb(255, 169, 123), progress), Focused ? 1.5f*s : s))
            {
                shape.AddArc(1,1,d,d,180,90);shape.AddArc(right-d,1,d,d,270,90);
                shape.AddArc(right-d,bottom-d,d,d,0,90);shape.AddArc(1,bottom-d,d,d,90,90);shape.CloseFigure();
                g.FillPath(fill,shape);g.DrawPath(edge,shape);
            }
            float x=18*s,y=18*s;
            using (var pen = new Pen(Orange,1.5f*s))
            {
                g.DrawEllipse(pen,x,y,20*s,20*s);g.DrawEllipse(pen,x+6*s,y,8*s,20*s);
                g.DrawLine(pen,x,y+10*s,x+20*s,y+10*s);
                float ax=x+((action.Length+1)*ToolboxTheme.BodySize+5)*s,ay=140*s;
                g.DrawLine(pen,ax-7*s,ay+4*s,ax+3*s,ay-6*s);
                g.DrawLine(pen,ax-4*s,ay-6*s,ax+3*s,ay-6*s);
                g.DrawLine(pen,ax+3*s,ay-6*s,ax+3*s,ay+s);
            }
            using (var titleFont = CardFont(ToolboxTheme.SectionSize,s,FontStyle.Bold))
            using (var smallFont = CardFont(ToolboxTheme.BodySize,s))
            {
                int titleHeight=TextRenderer.MeasureText(g,Text,titleFont,Size.Empty,TextFlags).Height+(int)Math.Ceiling(4*s);
                int detailHeight=TextRenderer.MeasureText(g,domain,smallFont,Size.Empty,TextFlags).Height+(int)Math.Ceiling(4*s);
                int titleY=(int)(64*s),domainY=titleY+titleHeight+(int)(4*s);
                var flags=TextFlags|TextFormatFlags.VerticalCenter;
                TextRenderer.DrawText(g,Text,titleFont,new Rectangle((int)x,titleY,Width-(int)(36*s),titleHeight),ToolboxTheme.Ink,flags);
                TextRenderer.DrawText(g,domain,smallFont,new Rectangle((int)x,domainY,Width-(int)(36*s),detailHeight),ToolboxTheme.Muted,flags);
                TextRenderer.DrawText(g,action,smallFont,new Rectangle((int)x,(int)(128*s),Width-(int)(64*s),detailHeight),Orange,flags);
            }
        }
        protected override void Dispose(bool disposing) { if (disposing) animation.Dispose(); base.Dispose(disposing); }
    }
}

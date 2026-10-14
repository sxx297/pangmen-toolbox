using PangmenToolbox.AddIn;
using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

namespace PangmenToolbox.Shapes
{
    internal sealed class AboutWindow : Form
    {
        private Icon brandIcon;
        private Image logo;
        private Font headingFont, detailFont;

        internal AboutWindow()
        {
            SuspendLayout();
            Text = "关于 · 旁门工具箱";
            AutoScaleDimensions = new SizeF(96f, 96f);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(640, 350);
            // A percent-width table must consume the dialog width, not determine it.
            // Form autosizing with Dock.Top can collapse to the logo column alone.
            AutoSize = false;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterParent;
            MaximizeBox = false; MinimizeBox = false; ShowInTaskbar = false;
            BackColor = ToolboxTheme.Paper;
            ForeColor = ToolboxTheme.Ink;
            Font = ToolboxTheme.Font(ToolboxTheme.BodySize);
            Padding = new Padding(28);

            logo = BrandAssets.LoadLogo();
            brandIcon = BrandAssets.LoadIcon();
            if (brandIcon != null) Icon = brandIcon;
            else ShowIcon = false;

            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = false, ColumnCount = 1, RowCount = 4, Margin = Padding.Empty };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 56));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 24));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 192));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            var header = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, ColumnCount = 2, RowCount = 1, Margin = Padding.Empty };
            header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 76));
            header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            header.Controls.Add(new PictureBox { Image = logo, SizeMode = PictureBoxSizeMode.Zoom, Size = new Size(56, 56), Margin = new Padding(0, 0, 20, 0) }, 0, 0);
            headingFont = ToolboxTheme.Font(ToolboxTheme.TitleSize, FontStyle.Bold);
            detailFont = ToolboxTheme.Font(ToolboxTheme.CaptionSize);
            var titles = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, ColumnCount = 1, RowCount = 2, Margin = Padding.Empty };
            titles.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            titles.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            titles.Controls.Add(new Label { Text = "旁门工具箱", AutoSize = true, Font = headingFont, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(0, 0, 0, 8) }, 0, 0);
            titles.Controls.Add(new Label { Text = "版本 " + HostDiagnostics.Version, AutoSize = true, Font = detailFont, ForeColor = ToolboxTheme.Muted, Dock = DockStyle.Fill, TextAlign = ContentAlignment.TopLeft, Margin = Padding.Empty }, 0, 1);
            header.Controls.Add(titles, 1, 0);
            layout.Controls.Add(header, 0, 0);
            var links = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, ColumnCount = 2, RowCount = 1, Margin = Padding.Empty };
            links.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            links.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            links.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            links.Controls.Add(LinkButton("旁门左道PPT官网", "https://www.pangmenzd.vip/", new Padding(0, 0, 8, 0)), 0, 0);
            links.Controls.Add(LinkButton("旁门AI工作台", "https://ai.pangmenzd.vip/", new Padding(8, 0, 0, 0)), 1, 0);
            layout.Controls.Add(links, 0, 2);
            Controls.Add(layout);
            MinimumSize = SizeFromClientSize(ClientSize);
            ResumeLayout(true);
        }

        protected override void OnShown(EventArgs e)
        {
            // Office can be system-DPI aware while Control.DeviceDpi still reports 96.
            // Use the already-scaled client width, as for the logo and layout.
            float scale = ClientSize.Width / 640f;
            var oldHeading = headingFont; var oldDetail = detailFont;
            headingFont = ToolboxTheme.Font(ToolboxTheme.TitleSize * scale, FontStyle.Bold);
            detailFont = ToolboxTheme.Font(ToolboxTheme.CaptionSize * scale);
            ScaleLabelFonts(this, oldHeading, oldDetail);
            oldHeading.Dispose(); oldDetail.Dispose();
            base.OnShown(e);
        }
        private void ScaleLabelFonts(Control root, Font oldHeading, Font oldDetail)
        {
            foreach(Control child in root.Controls) {
                if(child is Label) {
                    if(child.Font == oldHeading) child.Font = headingFont;
                    else if(child.Font == oldDetail) child.Font = detailFont;
                }
                ScaleLabelFonts(child, oldHeading, oldDetail);
            }
        }

        private Button LinkButton(string label, string url, Padding margin)
        {
            bool official = url == "https://www.pangmenzd.vip/";
            var button = new AboutLinkCard(label, official ? "www.pangmenzd.vip" : "ai.pangmenzd.vip", official ? "访问官网" : "打开工作台") { AutoSize = false, Dock = DockStyle.Fill, Margin = margin };
            button.Click += (sender, args) =>
            {
                try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
                catch (Exception ex)
                {
                    HostDiagnostics.Log("About.OpenLink.Error", HostDiagnostics.Describe(ex));
                    MessageBox.Show(this, "无法打开默认浏览器，请手动访问：\n" + url, "打开链接", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            };
            return button;
        }

        protected override bool ProcessCmdKey(ref Message message, Keys keyData)
        {
            if (keyData == Keys.Escape) { Close(); return true; }
            return base.ProcessCmdKey(ref message, keyData);
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (disposing) { if (headingFont != null) { headingFont.Dispose(); headingFont = null; } if (detailFont != null) { detailFont.Dispose(); detailFont = null; } if (logo != null) { logo.Dispose(); logo = null; } if (brandIcon != null) { brandIcon.Dispose(); brandIcon = null; } }
        }
    }
}

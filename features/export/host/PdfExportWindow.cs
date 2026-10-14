using PangmenToolbox.Shapes;
using PangmenToolbox.AddIn;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PangmenToolbox.Export
{
    internal sealed class PdfExportWindow : Form
    {
        private readonly object application, document;
        private readonly WebView2 browser = new WebView2 { Dock = DockStyle.Fill };
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
        private readonly string temp = Path.Combine(HostDiagnostics.DataDirectory, "exports", Guid.NewGuid().ToString("N"));
        private int[] slideIds;
        private bool busy, cancelled;
        private const string Url = "https://shape-export.local/pdf-export.html";
        internal PdfExportWindow(object app)
        {
            application = app; document = ((dynamic)app).ActivePresentation;
            Text = "导出 PDF · 旁门"; Size = new Size(1200, 980); MinimumSize = new Size(760, 560);
            Load += (s, e) =>
            {
                var area = Screen.FromControl(this).WorkingArea;
                MinimumSize = new Size(Math.Min(760, area.Width), Math.Min(560, area.Height));
                Size = new Size(Math.Min(1200, Math.Max(1, area.Width - 32)), Math.Min(980, Math.Max(1, area.Height - 40)));
            };
            StartPosition = FormStartPosition.CenterParent; ShowInTaskbar = false;
            DependencyResolver.EnsureNativeLoader(); Controls.Add(browser);
            Shown += async (s, e) => await Initialize();
            FormClosing += (s, e) => { if (busy) { cancelled = true; e.Cancel = true; } };
        }
        private async Task Initialize()
        {
            try
            {
                Directory.CreateDirectory(temp);
                string web = Path.Combine(temp, "web"); Directory.CreateDirectory(web);
                foreach (string file in new[] { "pdf-export.html", "pdf-export.css", "pdf-export.js" })
                using (var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("ShapeEffects.Export." + file))
                using (var target = File.Create(Path.Combine(web, file))) resource.CopyTo(target);
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(HostDiagnostics.DataDirectory, "export-webview"));
                if (IsDisposed) return;
                await browser.EnsureCoreWebView2Async(environment);
                var core = browser.CoreWebView2;
                core.SetVirtualHostNameToFolderMapping("shape-export.local", web, CoreWebView2HostResourceAccessKind.DenyCors);
                core.Settings.AreHostObjectsAllowed = false; core.Settings.AreDevToolsEnabled = false;
                core.NavigationStarting += (s, e) => { if (e.Uri != Url) e.Cancel = true; };
                core.FrameNavigationStarting += (s, e) => e.Cancel = true;
                core.NewWindowRequested += (s, e) => e.Handled = true;
                core.PermissionRequested += (s, e) => { e.State = CoreWebView2PermissionState.Deny; e.Handled = true; };
                core.WebMessageReceived += Receive;
                core.Navigate(Url);
            }
            catch (Exception ex) { MessageBox.Show(this, ex.GetBaseException().Message, "无法打开 PDF 导出"); Close(); }
        }
        private void Post(object message) { if (!IsDisposed && browser.CoreWebView2 != null) browser.CoreWebView2.PostWebMessageAsJson(json.Serialize(message)); }
        private async void Receive(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (e.Source != Url || e.WebMessageAsJson.Length > 65536) return;
            string id = null;
            try
            {
                var message = json.DeserializeObject(e.WebMessageAsJson) as Dictionary<string, object>;
                id = (string)message["id"]; string type = (string)message["type"];
                var payload = message.ContainsKey("payload") ? (Dictionary<string, object>)message["payload"] : new Dictionary<string, object>();
                object result;
                if (type == "cancel") { cancelled = true; result = new { cancelled = true }; }
                else if (busy) throw new InvalidOperationException("导出进行中，请稍候。");
                else if (type == "document") result = Describe();
                else if (type == "thumbnail") result = Thumbnail(Convert.ToInt32(payload["index"]));
                else if (type == "export") result = await Export(payload);
                else throw new InvalidOperationException("不支持此导出操作。");
                Post(new { id, ok = true, data = result });
            }
            catch (Exception ex) { HostDiagnostics.Log("PdfExport.Error", ex.ToString()); Post(new { id, ok = false, error = ex.GetBaseException().Message }); }
        }
        private object Describe()
        {
            dynamic doc = document; int count = doc.Slides.Count;
            if (count == 0) throw new InvalidOperationException("这份文稿没有页面。");
            var pages = new List<object>(); slideIds = new int[count];
            int current = 1; try { current = ((dynamic)application).ActiveWindow.View.Slide.SlideIndex; } catch { }
            for (int i = 1; i <= count; i++)
            {
                dynamic slide = doc.Slides[i]; slideIds[i - 1] = (int)slide.SlideID;
                string title = "第 " + i + " 页";
                try { if ((int)slide.Shapes.HasTitle != 0) title = (string)slide.Shapes.Title.TextFrame.TextRange.Text; } catch { }
                pages.Add(new { index = i, title = title.Length > 160 ? title.Substring(0, 160) : title, hidden = (int)slide.SlideShowTransition.Hidden != 0 });
            }
            return new { name = (string)doc.Name, width = (double)doc.PageSetup.SlideWidth, height = (double)doc.PageSetup.SlideHeight, current, pages };
        }
        private object Thumbnail(int index)
        {
            if (slideIds == null || index < 1 || index > slideIds.Length) throw new InvalidOperationException("页码无效。");
            dynamic doc = document; dynamic slide = doc.Slides.FindBySlideID(slideIds[index - 1]);
            string file = Path.Combine(temp, "thumb-" + index + ".png");
            if (!File.Exists(file)) slide.Export(file, "PNG", 480, Math.Max(1, (int)Math.Round(480.0 * (double)doc.PageSetup.SlideHeight / (double)doc.PageSetup.SlideWidth)));
            return new { url = "data:image/png;base64," + Convert.ToBase64String(File.ReadAllBytes(file)) };
        }
        private async Task<object> Export(Dictionary<string, object> payload)
        {
            int dpi = Convert.ToInt32(payload["dpi"]), quality = Convert.ToInt32(payload["quality"]);
            string compression = (string)payload["compression"];
            if (dpi < 72 || dpi > 600 || quality < 70 || quality > 100 || !new[] { "auto", "jpeg", "lossless" }.Contains(compression)) throw new InvalidOperationException("导出参数无效。");
            var indices = ((IEnumerable)payload["pages"]).Cast<object>().Select(Convert.ToInt32).Distinct().OrderBy(x => x).ToArray();
            if (slideIds == null || indices.Length == 0 || indices.Any(i => i < 1 || i > slideIds.Length)) throw new InvalidOperationException("请选择有效页面。");
            dynamic doc = document;
            if ((int)doc.Slides.Count != slideIds.Length || Enumerable.Range(1, slideIds.Length).Any(i => (int)doc.Slides[i].SlideID != slideIds[i - 1])) throw new InvalidOperationException("文稿页面已变化，请关闭并重新打开导出窗口。");
            string output;
            using (var picker = new SaveFileDialog { Filter = "PDF 文件 (*.pdf)|*.pdf", FileName = Path.GetFileNameWithoutExtension((string)doc.Name) + ".pdf", DefaultExt = "pdf", AddExtension = true, OverwritePrompt = true })
            { if (picker.ShowDialog(this) != DialogResult.OK) return new { cancelled = true }; output = picker.FileName; }
            busy = true; cancelled = false;
            try
            {
                using (ToolboxRuntime.Enter("export")) {
                long bytes = await SlidePdfExport.Run(application, document, indices, dpi, quality, compression, output, temp,
                    (stage, done) => Post(new { type = "progress", stage, done, total = indices.Length }), () => cancelled, payload.ContainsKey("fitToLimits") && payload["fitToLimits"] is bool && (bool)payload["fitToLimits"]);
                return new { path = output, bytes, count = indices.Length }; }
            }
            catch (OperationCanceledException) { return new { cancelled = true }; }
            finally { busy = false; }
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing) { browser.Dispose(); try { if (Directory.Exists(temp)) Directory.Delete(temp, true); } catch { } }
            base.Dispose(disposing);
        }
    }
}

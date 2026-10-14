using PangmenToolbox.Shapes;
using PangmenToolbox.AddIn;
using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

namespace PangmenToolbox.Export
{
    // Call on the Office UI context. Only compression/writing runs on a worker thread.
    internal static class SlidePdfExport
    {
        internal static Size PixelSize(double width, double height, int dpi, bool fitToLimits)
        {
            if (double.IsNaN(width + height) || double.IsInfinity(width + height) || width <= 0 || height <= 0 || dpi < 72 || dpi > 600) throw new ArgumentException("页面尺寸或分辨率无效。");
            double w = Math.Max(1, Math.Round(width * dpi / 72, MidpointRounding.AwayFromZero)), h = Math.Max(1, Math.Round(height * dpi / 72, MidpointRounding.AwayFromZero));
            if (w * h > 24000000 || w > 12000 || h > 12000)
            {
                if (!fitToLimits) throw new InvalidOperationException("当前 DPI 超过单页 2400 万像素或单边 12000 像素限制，请降低 DPI 或选择均衡档位。");
                double scale = Math.Min(1, Math.Min(12000 / w, Math.Min(12000 / h, Math.Sqrt(24000000 / (w * h)))));
                w = Math.Max(1, Math.Floor(w * scale)); h = Math.Max(1, Math.Floor(h * scale));
            }
            return new Size((int)w, (int)h);
        }
        private static async Task<T> OfficeCall<T>(Func<T> operation, Func<bool> cancelled)
        {
            // PowerPoint can reject COM calls while repainting. Retry only its two busy codes.
            for (int attempt = 0; ; attempt++)
            {
                if (cancelled()) throw new OperationCanceledException();
                try { return operation(); }
                catch (COMException ex) when (attempt < 8 && (ex.ErrorCode == unchecked((int)0x80010001) || ex.ErrorCode == unchecked((int)0x8001010A)))
                { await Task.Delay(Math.Min(150 * (attempt + 1), 750)); }
            }
        }
        internal static async Task<long> Run(object application, object document, int[] pages,
            int dpi, int quality, string compression, string output, string workspace,
            Action<string, int> progress, Func<bool> cancelled, bool fitToLimits = false)
        {
            if (dpi < 72 || dpi > 600 || quality < 70 || quality > 100 || !new[] { "auto", "jpeg", "lossless" }.Contains(compression)) throw new ArgumentException("导出参数无效。");
            dynamic source = document;
            if (pages == null || pages.Length == 0 || pages.Any(p => p < 1 || p > (int)source.Slides.Count)) throw new ArgumentException("请选择有效页面。");
            pages = pages.Distinct().OrderBy(p => p).ToArray();
            int[] ids = pages.Select(p => (int)source.Slides[p].SlideID).ToArray();
            string job = Path.Combine(workspace, Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(job);
            string partial = Path.Combine(Path.GetDirectoryName(output), ".pangmen-" + Guid.NewGuid().ToString("N") + ".tmp");
            string snapshotPath = Path.Combine(job, "snapshot.pptx"); object snapshot = null;
            try
            {
                progress("正在准备文稿副本", 0);
                await Task.Delay(1);
                if (cancelled()) throw new OperationCanceledException();
                await OfficeCall(() => { source.SaveCopyAs(snapshotPath, 24, 0); return true; }, cancelled);
                snapshot = await OfficeCall(() => (object)((dynamic)application).Presentations.Open(snapshotPath, -1, 0, 0), cancelled);
                dynamic copy = snapshot;
                var dimensions = await OfficeCall(() => Tuple.Create((double)copy.PageSetup.SlideWidth, (double)copy.PageSetup.SlideHeight), cancelled);
                double w = dimensions.Item1, h = dimensions.Item2;
                Size pixels = PixelSize(w, h, dpi, fitToLimits);
                int pw = pixels.Width, ph = pixels.Height;
                using (var stream = new FileStream(partial, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (var pdf = new SlidePdfWriter(stream, w, h))
                {
                    for (int n = 0; n < pages.Length; n++)
                    {
                        if (cancelled()) throw new OperationCanceledException();
                        int page = pages[n]; string png = Path.Combine(job, "page.png");
                        progress("正在导出第 " + page + " 页", n);
                        await Task.Delay(1);
                        if (cancelled()) throw new OperationCanceledException();
                        try
                        {
                            await OfficeCall(() => { copy.Slides.FindBySlideID(ids[n]).Export(png, "PNG", pw, ph); return true; }, cancelled);
                            using (var im = Image.FromFile(png)) if (im.Width != pw || im.Height != ph) throw new InvalidOperationException("PowerPoint 未达到指定分辨率，请降低 DPI 后重试。");
                            await Task.Run(() => pdf.AddPage(png, compression, quality));
                        }
                        catch (OperationCanceledException) { throw; }
                        catch (Exception ex) { throw new InvalidOperationException("第 " + page + " 页导出失败：" + ex.GetBaseException().Message, ex); }
                        finally { if (File.Exists(png)) File.Delete(png); }
                    }
                    if (cancelled()) throw new OperationCanceledException();
                    pdf.Finish();
                }
                if (File.Exists(output)) File.Replace(partial, output, null); else File.Move(partial, output);
                progress("导出完成", pages.Length);
                return new FileInfo(output).Length;
            }
            finally
            {
                if (snapshot != null) try { await OfficeCall(() => { ((dynamic)snapshot).Close(); return true; }, () => false); } catch { }
                try { if (File.Exists(partial)) File.Delete(partial); } catch { }
                try { if (Directory.Exists(job)) Directory.Delete(job, true); } catch { }
            }
        }
    }
}

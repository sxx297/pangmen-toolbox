using PangmenToolbox.AddIn;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace PangmenToolbox.Shapes
{
    /// <summary>All Office calls run on the owning PowerPoint UI/STA thread.</summary>
    public sealed class PowerPointBridge
    {
        private readonly dynamic application;
        private readonly string cacheRoot;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 131072, RecursionLimit = 64 };
        private Target captured;
        private readonly CaptureCache captureCache = new CaptureCache();
        private readonly FreeformGeometry freeformGeometry = new FreeformGeometry();
        public void ClearCache() { captureCache.Clear(); }
        private const string Prefix = "SEFX_";
        private const int MaxSettingsBytes = 65536;
        private const int ChunkLength = 200;

        private sealed class Target
        {
            public string Token;
            public long PresentationIdentity;
            public int SlideId;
            public int ShapeId;
            public string Geometry;
            public string MaterialState;
        }

        public PowerPointBridge(dynamic application, string cacheDirectory)
        {
            if (application == null) throw new ArgumentNullException("application");
            if (String.IsNullOrWhiteSpace(cacheDirectory)) throw new ArgumentNullException("cacheDirectory");
            this.application = application;
            cacheRoot = Path.GetFullPath(Path.Combine(cacheDirectory, "bridge"));
            Directory.CreateDirectory(cacheRoot);
        }

        public object Handle(string type, IDictionary<string, object> payload)
        {
            payload = payload ?? new Dictionary<string, object>();
            switch (type)
            {
                case "status": return Status();
                case "selectionInfo": return SelectionInfo();
                case "captureSelection": return CaptureSelection(payload);
                case "applyMaterial": return ApplyMaterial(payload);
                case "restoreMaterial": return RestoreMaterial(payload);
                default: throw new InvalidOperationException("UNKNOWN_REQUEST: 未识别的 PowerPoint 请求。");
            }
        }

        private object Status()
        {
            try
            {
                dynamic presentation, slide, shape;
                ReadSelection(out presentation, out slide, out shape);
                string reason = UnsupportedReason(shape);
                return Map("connected", true, "version", "0.9.18", "supported", reason == null,
                    "shapeName", (string)shape.Name, "reason", reason, "canRestore", FindBackup(slide, shape) != null);
            }
            catch (Exception e)
            {
                return Map("connected", true, "version", "0.9.18", "supported", false, "reason", e.Message, "canRestore", false);
            }
        }

        public IDictionary<string, object> ObserveSelection()
        {
            try
            {
                dynamic presentation, slide, shape;
                ReadSelection(out presentation, out slide, out shape);
                string reason = UnsupportedReason(shape);
                string identity = SelectionIdentity(presentation, slide, shape), materialState = MaterialState(shape);
                try
                {
                    return Map("identity", identity, "materialState", materialState,
                        "signature", identity + ":" + (reason == null ? Geometry(presentation, shape, true) : reason) + ":" + materialState,
                        "supported", reason == null, "shapeName", (string)shape.Name, "reason", reason);
                }
                catch (Exception e)
                {
                    string message = e.Message;
                    if (message.StartsWith("GEOMETRY_UNAVAILABLE: ", StringComparison.Ordinal)) message = message.Substring("GEOMETRY_UNAVAILABLE: ".Length);
                    return Map("identity", identity, "materialState", materialState, "signature", identity+":geometry-unavailable:"+materialState,
                        "supported", false, "readError", true, "shapeName", (string)shape.Name, "reason", message);
                }
            }
            catch { return Map("signature", "none", "supported", false, "reason", "选择一个形状开始编辑"); }
        }

        private object SelectionInfo()
        {
            using (HostDiagnostics.Measure("Selection.Info"))
            {
                dynamic presentation, slide, shape;
                ReadSelection(out presentation, out slide, out shape);
                return Map("identity", SelectionIdentity(presentation, slide, shape), "supported", UnsupportedReason(shape) == null,
                    "shape", Map("id", (int)shape.Id, "name", (string)shape.Name, "width", (double)shape.Width, "height", (double)shape.Height));
            }
        }

        private object CaptureSelection(IDictionary<string, object> payload)
        {
            using var totalTiming = HostDiagnostics.Measure("Capture.Total");
            // A failed capture must never leave a previously captured target actionable.
            captured = null;
            dynamic presentation, slide, shape;
            ReadSelection(out presentation, out slide, out shape);
            string reason = UnsupportedReason(shape);
            if (reason != null) throw new InvalidOperationException("UNSUPPORTED_SHAPE: " + reason);
            double left = (double)shape.Left, top = (double)shape.Top;
            double width = (double)shape.Width, height = (double)shape.Height;
            double slideWidth = (double)presentation.PageSetup.SlideWidth;
            double slideHeight = (double)presentation.PageSetup.SlideHeight;
            var target = new Target { Token = Guid.NewGuid().ToString("N"), PresentationIdentity = Identity(presentation),
                SlideId = (int)slide.SlideID, ShapeId = (int)shape.Id, Geometry = Geometry(presentation, shape), MaterialState = MaterialState(shape) };
            object settings = null;
            string settingsWarning = null;
            try { settings = ReadSettings(shape); } catch (InvalidOperationException e) { settingsWarning = e.Message; }
            bool canRestore = FindBackup(slide, shape) != null;
            string directory = NewDirectory();
            dynamic copy = null;
            try
            {
                string scenePath = Path.Combine(directory, "scene.png"), maskPng;
                object force;
                bool forceRefresh = payload.TryGetValue("forceRefresh", out force) && force is bool && (bool)force;
                string pageKey = target.PresentationIdentity + ":" + target.SlideId;
                captureCache.UsePage(pageKey);
                if (forceRefresh) captureCache.Clear();
                string cacheKey;
                using (HostDiagnostics.Measure("Capture.ValidateCache"))
                    cacheKey = CaptureFingerprint(presentation, slide, shape, directory);
                CaptureCache.Entry cachedEntry = captureCache.Get(cacheKey);
                if (cachedEntry != null)
                {
                    File.WriteAllBytes(scenePath, cachedEntry.Scene);
                    maskPng = cachedEntry.Mask;
                    HostDiagnostics.Log("Capture.Cache", "hit");
                }
                else
                {
                    HostDiagnostics.Log("Capture.Cache", cacheKey == null ? "unavailable" : "miss");
                    string copyPath = Path.Combine(directory, "capture.pptx");
                    // Original presentation, selection, clipboard, and its Saved flag remain untouched.
                    using (HostDiagnostics.Measure("Capture.SaveCopy")) presentation.SaveCopyAs(copyPath, 24, 0);
                    string slideCopyPath = Path.Combine(directory, "current-slide.pptx");
                    try { using (HostDiagnostics.Measure("Capture.ExtractPage")) SlideCapturePackage.Create(copyPath, slideCopyPath, target.SlideId); }
                    catch (Exception e) when (e is System.IO.InvalidDataException || e is System.Xml.XmlException || e is InvalidOperationException)
                    {
                        // Keep unusual but Office-readable packages usable. There is no file-size gate.
                        slideCopyPath = copyPath;
                    }
                    try { using (HostDiagnostics.Measure("Capture.OpenCopy")) copy = application.Presentations.Open(slideCopyPath, 0, 0, 0); }
                    catch (COMException) when (slideCopyPath != copyPath) { copy = application.Presentations.Open(copyPath, 0, 0, 0); }
                    dynamic copiedSlide = copy.Slides.FindBySlideID(target.SlideId);
                    dynamic copiedShape = FindShape(copiedSlide, target.ShapeId);
                    if (copiedShape == null) throw new InvalidOperationException("临时副本中未找到所选形状。");
                    int z = (int)copiedShape.ZOrderPosition;
                    int count = (int)copiedSlide.Shapes.Count;
                    for (int i = 1; i <= count; ++i)
                    {
                        dynamic item = copiedSlide.Shapes[i];
                        if ((int)item.ZOrderPosition >= z) item.Visible = 0;
                    }
                    double renderScale = Math.Min(4.0, 4096.0 / Math.Max(slideWidth, slideHeight));
                    using (HostDiagnostics.Measure("Capture.ExportBackground")) copiedSlide.Export(scenePath, "PNG", Math.Max(1, (int)Math.Round(slideWidth * renderScale)),
                        Math.Max(1, (int)Math.Round(slideHeight * renderScale)));
                    copiedShape.Visible = -1;
                    copiedShape.Fill.Solid();
                    copiedShape.Fill.Visible = -1;
                    copiedShape.Fill.ForeColor.RGB = 16777215;
                    copiedShape.Fill.Transparency = 0;
                    copiedShape.Line.Visible = 0;
                    try { copiedShape.Shadow.Visible = 0; } catch { }
                    try { copiedShape.Glow.Radius = 0; } catch { }
                    try { copiedShape.SoftEdge.Radius = 0; } catch { }
                    try { copiedShape.Reflection.Type = 0; } catch { }
                    try { copiedShape.ThreeD.Visible = 0; } catch { }
                    if ((int)copiedShape.HasTextFrame == -1) copiedShape.TextFrame.TextRange.Text = "";
                    string maskPath = Path.Combine(directory, "mask.png");
                    // Shape.Export uses scale relative to the slide and 96 DPI. Office can add one
                    // antialias pixel; the renderer resamples the returned alpha to its canonical box.
                    using (HostDiagnostics.Measure("Capture.ExportMask")) copiedShape.Export(maskPath, 2,
                        Math.Max(1, (int)Math.Round(1200 * slideWidth / width * .75)),
                        Math.Max(1, (int)Math.Round(920 * slideHeight / height * .75)), 1);
                    using (var mask = new Bitmap(maskPath))
                    {
                        if (mask.Width > 4096 || mask.Height > 4096 || mask.Width < 1 || mask.Height < 1)
                            throw new InvalidOperationException("形状蒙版尺寸异常。");
                        maskPng = PngData(mask);
                    }
                }
                using var cropTiming = HostDiagnostics.Measure("Capture.CropAndEncode");
                string backgroundPng, previewScenePng;
                using (var full = new Bitmap(scenePath))
                using (var scene = new Bitmap(1800, 1440, PixelFormat.Format32bppArgb))
                using (var g = Graphics.FromImage(scene))
                {
                    g.Clear(Color.FromArgb(255, 245, 245, 245));
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    float sx = full.Width / (float)slideWidth, sy = full.Height / (float)slideHeight;
                    var crop = new RectangleF((float)(left - width * 126.0 / 648.0) * sx,
                        (float)(top - height * 111.6 / 496.8) * sy,
                        (float)(width * 900.0 / 648.0) * sx, (float)(height * 720.0 / 496.8) * sy);
                    g.DrawImage(full, new RectangleF(0, 0, scene.Width, scene.Height), crop, GraphicsUnit.Pixel);
                    backgroundPng = PngData(scene);
                    // Capture the whole 5:4 preview viewport using a uniform world scale.
                    // The material crop above stays canonical for the existing renderer.
                    double previewCardWidth = Math.Min(900.0 * .72, 720.0 * .72 * width / height);
                    double previewCardHeight = previewCardWidth * height / width;
                    double viewportWidth = width * 900.0 / previewCardWidth;
                    double viewportHeight = height * 720.0 / previewCardHeight;
                    var previewCrop = new RectangleF(
                        (float)(left - (viewportWidth - width) / 2.0) * sx,
                        (float)(top - (viewportHeight - height) / 2.0) * sy,
                        (float)viewportWidth * sx, (float)viewportHeight * sy);
                    g.Clear(Color.FromArgb(255, 245, 245, 245));
                    g.DrawImage(full, new RectangleF(0, 0, scene.Width, scene.Height), previewCrop, GraphicsUnit.Pixel);
                    using (var preview = new Bitmap(scene, 900, 720)) previewScenePng = PngData(preview);
                }

                // Revalidate after export in case Office changed active windows or a callback
                // allowed the document to change while SaveCopyAs/Open was running.
                dynamic p2, s2, h2;
                ReadSelection(out p2, out s2, out h2);
                ValidateTarget(target, p2, s2, h2);
                if (cachedEntry == null && cacheKey != null)
                {
                    using (HostDiagnostics.Measure("Capture.ValidateSnapshot"))
                        if (cacheKey == CaptureFingerprint(presentation, slide, shape, directory))
                            captureCache.Put(cacheKey, File.ReadAllBytes(scenePath), maskPng);
                }
                captured = target;
                return Map("supported", true, "token", target.Token, "identity", SelectionIdentity(presentation, slide, shape), "materialState", target.MaterialState, "shape",
                    Map("id", target.ShapeId, "name", (string)shape.Name, "left", left, "top", top,
                        "width", width, "height", height, "rotation", 0),
                    "maskPng", maskPng, "backgroundPng", backgroundPng, "previewScenePng", previewScenePng,
                    "render", Map("width", 900, "height", 720, "card", Map("x", 126, "y", 111.6, "w", 648, "h", 496.8)),
                    "settings", settings, "canRestore", canRestore,
                    "message", settingsWarning == null ? "已读取真实形状轮廓和后方背景。" : settingsWarning + " 可先恢复原样。");
            }
            finally
            {
                if (copy != null) { try { copy.Saved = -1; copy.Close(); } catch { } }
                DeleteDirectory(directory);
            }
        }

        private object ApplyMaterial(IDictionary<string, object> payload)
        {
            using var applyTiming = HostDiagnostics.Measure("Apply.Total");
            dynamic presentation, slide, shape;
            ResolveTarget(payload, out presentation, out slide, out shape);
            object rawSettings;
            if (!payload.TryGetValue("settings", out rawSettings) || !(rawSettings is IDictionary<string, object>))
                throw new InvalidOperationException("INVALID_SETTINGS: 材质参数必须是对象。");
            string settings = json.Serialize(rawSettings);
            byte[] settingsBytes = Encoding.UTF8.GetBytes(settings);
            if (settingsBytes.Length > MaxSettingsBytes) throw new InvalidOperationException("材质参数超过 64 KB。");
            byte[] png = ReadPng(payload);
            dynamic existingBackup = FindBackup(slide, shape);
            dynamic sourceBackup = existingBackup == null ? FindBackupSource(slide, shape) : null;
            string oldSettings = ReadRawSettings(shape);
            string oldBackup = Tag(shape, Prefix + "BACKUP");
            string directory = NewDirectory();
            dynamic transactionBackup = null;
            dynamic originalBackup = null;
            bool success = false;
            try
            {
                string pngPath = Path.Combine(directory, "material.png");
                File.WriteAllBytes(pngPath, png);
                application.StartNewUndoEntry();
                // Duplicate preserves Office-native rich fill/style without using the clipboard.
                transactionBackup = shape.Duplicate()[1];
                transactionBackup.Left = shape.Left;
                transactionBackup.Top = shape.Top;
                transactionBackup.Visible = 0;
                string backupKey = existingBackup == null ? Guid.NewGuid().ToString("N").ToUpperInvariant() : oldBackup;
                ClearMaterialTags(transactionBackup);
                if (existingBackup == null)
                {
                    // A copied shape gets its own backup. If the source backup no longer
                    // exists (e.g. pasted from another deck), retain the copied appearance.
                    originalBackup = sourceBackup != null ? sourceBackup.Duplicate()[1] : shape.Duplicate()[1];
                    originalBackup.Left = shape.Left; originalBackup.Top = shape.Top;
                    originalBackup.Visible = 0;
                    originalBackup.Name = "[形状效果·原外观备份] " + (string)shape.Name;
                    ClearMaterialTags(originalBackup);
                    originalBackup.Tags.Add(Prefix + "BACKUP_KEY", backupKey);
                    originalBackup.Tags.Add(Prefix + "OWNER_ID", ((int)shape.Id).ToString(CultureInfo.InvariantCulture));
                }
                using (HostDiagnostics.Measure("Apply.WriteFill")) shape.Fill.UserPicture(pngPath);
                shape.Fill.Visible = -1;
                shape.Fill.Transparency = 0;
                shape.Tags.Add(Prefix + "BACKUP", backupKey);
                WriteSettings(shape, settings);
                // Duplicate can alter Office selection. Explicitly retain the user's target.
                shape.Select(-1);
                captured.MaterialState = MaterialState(shape);
                success = true;
                // The mask/background remain valid for subsequent parameter-only changes.
                // ResolveTarget still checks the current selection and geometry on every write.
                return Map("message", "已同步到 PowerPoint", "canRestore", true, "token", captured.Token, "materialState", captured.MaterialState);
            }
            catch
            {
                if (transactionBackup != null)
                {
                    try { transactionBackup.PickUp(); shape.Apply(); } catch { }
                    try { ClearMaterialTags(shape); if (!String.IsNullOrEmpty(oldBackup)) shape.Tags.Add(Prefix + "BACKUP", oldBackup); if (oldSettings != null) WriteSettings(shape, oldSettings); } catch { }
                    try { shape.Select(-1); } catch { }
                }
                throw;
            }
            finally
            {
                if (transactionBackup != null) { try { transactionBackup.Delete(); } catch { } }
                if (!success && originalBackup != null) { try { originalBackup.Delete(); } catch { } }
                DeleteDirectory(directory);
            }
        }

        private object RestoreMaterial(IDictionary<string, object> payload)
        {
            dynamic presentation, slide, shape;
            ResolveTarget(payload, out presentation, out slide, out shape);
            dynamic backup = FindBackup(slide, shape);
            if (backup == null) throw new InvalidOperationException("NO_BACKUP: 未找到此形状的原外观备份，无法恢复。");
            application.StartNewUndoEntry();
            backup.PickUp();
            shape.Apply();
            ClearMaterialTags(shape);
            backup.Delete();
            shape.Select(-1);
            captured = null;
            return Map("message", "已恢复首次应用前的外观，保留当前文字内容、位置和大小。", "canRestore", false);
        }

        private string CaptureFingerprint(dynamic presentation, dynamic slide, dynamic shape, string directory)
        {
            try
            {
                // Freeform node edits cannot be validated from dimensions alone.
                if ((int)shape.Type != 1) return null;
                var key = new StringBuilder();
                double sw = (double)presentation.PageSetup.SlideWidth, sh = (double)presentation.PageSetup.SlideHeight;
                double scale = Math.Min(4.0, 4096.0 / Math.Max(sw, sh));
                int ew = Math.Max(1, (int)Math.Round(sw * scale * .75)), eh = Math.Max(1, (int)Math.Round(sh * scale * .75));
                key.Append((int)shape.Id).Append('|').Append(sw).Append('|').Append(sh).Append('|')
                    .Append((double)shape.Width).Append('|').Append((double)shape.Height).Append('|').Append((int)shape.AutoShapeType);
                for (int i = 1; i <= (int)shape.Adjustments.Count; i++) key.Append('|').Append((double)shape.Adjustments[i]);
                int z = (int)shape.ZOrderPosition;
                key.Append('|').Append(z).Append('|').Append((int)slide.DisplayMasterShapes).Append('|').Append((int)slide.FollowMasterBackground);
                string path = Path.Combine(directory, "fingerprint.png");
                // Only read/export live objects. Never hide or recolor the user's shapes.
                dynamic background = (int)slide.FollowMasterBackground == -1 ? slide.Master.Background : slide.Background;
                dynamic fill = background.Fill;
                if ((int)fill.Type == 1)
                    key.Append("|solid:").Append((int)fill.Visible).Append('|').Append((int)fill.ForeColor.RGB).Append('|').Append((double)fill.Transparency);
                else FingerprintExport(background, path, ew, eh, key);
                if ((int)slide.DisplayMasterShapes != 0)
                {
                    FingerprintShapes(slide.Master.Shapes, Int32.MaxValue, path, ew, eh, key);
                    FingerprintShapes(slide.CustomLayout.Shapes, Int32.MaxValue, path, ew, eh, key);
                }
                FingerprintShapes(slide.Shapes, z, path, ew, eh, key);
                return key.ToString();
            }
            catch (Exception error)
            {
                HostDiagnostics.Log("Capture.CacheValidationUnavailable", HostDiagnostics.Describe(error));
                return null; // Unsupported background exports keep the established capture path.
            }
        }
        private static void FingerprintShapes(dynamic shapes, int beforeZ, string path, int width, int height, StringBuilder key)
        {
            if ((int)shapes.Count > 100) throw new InvalidOperationException("Complex slide: use full capture.");
            for (int i = 1; i <= (int)shapes.Count; i++)
            {
                dynamic item = shapes[i];
                if ((int)item.Visible == 0 || (int)item.ZOrderPosition >= beforeZ) continue;
                key.Append('|').Append((int)item.Id).Append('|').Append((int)item.ZOrderPosition)
                    .Append('|').Append((double)item.Left).Append('|').Append((double)item.Top)
                    .Append('|').Append((double)item.Width).Append('|').Append((double)item.Height)
                    .Append('|').Append((double)item.Rotation);
                FingerprintExport(item, path, width, height, key);
            }
        }
        private static void FingerprintExport(dynamic item, string path, int width, int height, StringBuilder key)
        {
            item.Export(path, 2, width, height, 1);
            using (var file = File.OpenRead(path))
            using (var hash = SHA256.Create()) key.Append('|').Append(Convert.ToBase64String(hash.ComputeHash(file)));
        }

        private void ResolveTarget(IDictionary<string, object> payload, out dynamic presentation, out dynamic slide, out dynamic shape)
        {
            object token;
            if (captured == null || !payload.TryGetValue("token", out token) || !(token is string) || (string)token != captured.Token)
                throw Stale();
            ReadSelection(out presentation, out slide, out shape);
            ValidateTarget(captured, presentation, slide, shape);
            try { if ((int)presentation.ReadOnly == -1) throw new InvalidOperationException("文稿为只读，请另存可编辑副本后应用。"); }
            catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException) { }
        }

        private void ReadSelection(out dynamic presentation, out dynamic slide, out dynamic shape)
        {
            presentation = null; slide = null; shape = null;
            try
            {
                presentation = application.ActivePresentation;
                dynamic window = application.ActiveWindow;
                if (window == null || (int)window.Selection.Type != 2 || (int)window.Selection.ShapeRange.Count != 1)
                    throw new InvalidOperationException("请在 PowerPoint 中选中一个可填充的绘图形状。");
                slide = window.View.Slide;
                shape = window.Selection.ShapeRange[1];
                // Top-level identity check rejects selections inside groups.
                if (FindShape(slide, (int)shape.Id) == null)
                    throw new InvalidOperationException("当前接入测试版尚未支持组合内形状，原组合保持不变。");
                if (!String.IsNullOrEmpty(Tag(shape, Prefix + "BACKUP_KEY")))
                    throw new InvalidOperationException("这是原外观备份，请选择可见的材质形状。");
            }
            catch (InvalidOperationException) { throw; }
            catch (Exception e) { throw new InvalidOperationException("请打开可编辑文稿并选中一个绘图形状。" + e.Message); }
        }

        private static string UnsupportedReason(dynamic shape)
        {
            int type = (int)shape.Type;
            if (type != 1 && type != 5) return "当前安装测试版支持单个自选形状与自由形；组合、图片、表格、文字框及线条连接符仍在适配中。";
            double rotation = (double)shape.Rotation;
            if (Math.Abs(rotation % 360) > .001) return "旋转形状仍在适配中，请将旋转设为 0° 后使用。";
            if ((int)shape.HorizontalFlip == -1 || (int)shape.VerticalFlip == -1) return "翻转形状仍在适配中，当前形状保持不变。";
            if ((double)shape.Width < 2 || (double)shape.Height < 2) return "形状宽高需至少为 2 磅。";
            try { if ((int)shape.ThreeD.Visible == -1) return "当前测试版暂不处理 PowerPoint 原生三维变换形状。"; } catch { }
            return null;
        }

        private void ValidateTarget(Target target, dynamic presentation, dynamic slide, dynamic shape)
        {
            if (Identity(presentation) != target.PresentationIdentity || (int)slide.SlideID != target.SlideId ||
                (int)shape.Id != target.ShapeId || Geometry(presentation, shape) != target.Geometry || MaterialState(shape) != target.MaterialState || UnsupportedReason(shape) != null)
                throw Stale();
        }

        private static InvalidOperationException Stale() { return new InvalidOperationException("STALE_TARGET: 选区、文稿或形状状态已变化，请重新读取所选形状。"); }

        private static long Identity(object com)
        {
            IntPtr pointer = Marshal.GetIUnknownForObject(com);
            try { return pointer.ToInt64(); } finally { Marshal.Release(pointer); }
        }

        private static string SelectionIdentity(dynamic presentation, dynamic slide, dynamic shape)
        {
            return Identity(presentation).ToString(CultureInfo.InvariantCulture) + ":" +
                ((int)slide.SlideID).ToString(CultureInfo.InvariantCulture) + ":" + ((int)shape.Id).ToString(CultureInfo.InvariantCulture);
        }

        // Office undo/redo restores our tags along with the fill. Observe these independently
        // from geometry, and reject a pending write if undo happened before the next watch tick.
        private static string MaterialState(dynamic shape)
        {
            var tags = new SortedDictionary<string, string>(StringComparer.Ordinal);
            for (int i = 1; i <= (int)shape.Tags.Count; ++i)
            {
                string name = (string)shape.Tags.Name(i);
                if (name.StartsWith(Prefix + "META_", StringComparison.OrdinalIgnoreCase) ||
                    String.Equals(name, Prefix + "BACKUP", StringComparison.OrdinalIgnoreCase))
                    tags[name] = (string)shape.Tags.Item(name);
            }
            var value = new StringBuilder();
            foreach (var tag in tags) value.Append(tag.Key.Length).Append(':').Append(tag.Key).Append(tag.Value.Length).Append(':').Append(tag.Value);
            using (var sha = SHA256.Create()) return Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(value.ToString())));
        }

        private string Geometry(dynamic presentation, dynamic shape, bool watch = false)
        {
            var value = new StringBuilder();
            foreach (object item in new object[] { shape.Type, shape.Left, shape.Top, shape.Width, shape.Height,
                shape.Rotation, shape.HorizontalFlip, shape.VerticalFlip, presentation.PageSetup.SlideWidth, presentation.PageSetup.SlideHeight })
                value.Append(Convert.ToString(item, CultureInfo.InvariantCulture)).Append('|');
            try { value.Append((int)shape.AutoShapeType).Append('|'); } catch { }
            try { for (int i = 1; i <= (int)shape.Adjustments.Count; ++i) value.Append(Convert.ToString(shape.Adjustments[i], CultureInfo.InvariantCulture)).Append('|'); } catch { }
            if ((int)shape.Type == 5)
            {
                string identity = Identity(presentation)+":"+(int)shape.Parent.SlideID+":"+(int)shape.Id;
                value.Append(freeformGeometry.Read(presentation,shape,identity,cacheRoot,watch));
            }
            return value.ToString();
        }

        private static dynamic FindShape(dynamic slide, int id)
        {
            for (int i = 1; i <= (int)slide.Shapes.Count; ++i) { dynamic shape = slide.Shapes[i]; if ((int)shape.Id == id) return shape; }
            return null;
        }

        private static dynamic FindBackup(dynamic slide, dynamic shape)
        {
            string key = Tag(shape, Prefix + "BACKUP");
            if (String.IsNullOrEmpty(key)) return null;
            string owner = ((int)shape.Id).ToString(CultureInfo.InvariantCulture);
            for (int i = 1; i <= (int)slide.Shapes.Count; ++i)
            {
                dynamic candidate = slide.Shapes[i];
                if ((int)candidate.Id != (int)shape.Id && Tag(candidate, Prefix + "BACKUP_KEY") == key && Tag(candidate, Prefix + "OWNER_ID") == owner)
                    return candidate;
            }
            return null;
        }

        private static dynamic FindBackupSource(dynamic slide, dynamic shape)
        {
            string key = Tag(shape, Prefix + "BACKUP");
            if (String.IsNullOrEmpty(key)) return null;
            for (int i = 1; i <= (int)slide.Shapes.Count; ++i)
            {
                dynamic item = slide.Shapes[i];
                if ((int)item.Id != (int)shape.Id && Tag(item, Prefix + "BACKUP_KEY") == key) return item;
            }
            return null;
        }

        private static string Tag(dynamic shape, string name) { try { return (string)shape.Tags.Item(name); } catch { return ""; } }

        private object ReadSettings(dynamic shape)
        {
            string value = ReadRawSettings(shape);
            if (value == null) return null;
            try { return json.DeserializeObject(value); }
            catch { throw new InvalidOperationException("此形状保存的材质参数已损坏。可使用恢复原样后重新应用。"); }
        }

        private static string ReadRawSettings(dynamic shape)
        {
            string countValue = Tag(shape, Prefix + "META_N");
            if (String.IsNullOrEmpty(countValue)) return null;
            int count;
            if (!Int32.TryParse(countValue, out count) || count < 1 || count > (MaxSettingsBytes * 2 + ChunkLength - 1) / ChunkLength)
                throw new InvalidOperationException("材质参数分片数量无效。");
            var data = new StringBuilder();
            for (int i = 0; i < count; ++i) data.Append(Tag(shape, Prefix + "META_" + i.ToString("D4", CultureInfo.InvariantCulture)));
            string hex = data.ToString();
            if (hex.Length % 2 != 0 || hex.Length > MaxSettingsBytes * 2) throw new InvalidOperationException("材质参数分片无效。");
            try
            {
                byte[] bytes = new byte[hex.Length / 2];
                for (int i = 0; i < bytes.Length; ++i) bytes[i] = Byte.Parse(hex.Substring(i * 2, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
                return new UTF8Encoding(false, true).GetString(bytes);
            }
            catch (Exception e) { throw new InvalidOperationException("材质参数解码失败。", e); }
        }

        private static void WriteSettings(dynamic shape, string value)
        {
            ClearSettingsTags(shape);
            string hex = BitConverter.ToString(Encoding.UTF8.GetBytes(value)).Replace("-", "");
            int count = (hex.Length + ChunkLength - 1) / ChunkLength;
            for (int i = 0; i < count; ++i) shape.Tags.Add(Prefix + "META_" + i.ToString("D4", CultureInfo.InvariantCulture), hex.Substring(i * ChunkLength, Math.Min(ChunkLength, hex.Length - i * ChunkLength)));
            shape.Tags.Add(Prefix + "META_N", count.ToString(CultureInfo.InvariantCulture));
        }

        private static void ClearSettingsTags(dynamic shape)
        {
            for (int i = (int)shape.Tags.Count; i >= 1; --i) { string name = (string)shape.Tags.Name(i); if (name.StartsWith(Prefix + "META_", StringComparison.OrdinalIgnoreCase)) shape.Tags.Delete(name); }
        }
        private static void ClearMaterialTags(dynamic shape)
        {
            for (int i = (int)shape.Tags.Count; i >= 1; --i) { string name = (string)shape.Tags.Name(i); if (name.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase)) shape.Tags.Delete(name); }
        }

        private static byte[] ReadPng(IDictionary<string, object> payload)
        {
            object raw;
            if (!payload.TryGetValue("png", out raw) || !(raw is string)) throw new InvalidOperationException("PNG 材质数据缺失。");
            string value = (string)raw;
            const string header = "data:image/png;base64,";
            if (!value.StartsWith(header, StringComparison.Ordinal) || value.Length > 33554432) throw new InvalidOperationException("PNG 材质格式或大小不合要求。");
            byte[] bytes;
            try { bytes = Convert.FromBase64String(value.Substring(header.Length)); } catch { throw new InvalidOperationException("PNG 编码无效。"); }
            if (bytes.Length < 24 || bytes[0] != 137 || bytes[1] != 80 || bytes[2] != 78 || bytes[3] != 71 || bytes[4] != 13 || bytes[5] != 10 || bytes[6] != 26 || bytes[7] != 10)
                throw new InvalidOperationException("材质必须为 PNG 文件。");
            // Check IHDR before asking GDI+ to decode, avoiding oversized image allocations.
            uint width = BigEndian(bytes, 16), height = BigEndian(bytes, 20);
            if (width < 1 || height < 1 || width > 4096 || height > 4096 || (ulong)width * height > 16777216)
                throw new InvalidOperationException("材质尺寸需在 1–4096 像素范围内。");
            using (var stream = new MemoryStream(bytes))
            using (var image = Image.FromStream(stream, true, true))
                if (image.RawFormat.Guid != ImageFormat.Png.Guid || image.Width != width || image.Height != height) throw new InvalidOperationException("PNG 数据无法验证。");
            return bytes;
        }
        private static uint BigEndian(byte[] bytes, int offset) { return ((uint)bytes[offset] << 24) | ((uint)bytes[offset + 1] << 16) | ((uint)bytes[offset + 2] << 8) | bytes[offset + 3]; }
        private static string PngData(Bitmap bitmap) { using (var stream = new MemoryStream()) { bitmap.Save(stream, ImageFormat.Png); return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray()); } }
        private string NewDirectory() { string path = Path.Combine(cacheRoot, Guid.NewGuid().ToString("N")); Directory.CreateDirectory(path); return path; }
        private void DeleteDirectory(string directory)
        {
            string full = Path.GetFullPath(directory);
            if (!full.StartsWith(cacheRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return;
            try { if (Directory.Exists(full)) Directory.Delete(full, true); } catch { /* A locked Office copy can be removed on a future cache cleanup. */ }
        }
        private static Dictionary<string, object> Map(params object[] values)
        {
            var map = new Dictionary<string, object>();
            for (int i = 0; i < values.Length; i += 2) map[(string)values[i]] = values[i + 1];
            return map;
        }
    }
}

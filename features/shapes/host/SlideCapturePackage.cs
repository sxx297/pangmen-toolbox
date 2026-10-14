using PangmenToolbox.AddIn;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Xml;
using System.Xml.Linq;

namespace PangmenToolbox.Shapes
{
    // Stream only the selected slide's reachable package parts into the capture copy.
    // The source file is the SaveCopyAs snapshot, never the user's open presentation.
    internal static class SlideCapturePackage
    {
        private static XDocument Read(ZipArchiveEntry entry)
        {
            if (entry == null) throw new InvalidDataException("采样副本缺少必要的文稿结构。");
            using (var stream = entry.Open())
            using (var reader = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null }))
                return XDocument.Load(reader);
        }
        private static string Relationships(string part)
        {
            if (part.Length == 0) return "_rels/.rels";
            int slash = part.LastIndexOf('/');
            return (slash < 0 ? "" : part.Substring(0, slash + 1)) + "_rels/" + part.Substring(slash + 1) + ".rels";
        }
        private static string Resolve(string owner, string target)
        {
            var root = new Uri("https://package.local/");
            var resolved = new Uri(new Uri(root, owner), target);
            if (resolved.Host != root.Host || resolved.Scheme != root.Scheme) throw new InvalidDataException("文稿内部资源路径异常。");
            return Uri.UnescapeDataString(resolved.AbsolutePath.TrimStart('/'));
        }
        internal static string ShapeGeometry(string source, int slideId, int shapeId)
        {
            using (var file = File.OpenRead(source))
            using (var input = new ZipArchive(file, ZipArchiveMode.Read))
            {
                const string part = "ppt/presentation.xml";
                var document = Read(input.GetEntry(part));
                XNamespace p = document.Root.Name.Namespace;
                XNamespace r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
                var selected = document.Root.Element(p + "sldIdLst")?.Elements().SingleOrDefault(e => (string)e.Attribute("id") == slideId.ToString(CultureInfo.InvariantCulture));
                string id = (string)selected?.Attribute(r + "id");
                if (String.IsNullOrEmpty(id)) throw new InvalidDataException("轮廓副本中未找到目标幻灯片。");
                var relation = Read(input.GetEntry(Relationships(part))).Root.Elements().SingleOrDefault(e => (string)e.Attribute("Id") == id);
                string target = (string)relation?.Attribute("Target");
                if (String.IsNullOrEmpty(target) || (string)relation.Attribute("TargetMode") == "External") throw new InvalidDataException("轮廓副本中的幻灯片关系无效。");
                var slide = Read(input.GetEntry(Resolve(part,target)));
                p = slide.Root.Name.Namespace;
                var shape = slide.Root.Element(p + "cSld")?.Element(p + "spTree")?.Elements(p + "sp").SingleOrDefault(e =>
                    (string)e.Element(p + "nvSpPr")?.Element(p + "cNvPr")?.Attribute("id") == shapeId.ToString(CultureInfo.InvariantCulture));
                var geometry = shape?.Element(p + "spPr")?.Elements().SingleOrDefault(e => e.Name.LocalName == "custGeom" || e.Name.LocalName == "prstGeom");
                if (geometry == null) throw new InvalidDataException("轮廓副本中未找到可填充路径。");
                // Keep every subpath, guide and close command; exclude fill/style and tags.
                return Canonical(geometry).ToString(SaveOptions.DisableFormatting);
            }
        }
        private static XElement Canonical(XElement element)
        {
            return new XElement(element.Name, element.Attributes().Where(a => !a.IsNamespaceDeclaration).OrderBy(a => a.Name.ToString(), StringComparer.Ordinal).Select(a => new XAttribute(a)), element.Elements().Select(Canonical));
        }
        internal static void Create(string source, string destination, int slideId)
        {
            using (var file = File.OpenRead(source))
            using (var input = new ZipArchive(file, ZipArchiveMode.Read))
            {
                const string presentationPart = "ppt/presentation.xml";
                var document = Read(input.GetEntry(presentationPart));
                XNamespace p = document.Root.Name.Namespace;
                XNamespace r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
                var slides = document.Root.Element(p + "sldIdLst");
                var selected = slides == null ? null : slides.Elements().SingleOrDefault(e => (string)e.Attribute("id") == slideId.ToString(CultureInfo.InvariantCulture));
                if (selected == null) throw new InvalidDataException("采样副本中没有当前幻灯片。");
                string selectedRelationship = (string)selected.Attribute(r + "id");
                if (String.IsNullOrEmpty(selectedRelationship)) throw new InvalidDataException("当前幻灯片关系缺失。");
                foreach (var other in slides.Elements().Where(e => e != selected).ToList()) other.Remove();
                // These lists can contain references to slides intentionally excluded from this copy.
                foreach (var e in document.Descendants().Where(e => e.Name.LocalName == "custShowLst" || e.Name.LocalName == "sectionLst").ToList()) e.Remove();
                var rels = Read(input.GetEntry(Relationships(presentationPart)));
                foreach (var e in rels.Root.Elements().Where(e => ((string)e.Attribute("Type") ?? "").EndsWith("/slide", StringComparison.Ordinal) && (string)e.Attribute("Id") != selectedRelationship).ToList()) e.Remove();
                // Follow relationships rather than filenames: this retains layouts, masters,
                // themes, notes, images, media and embedded objects used by the selected page.
                var replacements = new Dictionary<string, XDocument> { { presentationPart, document }, { Relationships(presentationPart), rels } };
                var included = new HashSet<string>(StringComparer.Ordinal);
                var queue = new Queue<string>(); queue.Enqueue("");
                while (queue.Count > 0)
                {
                    string part = queue.Dequeue();
                    if (part.Length > 0 && !included.Add(part)) continue;
                    string relationPart = Relationships(part);
                    var entry = input.GetEntry(relationPart);
                    if (entry == null) continue;
                    included.Add(relationPart);
                    XDocument relationships;
                    if (!replacements.TryGetValue(relationPart, out relationships)) relationships = Read(entry);
                    foreach (var relation in relationships.Root.Elements())
                    {
                        if (String.Equals((string)relation.Attribute("TargetMode"), "External", StringComparison.OrdinalIgnoreCase)) continue;
                        string target = (string)relation.Attribute("Target");
                        if (String.IsNullOrEmpty(target)) throw new InvalidDataException("文稿资源关系缺少路径。");
                        string resolved = Resolve(part, target);
                        if (input.GetEntry(resolved) == null) throw new InvalidDataException("文稿缺少资源：" + resolved);
                        if (!included.Contains(resolved)) queue.Enqueue(resolved);
                    }
                }
                var types = Read(input.GetEntry("[Content_Types].xml"));
                foreach (var e in types.Root.Elements().Where(e => e.Name.LocalName == "Override" && !included.Contains(Uri.UnescapeDataString(((string)e.Attribute("PartName") ?? "").TrimStart('/')))).ToList()) e.Remove();
                included.Add("[Content_Types].xml"); replacements.Add("[Content_Types].xml", types);
                using (var outputFile = File.Create(destination))
                using (var output = new ZipArchive(outputFile, ZipArchiveMode.Create))
                    foreach (var name in included)
                    {
                        using (var target = output.CreateEntry(name, CompressionLevel.Fastest).Open())
                        {
                            XDocument replacement;
                            if (replacements.TryGetValue(name, out replacement)) replacement.Save(target);
                            else using (var content = input.GetEntry(name).Open()) content.CopyTo(target);
                        }
                    }
            }
        }
    }
}

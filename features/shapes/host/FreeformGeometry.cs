using System;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace PangmenToolbox.Shapes
{
    // One selected-object cache per bridge; a write never trusts the observation cache.
    internal sealed class FreeformGeometry
    {
        private string fallbackIdentity, snapshot, observation;
        internal string Read(dynamic presentation, dynamic shape, string identity, string cacheRoot, bool watch)
        {
            if (fallbackIdentity != identity)
            {
                int index = 0; string property = "Count";
                try
                {
                    dynamic nodes = shape.Nodes;
                    int count = (int)nodes.Count;
                    if (count < 1) throw new InvalidDataException("自由形没有可读节点。");
                    var value = new StringBuilder("nodes:").Append(count).Append('|');
                    for (index = 1; index <= count; index++)
                    {
                        property = "Item"; dynamic node = nodes[index];
                        property = "EditingType"; value.Append((int)node.EditingType).Append(':');
                        property = "SegmentType"; value.Append((int)node.SegmentType).Append(':');
                        property = "Points"; Array points = (Array)node.Points;
                        if (points == null || points.Length < 2) throw new InvalidDataException("节点坐标为空。");
                        foreach (object point in points) value.Append(Convert.ToString(point,CultureInfo.InvariantCulture)).Append(',');
                        value.Append('|');
                    }
                    return value.ToString();
                }
                catch (Exception error)
                {
                    HostDiagnostics.Log("Geometry.NodesFallback", "node="+index+" property="+property+" "+HostDiagnostics.Describe(error));
                    fallbackIdentity = identity; snapshot = null; observation = null;
                }
            }
            string stamp = watch ? Observation(presentation,shape,cacheRoot) : null;
            if (watch && snapshot != null && stamp != null && stamp == observation) return snapshot;
            string path = Path.Combine(cacheRoot,"geometry-"+Guid.NewGuid().ToString("N")+".pptx");
            try
            {
                using (HostDiagnostics.Measure("Geometry.ReadPackage"))
                {
                    presentation.SaveCopyAs(path,24,0);
                    string xml = SlideCapturePackage.ShapeGeometry(path,(int)shape.Parent.SlideID,(int)shape.Id);
                    snapshot = "xml:"+Hash(Encoding.UTF8.GetBytes(xml));
                }
                observation = watch ? stamp : Observation(presentation,shape,cacheRoot);
                return snapshot;
            }
            catch (Exception error)
            {
                snapshot = null;
                HostDiagnostics.Log("Geometry.ReadFailed",HostDiagnostics.Describe(error));
                throw new InvalidOperationException("GEOMETRY_UNAVAILABLE: 已选中形状，但暂时无法读取其轮廓。请退出编辑顶点后点击刷新背景；仍失败时可保留当前参数，换用可编辑的单个矢量形状。");
            }
            finally { try { if (File.Exists(path)) File.Delete(path); } catch { } }
        }
        private static string Observation(dynamic presentation, dynamic shape, string root)
        {
            string path=Path.Combine(root,"geometry-watch-"+Guid.NewGuid().ToString("N")+".png");
            try
            {
                // Read-only visual change hint, not the authoritative write guard. Fully
                // transparent edits are still detected by the fresh package check on apply.
                int w=Math.Max(1,(int)Math.Round(96*(double)presentation.PageSetup.SlideWidth/(double)shape.Width*.75));
                int h=Math.Max(1,(int)Math.Round(96*(double)presentation.PageSetup.SlideHeight/(double)shape.Height*.75));
                shape.Export(path,2,w,h,1);
                return Hash(File.ReadAllBytes(path));
            }
            catch { return null; }
            finally { try { if(File.Exists(path))File.Delete(path); } catch { } }
        }
        private static string Hash(byte[] bytes) { using(var sha=SHA256.Create())return Convert.ToBase64String(sha.ComputeHash(bytes)); }
    }
}

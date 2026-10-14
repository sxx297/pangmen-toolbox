using System;
using System.IO;
using System.Collections.Generic;
using System.Reflection;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

namespace PangmenToolbox.AddIn
{
    internal static class ToolboxRuntime
    {
        internal const string Version = "1.0.11";
        internal static readonly string DataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PangmenToolbox");
        internal static readonly string InstallDirectory = Path.GetDirectoryName(typeof(ToolboxRuntime).Assembly.Location);
        private static readonly object sync = new object();
        private static bool busy;
        internal static bool Busy { get { lock(sync) return busy; } }
        internal static IDisposable Enter(string operation)
        {
            lock(sync)
            {
                if(busy) throw new InvalidOperationException("其他工具正在处理文稿，请稍候再试。");
                LicenseGate.Demand(operation);
                busy = true; return new Operation();
            }
        }
        private sealed class Operation : IDisposable
        {
            private bool disposed;
            public void Dispose() { lock(sync) { if(!disposed) { disposed=true; busy=false; } } }
        }
        internal static void VerifyAssets()
        {
            using(var resource = typeof(ToolboxRuntime).Assembly.GetManifestResourceStream("PangmenToolbox.AssetIntegrity.json"))
            {
                if(resource == null) throw new InvalidOperationException("安装完整性清单缺失，请重新安装旁门工具箱。");
                Dictionary<string,string> manifest;
                using(var reader = new StreamReader(resource)) manifest = new JavaScriptSerializer().Deserialize<Dictionary<string,string>>(reader.ReadToEnd());
                foreach(var item in manifest)
                {
                    string file = Path.GetFullPath(Path.Combine(InstallDirectory,item.Key));
                    if(!file.StartsWith(InstallDirectory + Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("资产路径无效。");
                    if(!File.Exists(file)) throw new FileNotFoundException("安装文件缺失：" + item.Key);
                    using(var sha=SHA256.Create()) using(var stream=File.OpenRead(file))
                    {
                        string hash=BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                        if(hash != item.Value) throw new InvalidDataException("安装文件校验失败：" + item.Key + "。请重新安装，不要继续操作文稿。");
                    }
                }
            }
        }
    }
    // Product policy is deliberately unconfigured. No device IDs, network or paid service.
    internal static class LicenseGate
    {
        internal static string State { get { return "unconfigured"; } }
        internal static void Demand(string capability) { }
    }
}

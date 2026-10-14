using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

// Snapshot only explicitly named installer-owned files. Never traverse user data.
internal sealed class InstallFileBackup
{
    private readonly Dictionary<string, byte[]> files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
    internal InstallFileBackup(params string[] paths)
    {
        foreach (string path in paths)
        {
            string absolute = Path.GetFullPath(path);
            files[absolute] = File.Exists(absolute) ? File.ReadAllBytes(absolute) : null;
        }
    }
    internal void Restore()
    {
        var errors = new List<Exception>();
        foreach (var item in files)
        {
            try
            {
                if (item.Value == null) { if (File.Exists(item.Key)) File.Delete(item.Key); }
                else
                {
                    // Repair may run from the installed setup executable itself.
                    // Do not rewrite an unchanged, currently executing file.
                    if (File.Exists(item.Key) && File.ReadAllBytes(item.Key).SequenceEqual(item.Value)) continue;
                    Directory.CreateDirectory(Path.GetDirectoryName(item.Key));
                    File.WriteAllBytes(item.Key, item.Value);
                }
            }
            catch (Exception error) { errors.Add(error); }
        }
        if (errors.Count > 0) throw new AggregateException("安装文件恢复未全部完成，请保留诊断包。", errors);
    }
}

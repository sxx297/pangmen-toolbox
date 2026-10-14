using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Web.Script.Serialization;
using Microsoft.Win32;

// Migrate only named legacy product data and per-user Office entry values.
// Never remove their COM classes, binaries, uninstallers, or data.
internal sealed class LegacyMigration : IDisposable
{
    private readonly string root, record;
    private readonly JavaScriptSerializer json=new JavaScriptSerializer { MaxJsonLength=16*1024*1024 };
    private readonly List<Entry> changed=new List<Entry>();
    private bool committed;
    public sealed class Entry
    {
        public string ProgId { get; set; }
        public int View { get; set; }
        public bool KeyExisted { get; set; }
        public bool ValueExisted { get; set; }
        public int Kind { get; set; }
        public object Value { get; set; }
    }
    internal LegacyMigration(string root) { this.root=root;record=Path.Combine(root,"legacy-addins.json"); }
    internal void BackupAndCopyData()
    {
        string stamp=DateTime.UtcNow.ToString("yyyyMMddTHHmmss")+"-"+Guid.NewGuid().ToString("N").Substring(0,8);
        foreach(var pair in new[]{new[]{"ShapeEffects","shapes"},new[]{"PangmenAnimation","animations"}})
        {
            string source=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),pair[0]);
            string target=Path.Combine(root,pair[1]);
            string marker=Path.Combine(target,"legacy-data-imported.json");
            if(File.Exists(marker) || !Directory.Exists(source))continue;
            string backup=Path.Combine(root,"migration-backups",stamp,pair[0]);
            var files=new List<object>();
            foreach(string name in new[]{"WebView2","webview","panel-mode.txt"})
            {
                string original=Path.Combine(source,name),copy=Path.Combine(backup,name),destination=Path.Combine(target,name);
                if(File.Exists(original)) { Directory.CreateDirectory(backup);File.Copy(original,copy,false);files.Add(new{path=name,sha256=DiagnosticData.Hash(copy)}); }
                else if(Directory.Exists(original))CopyTree(original,copy,files,name);
                else continue;
                // Do not replace an already-created toolbox profile or preference.
                if(File.Exists(destination) || Directory.Exists(destination))continue;
                Directory.CreateDirectory(target);
                if(File.Exists(copy))File.Copy(copy,destination,false);else CopyTree(copy,destination,null,name);
            }
            Directory.CreateDirectory(target);Directory.CreateDirectory(backup);
            File.WriteAllText(Path.Combine(backup,"manifest.json"),json.Serialize(files));
            File.WriteAllText(marker,json.Serialize(new{source=pair[0],backup,importedAt=DateTime.UtcNow.ToString("O")}));
        }
    }
    private static void CopyTree(string source,string destination,List<object> files,string relative)
    {
        if((File.GetAttributes(source)&FileAttributes.ReparsePoint)!=0)throw new IOException("用户数据包含链接目录，未自动迁移："+source);
        Directory.CreateDirectory(destination);
        foreach(string file in Directory.GetFiles(source))
        {
            if((File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0)throw new IOException("用户数据包含链接文件。");
            string name=Path.GetFileName(file),copy=Path.Combine(destination,name);
            File.Copy(file,copy,false);
            if(files!=null)files.Add(new{path=relative+"/"+name,sha256=DiagnosticData.Hash(copy)});
        }
        foreach(string directory in Directory.GetDirectories(source))
        {
            string name=Path.GetFileName(directory);
            if(new[]{"Cache","Code Cache","GPUCache","ShaderCache","Crashpad","GrShaderCache","DawnGraphiteCache"}.Contains(name,StringComparer.OrdinalIgnoreCase))continue;
            CopyTree(directory,Path.Combine(destination,name),files,relative+"/"+name);
        }
    }
    internal void DisableLegacyEntries()
    {
        if(File.Exists(record))return; // Preserve the original values across toolbox upgrades.
        foreach(var view in DiagnosticData.Views())
        foreach(string id in new[]{"ShapeEffects.AddIn","PangmenAnimation.AddIn"})
        using(var user=RegistryKey.OpenBaseKey(RegistryHive.CurrentUser,view))
        using(var machine=RegistryKey.OpenBaseKey(RegistryHive.LocalMachine,view))
        {
            string path=@"Software\Microsoft\Office\PowerPoint\Addins\"+id;
            Entry entry;
            using(var key=user.OpenSubKey(path))using(var global=machine.OpenSubKey(path))
            {
                if(key==null && global==null)continue;
                bool exists=key!=null && key.GetValueNames().Contains("LoadBehavior",StringComparer.OrdinalIgnoreCase);
                if(exists && key.GetValueKind("LoadBehavior")!=RegistryValueKind.DWord)throw new InvalidDataException("旧插件 LoadBehavior 类型异常，未修改："+id);
                entry=new Entry { ProgId=id,View=(int)view,KeyExisted=key!=null,ValueExisted=exists,Kind=(int)RegistryValueKind.DWord,Value=exists?key.GetValue("LoadBehavior"):null };
            }
            changed.Add(entry);
            using(var key=user.CreateSubKey(path)){key.SetValue("LoadBehavior",0,RegistryValueKind.DWord);key.SetValue("PangmenToolboxMigration","1",RegistryValueKind.String);}
        }
        File.WriteAllText(record,json.Serialize(changed));
    }
    internal void Commit(){committed=true;}
    private static void Restore(IEnumerable<Entry> entries)
    {
        foreach(var entry in entries)
        using(var user=RegistryKey.OpenBaseKey(RegistryHive.CurrentUser,(RegistryView)entry.View))
        {
            if(entry.ProgId!="ShapeEffects.AddIn" && entry.ProgId!="PangmenAnimation.AddIn")throw new InvalidDataException("未知旧插件标识。");
            string path=@"Software\Microsoft\Office\PowerPoint\Addins\"+entry.ProgId;
            bool remove=false;
            using(var key=user.OpenSubKey(path,true))
            {
                if(key==null || Convert.ToString(key.GetValue("PangmenToolboxMigration"))!="1")continue;
                if(Convert.ToInt32(key.GetValue("LoadBehavior",-1))==0)
                {
                    if(entry.ValueExisted)key.SetValue("LoadBehavior",Convert.ToInt32(entry.Value),RegistryValueKind.DWord);
                    else key.DeleteValue("LoadBehavior",false);
                }
                key.DeleteValue("PangmenToolboxMigration",false);
                remove=!entry.KeyExisted && key.ValueCount==0 && key.SubKeyCount==0;
            }
            if(remove)user.DeleteSubKey(path,false);
        }
    }
    internal static void RestoreOnUninstall(string root)
    {
        string record=Path.Combine(root,"legacy-addins.json");if(!File.Exists(record))return;
        var entries=new JavaScriptSerializer().Deserialize<List<Entry>>(File.ReadAllText(record));
        Restore(entries);File.Move(record,record+".restored-"+Guid.NewGuid().ToString("N"));
    }
    public void Dispose()
    {
        if(committed)return;
        Restore(changed);
        if(changed.Count>0 && File.Exists(record))File.Delete(record);
    }
}

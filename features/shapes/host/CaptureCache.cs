using PangmenToolbox.AddIn;
using System;
using System.Collections.Generic;

namespace PangmenToolbox.Shapes
{
    // Managed data only: no cached Office objects or open temporary presentations.
    internal sealed class CaptureCache
    {
        internal sealed class Entry { internal string Key, Mask; internal byte[] Scene; internal long Bytes; }
        private readonly LinkedList<Entry> entries = new LinkedList<Entry>();
        private const long Limit = 48L * 1024 * 1024;
        private long bytes;
        private string page;
        internal void UsePage(string value) { if (page != value) { Clear(); page = value; } }
        internal void Clear() { entries.Clear(); bytes = 0; }
        internal Entry Get(string key)
        {
            if (key == null) return null;
            for (var node = entries.First; node != null; node = node.Next)
                if (node.Value.Key == key) { var result = node.Value; entries.Remove(node); entries.AddFirst(result); return result; }
            return null;
        }
        internal void Put(string key, byte[] scene, string mask)
        {
            long size = scene.LongLength + mask.Length * 2L + key.Length * 2L;
            if (size > Limit) return;
            var previous = Get(key);
            if (previous != null) { entries.Remove(previous); bytes -= previous.Bytes; }
            while (entries.Count >= 2 || bytes + size > Limit) { bytes -= entries.Last.Value.Bytes; entries.RemoveLast(); }
            entries.AddFirst(new Entry { Key = key, Scene = scene, Mask = mask, Bytes = size }); bytes += size;
        }
    }
}

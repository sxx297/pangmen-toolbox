using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Xml.Linq;
namespace Pangmen.Motion {
    // Called on the Office STA. Keep the per-paragraph COM loop out of PowerShell.
    public static class NumericTimeline {
        public static void Compact(string source, string destination) {
            XNamespace p="http://schemas.openxmlformats.org/presentationml/2006/main";
            using(var input=ZipFile.OpenRead(source)) using(var output=ZipFile.Open(destination,ZipArchiveMode.Create)) {
                foreach(var item in input.Entries) {
                    var target=output.CreateEntry(item.FullName,CompressionLevel.Optimal);
                    using(var read=item.Open()) using(var write=target.Open()) {
                        if(item.FullName!="ppt/slides/slide1.xml") {read.CopyTo(write);continue;}
                        // Spaces in a:t are actual paragraph content and carry bullet font metrics.
                        var doc=XDocument.Load(read,LoadOptions.PreserveWhitespace);
                        var effects=doc.Descendants(p+"cTn").Where(n=>n.Attribute("presetClass")!=null).ToArray();
                        var entries=effects.Where(n=>(string)n.Attribute("presetClass")=="entr").ToArray();
                        var exits=effects.Where(n=>(string)n.Attribute("presetClass")=="exit").ToArray();
                        if(entries.Length<2 || entries.Length!=exits.Length)throw new InvalidOperationException("Invalid numeric frame template");
                        var basis=entries[0];var children=basis.Element(p+"childTnLst");
                        var first=children.Elements().Select(n=>new XElement(n)).ToArray();children.RemoveNodes();
                        int start=(int)basis.Element(p+"stCondLst").Element(p+"cond").Attribute("delay");
                        Action<XElement,int> append=(node,delay)=>{
                            var copy=new XElement(node);
                            copy.Element(p+"cBhvr").Element(p+"cTn").Element(p+"stCondLst").Element(p+"cond").SetAttributeValue("delay",delay);
                            children.Add(copy);
                        };
                        const int overlap=2;
                        for(int i=0;i<entries.Length;i++) {
                            int delay=(int)entries[i].Element(p+"stCondLst").Element(p+"cond").Attribute("delay")-start;
                            var parts=i==0?first:entries[i].Element(p+"childTnLst").Elements().ToArray();
                            foreach(var node in parts.OrderBy(n=>n.Name.LocalName=="anim"?0:1))append(node,delay);
                            // Let the next texture become visible before hiding the
                            // previous one. PowerPoint video export may otherwise
                            // process equal-time exit/entry records in the opposite
                            // order and emit one blank frame while decoding a bullet.
                            if(i>0)foreach(var node in exits[i-1].Element(p+"childTnLst").Elements())append(node,delay+overlap);
                        }
                        var last=exits[exits.Length-1];
                        int end=(int)last.Element(p+"stCondLst").Element(p+"cond").Attribute("delay")-start;
                        // Keep the final texture alive for the same two milliseconds
                        // while the editable source text is handed back.
                        foreach(var node in last.Element(p+"childTnLst").Elements())append(node,end+overlap);
                        foreach(var effect in effects)if(effect!=basis)effect.Parent.Remove();
                        foreach(var build in doc.Descendants(p+"bldP").ToArray())if((string)build.Attribute("grpId")!=(string)basis.Attribute("grpId"))build.Remove();
                        var ids=doc.Descendants(p+"cTn").Select(n=>(string)n.Attribute("id")).ToArray();
                        if(doc.Descendants(p+"tn").Any(n=>!ids.Contains((string)n.Attribute("val"))))throw new InvalidOperationException("Invalid numeric timeline reference");
                        doc.Save(write);
                    }
                }
            }
        }
        public static object Create(object slideObject, string[] files, float left, float top, float width, float height,
            string owner, string name, float delay, float duration) {
            dynamic slide = slideObject;
            float sw = (float)slide.Parent.PageSetup.SlideWidth;
            dynamic box = slide.Shapes.AddTextbox(1, left - 2 * sw, top + height - 1, Math.Max(300, width + 150), height + 50);
            box.Name = name; box.Fill.Visible = 0; box.Line.Visible = 0;
            box.Tags.Add("PANG_OWNER", owner); box.Tags.Add("PANG_HELPER", "number");
            box.Tags.Add("PANG_NUMERIC_VERSION", "0810");
            dynamic tf = box.TextFrame;
            tf.AutoSize = 0; tf.WordWrap = 0;
            tf.MarginTop = 0f; tf.MarginLeft = 0f; tf.MarginRight = 0f; tf.MarginBottom = 0f;
            var paragraphs = new string[files.Length]; for(int i=0;i<paragraphs.Length;i++) paragraphs[i]=" ";
            tf.TextRange.Text = String.Join("\r", paragraphs);
            tf.TextRange.Font.Name = "Arial"; tf.TextRange.Font.Size = height / .7f;
            dynamic pf = tf.TextRange.ParagraphFormat;
            pf.LineRuleWithin = 0; pf.SpaceWithin = 0f; pf.LineRuleBefore = 0; pf.SpaceBefore = 0f; pf.LineRuleAfter = 0; pf.SpaceAfter = 0f;
            tf.Ruler.Levels.Item(1).FirstMargin = 0f; tf.Ruler.Levels.Item(1).LeftMargin = 0f;
            for(int i=0;i<files.Length;i++) {
                dynamic bullet = tf.TextRange.Paragraphs(i+1,1).ParagraphFormat.Bullet;
                bullet.Picture(files[i]); bullet.RelativeSize = 1f;
            }
            dynamic seq = slide.TimeLine.MainSequence;
            for(int exit=0;exit<2;exit++) {
                int before = (int)seq.Count; seq.AddEffect(box,1,2,2);
                if((int)seq.Count-before!=files.Length) throw new InvalidOperationException("数字帧段落未完整生成。");
                for(int i=0;i<files.Length;i++) {
                    dynamic e=seq.Item(before+i+1);
                    if(exit==1) { e.Exit=-1; e=seq.Item(before+i+1); }
                    e.Timing.Duration=.001f; e.Timing.TriggerType=2;
                    e.Timing.TriggerDelayTime=Math.Max(0f,delay+(i+exit)*duration/files.Length);
                    if(exit==0) {
                        dynamic behavior=e.Behaviors.Add(5); behavior.Timing.Duration=.001f;
                        dynamic property=behavior.PropertyEffect; property.Property=1; property.Points.Smooth=0;
                        for(int k=0;k<2;k++){dynamic point=property.Points.Add();point.Time=(float)k;point.Value="#ppt_x+2";}
                    }
                }
            }
            return box;
        }
        public static void Warm(object shapeObject, object slideObject, string file) {
            dynamic shape=shapeObject, slide=slideObject;
            shape.Export(file,2,(int)((float)slide.Parent.PageSetup.SlideWidth*1.5f),(int)((float)slide.Parent.PageSetup.SlideHeight*1.5f),1);
        }
    }
}

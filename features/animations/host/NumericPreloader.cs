using PangmenToolbox.AddIn;
using System;
using System.IO;
using System.Runtime.InteropServices;

namespace PangmenToolbox.Animations {
    // Office lazily decodes picture bullets. Warm them on open and before a show starts.
    internal sealed class NumericPreloader : IDisposable {
        static readonly Guid Events = new Guid("914934c2-5a91-11cf-8700-00aa0060263b");
        readonly object application;
        readonly Action<object> opened, show;
        bool openAttached, showAttached;
        internal NumericPreloader(object app) {
            application=app;
            opened=p=>SafeWarm(p);
            show=w=>{try{SafeWarm((object)((dynamic)w).Presentation);}catch(Exception ex){HostDiagnostics.Log("Numeric.WarmShow",ex.Message);}};
            try {ComEventsHelper.Combine(app,Events,2021,opened);openAttached=true;}catch(Exception ex){HostDiagnostics.Log("Numeric.OpenEvent",ex.Message);}
            try {ComEventsHelper.Combine(app,Events,2011,show);showAttached=true;}catch(Exception ex){HostDiagnostics.Log("Numeric.ShowEvent",ex.Message);}
        }
        void SafeWarm(object presentation) {
            try {int count=WarmPresentation(presentation);if(count>0)HostDiagnostics.Log("Numeric.Preloaded",count+" containers");}
            catch(Exception ex){HostDiagnostics.Log("Numeric.PreloadError",HostDiagnostics.Describe(ex));}
        }
        internal void WarmOpenPresentations() {
            try {dynamic list=((dynamic)application).Presentations;int count=(int)list.Count;for(int i=1;i<=count;i++)SafeWarm((object)list.Item(i));}
            catch(Exception ex){HostDiagnostics.Log("Numeric.WarmStartup",ex.Message);}
        }
        internal static int WarmPresentation(object presentation) {
            dynamic p=presentation; int count=0;
            string file=Path.Combine(Path.GetTempPath(),"PangmenAnimation-warm-"+Guid.NewGuid().ToString("N")+".png");
            try {
                int width=(int)((float)p.PageSetup.SlideWidth*1.5f),height=(int)((float)p.PageSetup.SlideHeight*1.5f);
                dynamic slides=p.Slides;int slideCount=(int)slides.Count;
                for(int i=1;i<=slideCount;i++) {
                    dynamic shapes=slides.Item(i).Shapes;int shapeCount=(int)shapes.Count;
                    for(int j=1;j<=shapeCount;j++) {
                        dynamic shape=shapes.Item(j);
                        string numericVersion=(string)shape.Tags.Item("PANG_NUMERIC_VERSION");
                        if(String.Equals((string)shape.Tags.Item("PANG_HELPER"),"number",StringComparison.OrdinalIgnoreCase) &&
                           (numericVersion=="086" || numericVersion=="0810")) {shape.Export(file,2,width,height,1);count++;}
                    }
                }
                return count;
            } finally {if(File.Exists(file))File.Delete(file);}
        }
        public void Dispose() {
            if(openAttached){try{ComEventsHelper.Remove(application,Events,2021,opened);}catch{}openAttached=false;}
            if(showAttached){try{ComEventsHelper.Remove(application,Events,2011,show);}catch{}showAttached=false;}
        }
    }
}

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;

namespace Pangmen.Motion {
    public sealed class NumericGlyphAtlas : IDisposable {
        public Dictionary<char,Bitmap> Glyphs=new Dictionary<char,Bitmap>();
        public Dictionary<char,float> Widths=new Dictionary<char,float>();
        public float LineHeight,Pad;
        public void Dispose(){foreach(var image in Glyphs.Values)image.Dispose();}
    }
    public sealed class NumericFrameResult {
        public string[] Files; public float Width, Height, Left, Top; public int Frames;
    }
    // Transparent local textures; never rasterize the slide or its background.
    public static class NumericFrameRenderer {
        // Native Office glyphs avoid a font renderer change when handing back to editable text.
        public static NumericGlyphAtlas ReadAtlas(string file,string chars,float[] lefts,float[] widths,float top,float height,
            float markerLeft,float markerTop,float markerWidth,float markerHeight,float size) {
            using(var bitmap=new Bitmap(file)) {
                int minX=bitmap.Width,minY=bitmap.Height,maxX=0,maxY=0;
                for(int y=0;y<bitmap.Height;y++)for(int x=0;x<bitmap.Width;x++){
                    var c=bitmap.GetPixel(x,y);if(c.R>250&&c.G<5&&c.B>250&&c.A>250){minX=Math.Min(minX,x);minY=Math.Min(minY,y);maxX=Math.Max(maxX,x);maxY=Math.Max(maxY,y);}
                }
                if(minX>maxX)throw new InvalidOperationException("Missing atlas calibration markers");
                float sx=(maxX-minX+1)/markerWidth,sy=(maxY-minY+1)/markerHeight,ox=minX-markerLeft*sx,oy=minY-markerTop*sy;
                for(int y=0;y<bitmap.Height;y++)for(int x=0;x<bitmap.Width;x++){
                    if((x<=minX+Math.Ceiling(sx*2)+1&&y<=minY+Math.Ceiling(sy*2)+1)||
                       (x>=maxX-Math.Ceiling(sx*2)-1&&y>=maxY-Math.Ceiling(sy*2)-1))bitmap.SetPixel(x,y,Color.Transparent);
                }
                var atlas=new NumericGlyphAtlas{LineHeight=height*2,Pad=size*2*.18f};
                for(int i=0;i<chars.Length;i++){
                    float width=widths[i]*2;var glyph=new Bitmap((int)Math.Ceiling(width+atlas.Pad*2),(int)Math.Ceiling(atlas.LineHeight+atlas.Pad*2),PixelFormat.Format32bppArgb);
                    using(var g=Graphics.FromImage(glyph)){
                        g.InterpolationMode=InterpolationMode.HighQualityBicubic;g.PixelOffsetMode=PixelOffsetMode.HighQuality;
                        g.DrawImage(bitmap,new RectangleF(0,0,glyph.Width,glyph.Height),new RectangleF(ox+(lefts[i]-atlas.Pad/2)*sx,oy+(top-atlas.Pad/2)*sy,glyph.Width/2f*sx,glyph.Height/2f*sy),GraphicsUnit.Pixel);
                    }
                    atlas.Glyphs.Add(chars[i],glyph);atlas.Widths.Add(chars[i],width);
                }
                return atlas;
            }
        }
        // Calibrate Office's padded export bounds before cutting exact text-range rectangles.
        public static void CropCharacters(string file,string folder,float[] left,float[] top,float[] width,float[] height,
            float markerLeft,float markerTop,float markerWidth,float markerHeight) {
            using(var bitmap=new Bitmap(file)) {
                int minX=bitmap.Width,minY=bitmap.Height,maxX=0,maxY=0;
                for(int y=0;y<bitmap.Height;y++)for(int x=0;x<bitmap.Width;x++) {
                    var c=bitmap.GetPixel(x,y);if(c.R>250&&c.G<5&&c.B>250&&c.A>250){minX=Math.Min(minX,x);minY=Math.Min(minY,y);maxX=Math.Max(maxX,x);maxY=Math.Max(maxY,y);}
                }
                if(minX>maxX)throw new InvalidOperationException("Character calibration markers missing");
                float sx=(maxX-minX+1)/markerWidth,sy=(maxY-minY+1)/markerHeight,ox=minX-markerLeft*sx,oy=minY-markerTop*sy;
                for(int i=0;i<left.Length;i++)using(var glyph=new Bitmap(Math.Max(1,(int)Math.Ceiling(width[i]*sx)),Math.Max(1,(int)Math.Ceiling(height[i]*sy)),PixelFormat.Format32bppArgb)) {
                    using(var g=Graphics.FromImage(glyph)) {g.InterpolationMode=InterpolationMode.HighQualityBicubic;g.PixelOffsetMode=PixelOffsetMode.HighQuality;g.DrawImage(bitmap,new RectangleF(0,0,glyph.Width,glyph.Height),new RectangleF(ox+left[i]*sx,oy+top[i]*sy,width[i]*sx,height[i]*sy),GraphicsUnit.Pixel);}
                    glyph.Save(Path.Combine(folder,i+".png"),ImageFormat.Png);
                }
            }
        }
        static double Clamp(double x) { return Math.Max(0,Math.Min(1,x)); }
        static double Smooth(double x) { x=Clamp(x);return x*x*x*(x*(x*6-15)+10); }
        public static double Reel(double p,int column,int columns,int target) {
            double start=.025*column/Math.Max(1,columns-1), finish=.76+.12*column/Math.Max(1,columns-1);
            return (10+target)*Smooth((p-start)/(finish-start));
        }
        public static NumericFrameResult Render(string folder,string text,double value,int decimals,string family,float size,int style,int rgb,
            float sourceLeft,float sourceTop,float sourceWidth,float[] finalCenters,double duration,bool roll,int fps,NumericGlyphAtlas nativeAtlas) {
            Directory.CreateDirectory(folder);
            const float scale=2f;
            using(var font=new Font(family,size*scale,(FontStyle)style,GraphicsUnit.Pixel))
            using(var scratch=new Bitmap(1,1))
            using(var measure=Graphics.FromImage(scratch))
            using(var format=(StringFormat)StringFormat.GenericTypographic.Clone()) {
                format.FormatFlags|=StringFormatFlags.MeasureTrailingSpaces|StringFormatFlags.NoWrap;
                float digitWidth=0;
                var advances=new Dictionary<char,float>();
                foreach(char c in "0123456789"+text) if(!advances.ContainsKey(c))advances[c]=nativeAtlas==null?measure.MeasureString(c.ToString(),font,10000,format).Width:nativeAtlas.Widths[c];
                foreach(char c in "0123456789")digitWidth=Math.Max(digitWidth,advances[c]);
                var widths=new float[text.Length];int columns=0;
                for(int i=0;i<text.Length;i++){widths[i]=Char.IsDigit(text[i])?digitWidth:advances[text[i]];if(Char.IsDigit(text[i]))columns++;}
                float pad=size*scale*.18f,lineHeight=nativeAtlas==null?font.GetHeight(measure):nativeAtlas.LineHeight,height=lineHeight+2*pad;
                // Keep every slot on the original character centre for the whole
                // animation. The old widest-digit layout moved into place during
                // the final 9%, which was visible with proportional fonts.
                float minX=float.MaxValue,maxX=float.MinValue;
                for(int i=0;i<text.Length;i++){
                    float absolute=finalCenters[i]*scale;
                    minX=Math.Min(minX,absolute-widths[i]/2-pad);
                    maxX=Math.Max(maxX,absolute+widths[i]/2+pad);
                }
                int w=(int)Math.Ceiling(maxX-minX),h=(int)Math.Ceiling(height);
                float left=minX/scale,top=sourceTop-pad/scale;
                var centers=new float[text.Length];
                for(int i=0;i<text.Length;i++)centers[i]=finalCenters[i]*scale-minX;
                var glyphs=new Dictionary<char,Bitmap>();
                try {
                    foreach(char c in advances.Keys){
                        if(nativeAtlas!=null){glyphs.Add(c,(Bitmap)nativeAtlas.Glyphs[c].Clone());continue;}
                        var glyph=new Bitmap((int)Math.Ceiling(advances[c]+pad*2),h,PixelFormat.Format32bppArgb);
                        using(var g=Graphics.FromImage(glyph))using(var brush=new SolidBrush(Color.FromArgb(255,rgb&255,(rgb>>8)&255,(rgb>>16)&255))){
                            g.TextRenderingHint=TextRenderingHint.AntiAliasGridFit;g.DrawString(c.ToString(),font,brush,pad,pad,format);
                        }
                        glyphs.Add(c,glyph);
                    }
                    // Keep short effects at 60 fps, but cap long effects at 120
                    // textures. PowerPoint creates two timing records per image;
                    // unbounded 4 s effects previously needed 480 COM records and
                    // could take more than 20 seconds to apply. The cap still gives
                    // a 4 s effect 30 distinct frames while halving that workload.
                    int frames=Math.Max(2,Math.Min(120,(int)Math.Ceiling(duration*fps)));var files=new string[frames];
                    for(int frame=0;frame<frames;frame++) {
                        double p=frame/(double)(frames-1);
                        string magnitude=(Math.Abs(value)* (1-Math.Pow(1-Clamp(p/.86),3))).ToString("F"+decimals,CultureInfo.InvariantCulture).Replace(".","").PadLeft(columns,' ');
                        using(var bitmap=new Bitmap(w,h,PixelFormat.Format32bppArgb))using(var g=Graphics.FromImage(bitmap)) {
                            g.CompositingMode=CompositingMode.SourceOver;g.InterpolationMode=InterpolationMode.HighQualityBicubic;g.PixelOffsetMode=PixelOffsetMode.HighQuality;
                            int col=0;
                            for(int i=0;i<text.Length;i++) {
                                char c=text[i];float cx=centers[i];
                                if(Char.IsDigit(c)) {
                                    if(roll && p<.89) {
                                        double offset=Reel(p,col,columns,c-'0');int whole=(int)Math.Floor(offset);float fraction=(float)(offset-whole);
                                        var saved=g.Save();g.SetClip(new RectangleF(cx-widths[i]/2,pad,widths[i],lineHeight));
                                        Draw(g,glyphs,(char)('0'+whole%10),cx,-fraction*lineHeight,pad,advances);
                                        Draw(g,glyphs,(char)('0'+(whole+1)%10),cx,(1-fraction)*lineHeight,pad,advances);
                                        g.Restore(saved);
                                    } else {
                                        char shown=p>=.86?c:magnitude[Math.Min(col,magnitude.Length-1)];
                                        if(shown!=' ')Draw(g,glyphs,shown,cx,0,pad,advances);
                                    }
                                    col++;
                                } else {
                                    // Group separators reserve space without appearing before their high digits.
                                    bool hidden=!roll && c==',' && p<.86 && col>0 && magnitude[Math.Min(col-1,magnitude.Length-1)]==' ';
                                    if(!hidden)Draw(g,glyphs,c,cx,0,pad,advances);
                                }
                            }
                            if(roll && p<.89)FadeEdges(bitmap,text,centers,widths,pad,lineHeight);
                            files[frame]=Path.Combine(folder,"frame-"+frame.ToString("000")+".png");bitmap.Save(files[frame],ImageFormat.Png);
                        }
                    }
                    return new NumericFrameResult{Files=files,Width=w/scale,Height=h/scale,Left=left,Top=top,Frames=frames};
                } finally {foreach(var image in glyphs.Values)image.Dispose();}
            }
        }
        static void Draw(Graphics g,Dictionary<char,Bitmap> glyphs,char c,float x,float y,float pad,Dictionary<char,float> widths) {
            g.DrawImage(glyphs[c],x-widths[c]/2-pad,y);
        }
        static void FadeEdges(Bitmap image,string text,float[] centers,float[] widths,float top,float height){
            var bits=image.LockBits(new Rectangle(0,0,image.Width,image.Height),ImageLockMode.ReadWrite,PixelFormat.Format32bppArgb);
            try{
                var bytes=new byte[bits.Stride*image.Height];Marshal.Copy(bits.Scan0,bytes,0,bytes.Length);
                float edge=height*.10f;
                for(int y=Math.Max(0,(int)top);y<Math.Min(image.Height,(int)Math.Ceiling(top+height));y++){
                    double alpha=Clamp(Math.Min(y+.5-top,top+height-y-.5)/edge);if(alpha>=1)continue;
                    for(int i=0;i<text.Length;i++)if(Char.IsDigit(text[i])){
                        for(int x=Math.Max(0,(int)(centers[i]-widths[i]/2));x<Math.Min(image.Width,(int)Math.Ceiling(centers[i]+widths[i]/2));x++){
                            int a=y*bits.Stride+x*4+3;bytes[a]=(byte)Math.Round(bytes[a]*alpha);
                        }
                    }
                }
                Marshal.Copy(bytes,0,bits.Scan0,bytes.Length);
            }finally{image.UnlockBits(bits);}
        }
    }
}

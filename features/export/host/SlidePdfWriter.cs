using PangmenToolbox.Shapes;
using PangmenToolbox.AddIn;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;

namespace PangmenToolbox.Export
{
    // Sequential PDF image writer. Holds one page at a time; never re-encodes an embedded JPEG.
    internal sealed class SlidePdfWriter : IDisposable
    {
        private readonly Stream output;
        private readonly List<long> offsets = new List<long> { 0, 0, 0 };
        private readonly List<int> pages = new List<int>();
        private readonly double width, height;
        private bool finished;
        internal SlidePdfWriter(Stream output, double width, double height)
        {
            if (width <= 0 || height <= 0 || double.IsInfinity(width + height) || double.IsNaN(width + height)) throw new ArgumentException("页面尺寸无效。");
            this.output = output; this.width = width; this.height = height;
            Write("%PDF-1.4\n% Pangmen image PDF\n");
        }
        private void Write(string text) { var b = Encoding.ASCII.GetBytes(text); output.Write(b, 0, b.Length); }
        private int Reserve() { offsets.Add(0); return offsets.Count - 1; }
        private void Start(int id) { offsets[id] = output.Position; Write(id + " 0 obj\n"); }
        private void Object(int id, string text) { Start(id); Write(text + "\nendobj\n"); }
        private void Binary(int id, string dictionary, byte[] bytes)
        { Start(id); Write("<< " + dictionary + " /Length " + bytes.Length + " >>\nstream\n"); output.Write(bytes, 0, bytes.Length); Write("\nendstream\nendobj\n"); }
        internal void AddPage(string pngPath, string compression, int quality)
        {
            if (finished) throw new InvalidOperationException("PDF 已完成。");
            using (var source = Image.FromFile(pngPath))
            using (var image = new Bitmap(source.Width, source.Height, PixelFormat.Format24bppRgb))
            {
                using (var g = Graphics.FromImage(image))
                {
                    g.Clear(Color.White);
                    // PowerPoint PNGs carry their export DPI. Explicit pixel rectangles avoid
                    // GDI+ interpreting that metadata as a physical-size scaling instruction.
                    g.DrawImage(source, new Rectangle(0, 0, source.Width, source.Height), 0, 0, source.Width, source.Height, GraphicsUnit.Pixel);
                }
                byte[] jpeg = null, lossless = null;
                if (compression != "lossless") using (var s = new MemoryStream())
                {
                    var encoder = ImageCodecInfo.GetImageEncoders().First(x => x.MimeType == "image/jpeg");
                    using (var args = new EncoderParameters(1)) { args.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality); image.Save(s, encoder, args); }
                    jpeg = s.ToArray();
                }
                if (compression != "jpeg") lossless = CompressRgb(image);
                bool useLossless = jpeg == null || (lossless != null && lossless.Length <= jpeg.Length);
                var data = useLossless ? lossless : jpeg;
                int page = Reserve(), picture = Reserve(), content = Reserve(); pages.Add(page);
                string w = width.ToString("0.#####", CultureInfo.InvariantCulture), h = height.ToString("0.#####", CultureInfo.InvariantCulture);
                Object(page, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + w + " " + h + "] /Resources << /XObject << /Im " + picture + " 0 R >> >> /Contents " + content + " 0 R >>");
                Binary(picture, "/Type /XObject /Subtype /Image /Width " + image.Width + " /Height " + image.Height + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /" + (useLossless ? "FlateDecode" : "DCTDecode"), data);
                Binary(content, "", Encoding.ASCII.GetBytes("q " + w + " 0 0 " + h + " 0 0 cm /Im Do Q"));
            }
        }
        private static byte[] CompressRgb(Bitmap image)
        {
            using (var stream = new MemoryStream())
            {
                // PDF FlateDecode expects zlib, whereas net48 DeflateStream emits raw DEFLATE.
                stream.WriteByte(0x78); stream.WriteByte(0x9c);
                uint a = 1, b = 0;
                var pixels = image.LockBits(new Rectangle(0, 0, image.Width, image.Height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
                try
                {
                    var row = new byte[image.Width * 3];
                    using (var zip = new DeflateStream(stream, CompressionLevel.Optimal, true))
                    for (int y = 0; y < image.Height; y++)
                    {
                        System.Runtime.InteropServices.Marshal.Copy(IntPtr.Add(pixels.Scan0, y * pixels.Stride), row, 0, row.Length);
                        for (int x = 0; x < row.Length; x += 3) { byte r = row[x]; row[x] = row[x + 2]; row[x + 2] = r; }
                        foreach (byte value in row) { a = (a + value) % 65521; b = (b + a) % 65521; }
                        zip.Write(row, 0, row.Length);
                    }
                }
                finally { image.UnlockBits(pixels); }
                uint checksum = (b << 16) | a;
                for (int shift = 24; shift >= 0; shift -= 8) stream.WriteByte((byte)(checksum >> shift));
                return stream.ToArray();
            }
        }
        internal void Finish()
        {
            if (finished || pages.Count == 0) throw new InvalidOperationException("没有可导出的页面。");
            Object(1, "<< /Type /Catalog /Pages 2 0 R >>");
            Object(2, "<< /Type /Pages /Count " + pages.Count + " /Kids [" + string.Join(" ", pages.Select(x => x + " 0 R")) + "] >>");
            long xref = output.Position;
            Write("xref\n0 " + offsets.Count + "\n0000000000 65535 f \n");
            for (int i = 1; i < offsets.Count; i++) Write(offsets[i].ToString("D10", CultureInfo.InvariantCulture) + " 00000 n \n");
            Write("trailer\n<< /Size " + offsets.Count + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
            output.Flush(); finished = true;
        }
        public void Dispose() { /* Stream lifetime belongs to the export job. */ }
    }
}

using System.Drawing;
using System.Windows.Forms;
using PangmenToolbox.Shapes;
namespace PangmenToolbox.AddIn {
    internal sealed class RibbonBrandImage : AxHost {
        private RibbonBrandImage() : base("") {}
        private static readonly Bitmap Logo = BrandAssets.LoadLogo();
        internal static readonly object Picture = Logo == null ? null : GetIPictureDispFromPicture(Logo);
    }
}

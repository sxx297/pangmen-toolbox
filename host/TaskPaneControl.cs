using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace PangmenToolbox.AddIn
{
    // Office activates this registered Windows Forms ActiveX container through CreateCTP.
    [ComVisible(true)]
    [Guid("483F84C1-E902-4971-856F-A11A44EBEF97")]
    [ProgId("PangmenToolbox.TaskPane")]
    [ClassInterface(ClassInterfaceType.AutoDispatch)]
    public sealed class TaskPaneControl : UserControl
    {
        public TaskPaneControl()
        {
            AutoScaleMode = AutoScaleMode.None;
            BackColor = Color.FromArgb(253, 252, 251);
            Dock = DockStyle.Fill;
        }
    }
}

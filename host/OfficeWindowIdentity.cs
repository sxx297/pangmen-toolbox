using System;
using System.Runtime.InteropServices;

namespace PangmenToolbox.AddIn
{
    internal static class OfficeWindowIdentity
    {
        // DocumentWindow.HWND is not available reliably in every PowerPoint build.
        // A session is keyed by COM identity, never by a native window handle.
        internal static long Get(object documentWindow)
        {
            if (documentWindow == null) throw new InvalidOperationException("请先打开一份 PowerPoint 文稿。");
            IntPtr identity = Marshal.GetIUnknownForObject(documentWindow);
            try { return identity.ToInt64(); }
            finally { Marshal.Release(identity); }
        }

        internal static long Active(object application)
        {
            object window = ((dynamic)application).ActiveWindow;
            return Get(window);
        }

        internal static IntPtr FloatingOwner(object application, object documentWindow)
        {
            // IOleWindow is optional. Failure only removes native ownership,
            // not the ability to open, edit or dock the material panel.
            try
            {
                var oleWindow = documentWindow as IOleWindow;
                IntPtr handle;
                if (oleWindow != null && oleWindow.GetWindow(out handle) >= 0)
                {
                    handle = ValidRoot(handle);
                    if (handle != IntPtr.Zero) return handle;
                }
            }
            catch { }
            try
            {
                long raw = Convert.ToInt64(((dynamic)application).HWND);
                // Office exposes HWND as a signed 32-bit Long even on x64.
                if (raw < 0 && raw >= Int32.MinValue) raw = unchecked((uint)(int)raw);
                return ValidRoot(new IntPtr(raw));
            }
            catch { return IntPtr.Zero; }
        }

        private static IntPtr ValidRoot(IntPtr handle)
        {
            if (handle == IntPtr.Zero || !IsWindow(handle)) return IntPtr.Zero;
            var root = GetAncestor(handle, 2); // GA_ROOT
            if (root != IntPtr.Zero) handle = root;
            uint process;
            GetWindowThreadProcessId(handle, out process);
            return process == (uint)System.Diagnostics.Process.GetCurrentProcess().Id ? handle : IntPtr.Zero;
        }

        [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr handle);
        [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr handle, uint flags);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint process);

        [ComImport, Guid("00000114-0000-0000-C000-000000000046")]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IOleWindow
        {
            [PreserveSig] int GetWindow(out IntPtr handle);
            [PreserveSig] int ContextSensitiveHelp([MarshalAs(UnmanagedType.Bool)] bool enterMode);
        }
    }
}

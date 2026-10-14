using System;
using System.Runtime.InteropServices;

namespace PangmenToolbox.AddIn
{
    // Office's public COM contracts, declared locally so deployment needs no PIA.
    [ComImport, ComVisible(true), Guid("B65AD801-ABAF-11D0-BB8B-00A0C90F2744")]
    [InterfaceType(ComInterfaceType.InterfaceIsDual)]
    public interface IDTExtensibility2
    {
        [DispId(1)]
        void OnConnection([In, MarshalAs(UnmanagedType.IDispatch)] object application,
            [In] ExtConnectMode connectMode,
            [In, MarshalAs(UnmanagedType.IDispatch)] object addInInstance,
            [In, MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_VARIANT)] ref Array custom);

        [DispId(2)]
        void OnDisconnection([In] ExtDisconnectMode removeMode,
            [In, MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_VARIANT)] ref Array custom);

        [DispId(3)]
        void OnAddInsUpdate([In, MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_VARIANT)] ref Array custom);

        [DispId(4)]
        void OnStartupComplete([In, MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_VARIANT)] ref Array custom);

        [DispId(5)]
        void OnBeginShutdown([In, MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_VARIANT)] ref Array custom);
    }

    public enum ExtConnectMode { AfterStartup = 0, Startup = 1, External = 2, CommandLine = 3, Solution = 4, UISetup = 5 }
    public enum ExtDisconnectMode { HostShutdown = 0, UserClosed = 1, UISetupComplete = 2, SolutionClosed = 3 }

    [ComImport, ComVisible(true), Guid("000C0396-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IRibbonExtensibility
    {
        [DispId(1)]
        [return: MarshalAs(UnmanagedType.BStr)]
        string GetCustomUI([In, MarshalAs(UnmanagedType.BStr)] string ribbonId);
    }

    // This is the default IDispatch surface for Office's named Ribbon callbacks
    // and for COMAddIns.Item("PangmenToolbox.AddIn").Object diagnostics.
    [ComVisible(true), Guid("693F9335-DA91-4B37-BC2D-8057FF0B4D02")]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IToolboxCallbacks
    {
        [DispId(1)] void OnOpenPanel([In, MarshalAs(UnmanagedType.IDispatch)] object control);
        [DispId(2)] void OpenPanel();
        [DispId(3)] [return: MarshalAs(UnmanagedType.BStr)] string GetStatus();
        [DispId(4)] void ClosePanel();
        [DispId(5)] void OnOpenFloating([In, MarshalAs(UnmanagedType.IDispatch)] object control);
        [DispId(6)] void OnOpenDocked([In, MarshalAs(UnmanagedType.IDispatch)] object control);
        [DispId(7)] void OnAbout([In, MarshalAs(UnmanagedType.IDispatch)] object control);
        [DispId(12)] [return: MarshalAs(UnmanagedType.IDispatch)] object GetBrandImage([In, MarshalAs(UnmanagedType.IDispatch)] object control);
        [DispId(9)] void OnOpenAnimation([In, MarshalAs(UnmanagedType.IDispatch)] object control);
        [DispId(10)] void OpenModule([In, MarshalAs(UnmanagedType.BStr)] string module, [In, MarshalAs(UnmanagedType.BStr)] string mode);
        [DispId(11)] void CloseModule([In, MarshalAs(UnmanagedType.BStr)] string module);
        [DispId(8)] void OnExportPdf([In, MarshalAs(UnmanagedType.IDispatch)] object control);
    }

    [ComImport, ComVisible(true), Guid("000C033E-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsDual)]
    public interface ICustomTaskPaneConsumer
    {
        [DispId(1)] void CTPFactoryAvailable([In, MarshalAs(UnmanagedType.Interface)] ICTPFactory factory);
    }

    [ComImport, ComVisible(true), Guid("000C033D-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsDual)]
    public interface ICTPFactory
    {
        [DispId(1)]
        [return: MarshalAs(UnmanagedType.Interface)]
        IOfficeTaskPane CreateCTP([In, MarshalAs(UnmanagedType.BStr)] string progId,
            [In, MarshalAs(UnmanagedType.BStr)] string title,
            [In, MarshalAs(UnmanagedType.Struct)] object parentWindow);
    }

    // Member order matches Office's dual _CustomTaskPane interface.
    [ComImport, ComVisible(true), Guid("000C033B-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsDual)]
    public interface IOfficeTaskPane
    {
        [DispId(0)] string Title { get; }
        [DispId(1)] object Application { [return: MarshalAs(UnmanagedType.IDispatch)] get; }
        [DispId(2)] object Window { [return: MarshalAs(UnmanagedType.IDispatch)] get; }
        [DispId(3)] bool Visible { get; set; }
        [DispId(4)] object ContentControl { [return: MarshalAs(UnmanagedType.IDispatch)] get; }
        [DispId(5)] int Height { get; set; }
        [DispId(6)] int Width { get; set; }
        [DispId(7)] int DockPosition { get; set; }
        [DispId(8)] int DockPositionRestrict { get; set; }
        [DispId(9)] void Delete();
    }
}

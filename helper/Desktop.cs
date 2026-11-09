// 桌面相关的底层操作：把窗口挂到桌面图标下方、找桌面图标层、判断鼠标是不是在桌面空白处。
// 只用公开的 Win32 接口，不注入任何进程、不读写别的进程的内存。
// 注意：系统自带的 csc 只支持 C# 5。
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

static class Native
{
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; public POINT(int x, int y) { X = x; Y = y; } }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    public delegate bool EnumProc(IntPtr h, IntPtr l);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern int MapWindowPoints(IntPtr from, IntPtr to, ref RECT r, int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int idx, int v);
    [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint RegisterWindowMessage(string s);
    [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);

    [StructLayout(LayoutKind.Sequential)]
    public struct RAWINPUTDEVICE { public ushort UsagePage, Usage; public uint Flags; public IntPtr Target; }
    [DllImport("user32.dll")] public static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] d, uint n, uint size);
    [DllImport("user32.dll")] public static extern uint GetRawInputData(IntPtr h, uint cmd, IntPtr data, ref uint size, uint header);

    [DllImport("oleacc.dll")]
    public static extern int AccessibleObjectFromPoint(POINT pt, [MarshalAs(UnmanagedType.Interface)] out Accessibility.IAccessible acc, [MarshalAs(UnmanagedType.Struct)] out object child);

    public const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
    public const int WS_CHILD = 0x40000000, WS_POPUP = unchecked((int)0x80000000), WS_VISIBLE = 0x10000000, WS_CLIPCHILDREN = 0x02000000, WS_CLIPSIBLINGS = 0x04000000;
    public const int WS_EX_LAYERED = 0x80000, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000, WS_EX_TRANSPARENT = 0x20;
    public const uint SWP_NOSIZE = 1, SWP_NOMOVE = 2, SWP_NOZORDER = 4, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;

    public static string ClassOf(IntPtr h)
    {
        StringBuilder sb = new StringBuilder(64);
        GetClassName(h, sb, sb.Capacity);
        return sb.ToString();
    }
}

/// <summary>桌面图标层（Progman / WorkerW）的位置。Windows 11 24H2 起结构变了，两种都要认。</summary>
class DesktopLayer
{
    public IntPtr Progman, DefView, WorkerW;
    public bool Raised; // 24H2 起：WorkerW、图标层都在 Progman 里面

    public static DesktopLayer Find()
    {
        DesktopLayer d = new DesktopLayer();
        d.Progman = Native.FindWindow("Progman", null);
        if (d.Progman == IntPtr.Zero) return null;
        IntPtr r;
        // 让 Explorer 在图标层后面生成一层 WorkerW（壁纸软件的通用做法）
        Native.SendMessageTimeout(d.Progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out r);
        Native.SendMessageTimeout(d.Progman, 0x052C, (IntPtr)0xD, (IntPtr)1, 0, 1000, out r);

        d.DefView = Native.FindWindowEx(d.Progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        d.WorkerW = Native.FindWindowEx(d.Progman, IntPtr.Zero, "WorkerW", null);
        if (d.DefView != IntPtr.Zero && d.WorkerW != IntPtr.Zero) { d.Raised = true; return d; }

        // 旧结构：图标层在某个顶层 WorkerW 里，壁纸层是它后面紧跟的那个 WorkerW
        IntPtr found = IntPtr.Zero, defv = IntPtr.Zero;
        Native.EnumWindows(delegate (IntPtr h, IntPtr l)
        {
            IntPtr dv = Native.FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (dv != IntPtr.Zero) { defv = dv; found = Native.FindWindowEx(IntPtr.Zero, h, "WorkerW", null); return false; }
            return true;
        }, IntPtr.Zero);
        if (defv != IntPtr.Zero) d.DefView = defv;
        d.WorkerW = found;
        d.Raised = false;
        if (d.WorkerW == IntPtr.Zero) return null;
        return d;
    }

    /// <summary>壁纸窗口的父窗口</summary>
    public IntPtr Host { get { return Raised ? Progman : WorkerW; } }

    /// <summary>把壁纸窗口挂进去（放在图标层下方），并摆到屏幕坐标 rect 处。</summary>
    public void Attach(IntPtr wnd, Native.RECT screen)
    {
        if (Raised)
        {
            // 24H2：Progman 里的子窗口要是分层窗口才画得出来
            int ex = Native.GetWindowLong(wnd, Native.GWL_EXSTYLE);
            Native.SetWindowLong(wnd, Native.GWL_EXSTYLE, ex | Native.WS_EX_LAYERED);
            Native.SetLayeredWindowAttributes(wnd, 0, 255, 2);
        }
        Native.SetParent(wnd, Host);
        Place(wnd, screen);
    }

    public void Place(IntPtr wnd, Native.RECT screen)
    {
        Native.RECT r = screen;
        Native.MapWindowPoints(IntPtr.Zero, Host, ref r, 2);
        if (Raised)
        {
            // 在 Progman 里：图标层在最上，壁纸其次，WorkerW（系统壁纸）最下
            Native.SetWindowPos(wnd, DefView, r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top, Native.SWP_NOACTIVATE);
            Native.SetWindowPos(WorkerW, wnd, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
        }
        else
        {
            Native.SetWindowPos(wnd, IntPtr.Zero, r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top, Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
        }
    }

    public bool Alive { get { return Native.IsWindow(Progman) && Native.IsWindow(Host); } }

    /// <summary>鼠标所在处是不是桌面（图标层 / 壁纸层本身，没有被别的窗口挡住）</summary>
    public bool IsDesktopAt(Native.POINT pt, HashSet<IntPtr> ours)
    {
        IntPtr h = Native.WindowFromPoint(pt);
        if (h == IntPtr.Zero) return false;
        if (ours.Contains(h)) return true;
        IntPtr root = Native.GetAncestor(h, 2); // GA_ROOT
        if (ours.Contains(root)) return true;
        if (h == DefView || h == Progman || h == WorkerW) return true;
        if (Native.GetParent(h) == DefView) return true; // SysListView32（桌面图标）
        return root == Progman || (root != IntPtr.Zero && Native.FindWindowEx(root, IntPtr.Zero, "SHELLDLL_DefView", null) == DefView);
    }

    /// <summary>鼠标下面是不是一个桌面图标（用无障碍接口问，按下时才问一次）</summary>
    public static bool IsIconAt(Native.POINT pt)
    {
        try
        {
            Accessibility.IAccessible acc; object child;
            if (Native.AccessibleObjectFromPoint(pt, out acc, out child) != 0 || acc == null) return false;
            object role = acc.get_accRole(child);
            return role is int && ((int)role == 34 || (int)role == 0x22); // ROLE_SYSTEM_LISTITEM
        }
        catch { return false; }
    }
}

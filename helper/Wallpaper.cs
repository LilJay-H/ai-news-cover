// 自带的壁纸宿主：用系统自带的 WebView2 显示本地的壁纸页，挂到桌面图标下方。
// 鼠标在桌面空白处时，把移动、左键、滚轮转发给网页（用 Raw Input 读鼠标，不装全局钩子）。
// 全屏程序、锁屏、睡眠时暂停（网页收到 visibilitychange，停刷新、停动画）。
// 注意：系统自带的 csc 只支持 C# 5。
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

/// <summary>一块屏幕上的壁纸窗口</summary>
class WallpaperWindow : NativeWindow
{
    public string Device;
    public Rectangle Bounds; // 屏幕坐标（物理像素）
    public Rectangle Work;   // 去掉任务栏的工作区
    public DateTime CoveredSince = DateTime.MaxValue;
    public CoreWebView2Controller Ctl;
    public bool Ready;
    IntPtr widget;
    bool suspended;

    public WallpaperWindow(Monitor s)
    {
        Device = s.DeviceName;
        Bounds = s.Bounds;
        Work = s.WorkingArea;
        CreateParams cp = new CreateParams();
        cp.Caption = "AI news cover";
        cp.Style = Native.WS_POPUP | Native.WS_CLIPCHILDREN;
        cp.ExStyle = Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE;
        cp.X = Bounds.X; cp.Y = Bounds.Y; cp.Width = Bounds.Width; cp.Height = Bounds.Height;
        CreateHandle(cp);
        Hwnd = Handle;
    }

    /// <summary>窗口和网页都还在（Explorer 重启会把它们一起销毁）</summary>
    public bool Alive { get { return Ctl != null && Handle != IntPtr.Zero && Native.IsWindow(Handle); } }

    public IntPtr Hwnd; // 创建时的句柄（窗口被系统销毁后 Handle 会变成 0，这里留着用来清理）

    public Native.RECT ScreenRect
    {
        get { Native.RECT r; r.Left = Bounds.Left; r.Top = Bounds.Top; r.Right = Bounds.Right; r.Bottom = Bounds.Bottom; return r; }
    }

    public void Attach(DesktopLayer layer)
    {
        int st = Native.GetWindowLong(Handle, Native.GWL_STYLE);
        Native.SetWindowLong(Handle, Native.GWL_STYLE, (st & ~Native.WS_POPUP) | Native.WS_CHILD | Native.WS_CLIPSIBLINGS);
        layer.Attach(Handle, ScreenRect);
        Native.ShowWindow(Handle, 4); // SW_SHOWNOACTIVATE
        if (Ctl != null) Ctl.Bounds = new Rectangle(0, 0, Bounds.Width, Bounds.Height);
    }

    public async Task Init(CoreWebView2Environment env, WallpaperHost host)
    {
        Ctl = await env.CreateCoreWebView2ControllerAsync(Handle);
        Ctl.DefaultBackgroundColor = Color.FromArgb(255, 0xEF, 0xEA, 0xDF);
        Ctl.Bounds = new Rectangle(0, 0, Bounds.Width, Bounds.Height);
        CoreWebView2 wv = Ctl.CoreWebView2;
        CoreWebView2Settings st = wv.Settings;
        st.AreDefaultContextMenusEnabled = false;
        st.AreDevToolsEnabled = WallpaperHost.Debug;
        st.IsStatusBarEnabled = false;
        st.IsZoomControlEnabled = false;
        st.AreBrowserAcceleratorKeysEnabled = false;
        st.IsPinchZoomEnabled = false;
        st.IsSwipeNavigationEnabled = false;
        st.IsGeneralAutofillEnabled = false;
        st.IsPasswordAutosaveEnabled = false;
        wv.SetVirtualHostNameToFolderMapping(WallpaperHost.HostName, host.WebRoot, CoreWebView2HostResourceAccessKind.Allow);
        // 壁纸页之外的地址一律不在壁纸里打开：aihot.news 的交给系统默认浏览器，其余丢掉
        wv.NewWindowRequested += delegate (object s, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            host.OpenExternal(e.Uri);
        };
        wv.NavigationStarting += delegate (object s, CoreWebView2NavigationStartingEventArgs e)
        {
            if (!e.Uri.StartsWith(WallpaperHost.PageOrigin + "/", StringComparison.OrdinalIgnoreCase))
            {
                e.Cancel = true;
                host.OpenExternal(e.Uri);
            }
        };
        wv.NavigationCompleted += delegate (object s, CoreWebView2NavigationCompletedEventArgs e)
        {
            Log.Write("网页载入完成 " + Device + " 成功=" + e.IsSuccess + " 状态=" + e.WebErrorStatus);
            Ready = true;
            widget = IntPtr.Zero;
            host.OnPageReady(this);
        };
        wv.ProcessFailed += delegate (object s, CoreWebView2ProcessFailedEventArgs e)
        {
            // 渲染进程崩了：重新载入一次
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited || e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
                try { wv.Reload(); } catch { }
        };
        wv.Navigate(WallpaperHost.PageOrigin + "/index.html");
    }

    /// <summary>网页的鼠标窗口（WebView2 里 Chromium 的渲染窗口），消息要发给它</summary>
    public IntPtr Widget
    {
        get
        {
            if (widget != IntPtr.Zero && Native.IsWindow(widget)) return widget;
            IntPtr found = IntPtr.Zero;
            Native.EnumChildWindows(Handle, delegate (IntPtr h, IntPtr l)
            {
                if (Native.ClassOf(h) == "Chrome_RenderWidgetHostHWND") { found = h; return false; }
                return true;
            }, IntPtr.Zero);
            widget = found;
            return found;
        }
    }

    string lastWhy;

    public void SetRunning(bool run, string why)
    {
        if (!Alive) return;
        if (why != lastWhy) { Log.Write("壁纸 " + Device + (run ? " 显示" : " 暂停") + "（" + why + "）"); lastWhy = why; }
        try { SetRunningCore(run); } catch (Exception ex) { Log.Write("切换显示出错：" + ex.Message); }
    }

    public bool Showing { get { try { return Alive && Ready && Ctl.IsVisible; } catch { return false; } } }

    void SetRunningCore(bool run)
    {
        if (run)
        {
            if (Ctl.IsVisible && !suspended) return;
            suspended = false;
            Ctl.IsVisible = true;
            try { Ctl.CoreWebView2.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Normal; } catch { }
        }
        else
        {
            if (!Ctl.IsVisible) return;
            Ctl.IsVisible = false; // 网页收到 visibilitychange → 停刷新、停动画
            suspended = true;
            try { Ctl.CoreWebView2.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Low; } catch { }
            TrySuspend();
        }
    }

    async void TrySuspend()
    {
        try { await Ctl.CoreWebView2.TrySuspendAsync(); } catch { }
    }

    public void Close()
    {
        try { if (Ctl != null) Ctl.Close(); } catch { }
        Ctl = null;
        try { DestroyHandle(); } catch { }
    }
}

/// <summary>隐藏的顶层窗口：收 Raw Input 鼠标消息、显示器变化、Explorer 重启</summary>
class MsgWindow : NativeWindow
{
    public Action<int, int> OnMouse;   // buttonFlags, wheel
    public Action OnDesktopChanged;    // 分辨率、DPI、壁纸、Explorer 重启
    readonly uint taskbarCreated;
    IntPtr buf = IntPtr.Zero;
    uint bufSize;

    public MsgWindow()
    {
        CreateParams cp = new CreateParams();
        cp.Caption = "AI news cover · host";
        cp.ExStyle = Native.WS_EX_TOOLWINDOW;
        CreateHandle(cp);
        taskbarCreated = Native.RegisterWindowMessage("TaskbarCreated");
        Native.RAWINPUTDEVICE[] d = new Native.RAWINPUTDEVICE[1];
        d[0].UsagePage = 1; d[0].Usage = 2; d[0].Flags = 0x100; d[0].Target = Handle; // RIDEV_INPUTSINK
        Native.RegisterRawInputDevices(d, 1, (uint)Marshal.SizeOf(typeof(Native.RAWINPUTDEVICE)));
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x00FF) // WM_INPUT
        {
            uint hdr = (uint)(8 + 2 * IntPtr.Size);
            uint size = 0;
            Native.GetRawInputData(m.LParam, 0x10000003, IntPtr.Zero, ref size, hdr);
            if (size > 0)
            {
                if (size > bufSize) { if (buf != IntPtr.Zero) Marshal.FreeHGlobal(buf); buf = Marshal.AllocHGlobal((int)size); bufSize = size; }
                if (Native.GetRawInputData(m.LParam, 0x10000003, buf, ref size, hdr) == size && Marshal.ReadInt32(buf) == 0) // RIM_TYPEMOUSE
                {
                    int flags = (ushort)Marshal.ReadInt16(buf, (int)hdr + 4);
                    int data = Marshal.ReadInt16(buf, (int)hdr + 6);
                    if (OnMouse != null) OnMouse(flags, data);
                }
            }
        }
        else if (m.Msg == 0x007E || m.Msg == 0x02E0 || (taskbarCreated != 0 && m.Msg == (int)taskbarCreated)) // DISPLAYCHANGE / DPICHANGED / TaskbarCreated
        {
            if (OnDesktopChanged != null) OnDesktopChanged();
        }
        else if (m.Msg == 0x001A) // WM_SETTINGCHANGE：换壁纸、换主题后 Explorer 可能重排桌面层
        {
            if (OnDesktopChanged != null) OnDesktopChanged();
        }
        base.WndProc(ref m);
    }
}

/// <summary>壁纸宿主：管理每块屏幕的壁纸窗口、鼠标转发、暂停</summary>
class WallpaperHost
{
    public const string HostName = "ai-news-cover.localhost";
    public const string PageOrigin = "https://" + HostName;
    public static bool Debug = Environment.GetEnvironmentVariable("AINC_DEBUG") == "1";

    public string WebRoot, DataDir, LoaderDir;
    public Action<string> OpenExternalHandler;
    public Action<WallpaperWindow> PageReady;
    public Action Ready; // 第一块屏幕的网页载入完成

    bool locked, sleeping;
    CoreWebView2Environment env;
    DesktopLayer layer;
    readonly List<WallpaperWindow> windows = new List<WallpaperWindow>();
    readonly HashSet<IntPtr> ours = new HashSet<IntPtr>();
    MsgWindow msg;
    Timer timer;
    bool readyFired;
    bool changePending;

    // 鼠标转发的状态
    WallpaperWindow hoverWin;
    Native.POINT lastPt = new Native.POINT(int.MinValue, int.MinValue);
    bool leftDown;

    public void OpenExternal(string url)
    {
        if (OpenExternalHandler != null) OpenExternalHandler(url);
    }

    bool eventsHooked;

    [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode)] static extern bool WTSQuerySessionInformation(IntPtr server, int session, int cls, out IntPtr buf, out int bytes);
    [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr p);

    /// <summary>当前会话是不是锁着（锁屏事件只在切换时才来，启动时要自己问一次）。
    /// WTSINFOEXW：Level（4 字节）之后的 Data 按 8 字节对齐，Level 1 里依次是 SessionId@8、SessionState@12、SessionFlags@16。
    /// v0.2.0 误读了偏移 12（SessionState，在线时恰好是 0），把每台电脑都当成锁屏，报纸一直藏着。拿不准时一律当作没锁。</summary>
    static bool SessionLocked()
    {
        IntPtr buf; int n;
        try
        {
            if (!WTSQuerySessionInformation(IntPtr.Zero, System.Diagnostics.Process.GetCurrentProcess().SessionId, 25, out buf, out n)) return false; // WTSSessionInfoEx
            try
            {
                const int flagsOffset = 16;
                return n >= flagsOffset + 4 && Marshal.ReadInt32(buf) == 1 && Marshal.ReadInt32(buf, flagsOffset) == 0; // WTS_SESSIONSTATE_LOCK
            }
            finally { WTSFreeMemory(buf); }
        }
        catch { return false; }
    }

    public async Task Start()
    {
        locked = SessionLocked();
        Log.Write("启动：Windows " + Environment.OSVersion.Version + "，锁屏=" + locked + "，WebView2 " + Opener.RuntimeVersion());
        CoreWebView2Environment.SetLoaderDllFolderPath(LoaderDir);
        CoreWebView2EnvironmentOptions opt = new CoreWebView2EnvironmentOptions();
        opt.Language = "zh-CN";
        string args = "--disable-features=msSmartScreenProtection,msEdgeTranslate --autoplay-policy=no-user-gesture-required";
        if (Debug) args += " --remote-debugging-port=9223";
        opt.AdditionalBrowserArguments = args;
        env = await CoreWebView2Environment.CreateAsync(null, DataDir, opt);
        Log.Write("WebView2 环境已创建 " + env.BrowserVersionString);

        msg = new MsgWindow();
        msg.OnMouse = OnMouse;
        msg.OnDesktopChanged = ScheduleSync;
        if (!eventsHooked) HookSystemEvents();
        timer = new Timer();
        timer.Interval = 1000;
        timer.Tick += delegate { try { Watch(); } catch { } };
        timer.Start();
        await Sync();
    }

    void HookSystemEvents()
    {
        eventsHooked = true;
        SystemEvents.SessionSwitch += delegate (object s, SessionSwitchEventArgs e)
        {
            if (e.Reason == SessionSwitchReason.SessionLock || e.Reason == SessionSwitchReason.ConsoleDisconnect || e.Reason == SessionSwitchReason.RemoteDisconnect) locked = true;
            if (e.Reason == SessionSwitchReason.SessionUnlock || e.Reason == SessionSwitchReason.ConsoleConnect || e.Reason == SessionSwitchReason.RemoteConnect) locked = false;
            UpdateRunning();
        };
        SystemEvents.PowerModeChanged += delegate (object s, PowerModeChangedEventArgs e)
        {
            if (e.Mode == PowerModes.Suspend) sleeping = true;
            if (e.Mode == PowerModes.Resume) { sleeping = false; locked = SessionLocked(); ScheduleSync(); }
            UpdateRunning();
        };
    }

    public IEnumerable<WallpaperWindow> Windows { get { return windows; } }

    void ScheduleSync()
    {
        if (changePending) return;
        changePending = true;
        // 系统在改分辨率 / 换壁纸时会连续发好几条消息，稍等再整体同步一次
        Timer t = new Timer();
        t.Interval = 800;
        t.Tick += async delegate { t.Stop(); t.Dispose(); changePending = false; try { await Sync(); } catch { } };
        t.Start();
    }

    /// <summary>按当前的显示器、桌面结构摆好所有壁纸窗口（缺的补、多的关、位置不对的挪）</summary>
    bool syncing;

    public async Task Sync()
    {
        if (syncing) { ScheduleSync(); return; }
        syncing = true;
        try { await SyncCore(); }
        finally { syncing = false; }
    }

    async Task SyncCore()
    {
        DesktopLayer l = DesktopLayer.Find();
        if (l == null) { Log.Write("找不到桌面图标层，稍后再试"); ScheduleSync(); return; }
        if (layer == null || l.Host != layer.Host) Log.Write("桌面层：" + (l.Raised ? "新结构（Progman 内）" : "旧结构（WorkerW）") + " progman=" + l.Progman + " defview=" + l.DefView + " workerw=" + l.WorkerW);
        bool relayer = layer == null || l.Host != layer.Host || l.DefView != layer.DefView || l.WorkerW != layer.WorkerW;
        layer = l;

        List<Monitor> want = new List<Monitor>();
        foreach (Monitor s in Monitor.All()) if (s.Primary) want.Add(s); // 多块屏时只铺主屏

        for (int i = windows.Count - 1; i >= 0; i--)
        {
            WallpaperWindow w = windows[i];
            // 不再需要的屏，或者窗口已经没了（Explorer 重启时，旧桌面层连同里面的子窗口一起被系统销毁）：关掉，下面重建
            bool dead = w.Handle == IntPtr.Zero || !Native.IsWindow(w.Handle);
            if (dead || !want.Exists(delegate (Monitor s) { return s.DeviceName == w.Device; }))
            {
                ours.Remove(w.Hwnd);
                w.Close();
                windows.RemoveAt(i);
                if (hoverWin == w) hoverWin = null;
            }
        }
        foreach (Monitor s in want)
        {
            WallpaperWindow w = windows.Find(delegate (WallpaperWindow x) { return x.Device == s.DeviceName; });
            if (w == null)
            {
                w = new WallpaperWindow(s);
                windows.Add(w);
                ours.Add(w.Hwnd);
                w.Attach(layer);
                await w.Init(env, this);
            }
            else
            {
                w.Bounds = s.Bounds;
                w.Work = s.WorkingArea;
                if (relayer || Native.GetParent(w.Handle) != layer.Host) w.Attach(layer);
                else layer.Place(w.Handle, w.ScreenRect);
                try { if (w.Ctl != null) w.Ctl.Bounds = new Rectangle(0, 0, w.Bounds.Width, w.Bounds.Height); } catch { }
            }
        }
        UpdateRunning();
    }

    public void OnPageReady(WallpaperWindow w)
    {
        if (PageReady != null) PageReady(w);
        UpdateRunning();
    }

    /// <summary>每秒一次：桌面层还在不在、有没有全屏程序挡着</summary>
    void Watch()
    {
        if (layer != null && !changePending)
        {
            bool broken = !layer.Alive;
            foreach (WallpaperWindow w in windows) if (Native.GetParent(w.Handle) != layer.Host) broken = true;
            if (broken) ScheduleSync();
        }
        UpdateRunning();
    }

    void UpdateRunning()
    {
        bool busy = false;
        int st;
        if (Native.SHQueryUserNotificationState(out st) == 0 && (st == 3 || st == 4)) busy = true; // D3D 全屏 / 演示模式
        IntPtr fg = Native.GetForegroundWindow();
        Native.RECT fr = new Native.RECT();
        bool fgFull = false;
        if (fg != IntPtr.Zero && !IsShell(fg) && Native.GetWindowRect(fg, out fr)) fgFull = true;
        List<Native.RECT> big = (windows.Count > 0) ? CoveringWindows() : null;
        DateTime now = DateTime.UtcNow;
        foreach (WallpaperWindow w in windows)
        {
            // 全屏程序：立刻暂停
            bool full = busy || (fgFull && fr.Left <= w.Bounds.Left && fr.Top <= w.Bounds.Top && fr.Right >= w.Bounds.Right && fr.Bottom >= w.Bounds.Bottom);
            // 被一个最大化的窗口整个挡住：持续 20 秒再暂停（来回切窗口时不至于每次都让网页重新刷新）
            bool hidden = false;
            if (big != null)
                foreach (Native.RECT r in big)
                    if (r.Left <= w.Work.Left && r.Top <= w.Work.Top && r.Right >= w.Work.Right && r.Bottom >= w.Work.Bottom) { hidden = true; break; }
            if (!hidden) w.CoveredSince = DateTime.MaxValue;
            else if (w.CoveredSince == DateTime.MaxValue) w.CoveredSince = now;
            bool longHidden = hidden && (now - w.CoveredSince).TotalSeconds >= 20;
            string why = locked ? "锁屏" : sleeping ? "睡眠" : full ? "全屏程序" : longHidden ? "被窗口挡住" : "正常";
            w.SetRunning(why == "正常", why);
        }
        TryFireReady();
    }

    /// <summary>安装程序等的「装好了」：网页载入完成并且真的显示在桌面上，才算</summary>
    void TryFireReady()
    {
        if (readyFired) return;
        foreach (WallpaperWindow w in windows)
            if (w.Showing) { readyFired = true; Log.Write("报纸已显示在桌面上"); if (Ready != null) Ready(); return; }
    }

    /// <summary>当前可见、没最小化、没被系统藏起来的普通窗口的位置</summary>
    List<Native.RECT> CoveringWindows()
    {
        List<Native.RECT> list = new List<Native.RECT>();
        uint me = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
        Native.EnumWindows(delegate (IntPtr h, IntPtr l)
        {
            if (!Native.IsWindowVisible(h) || Native.IsIconic(h)) return true;
            int ex = Native.GetWindowLong(h, Native.GWL_EXSTYLE);
            if ((ex & Native.WS_EX_TOOLWINDOW) != 0 || (ex & Native.WS_EX_TRANSPARENT) != 0) return true;
            int cloaked;
            if (Native.DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true; // DWMWA_CLOAKED
            if (IsShell(h)) return true;
            uint pid; Native.GetWindowThreadProcessId(h, out pid);
            if (pid == me) return true;
            Native.RECT r;
            if (Native.GetWindowRect(h, out r)) list.Add(r);
            return true;
        }, IntPtr.Zero);
        return list;
    }

    bool IsShell(IntPtr h)
    {
        if (layer != null && (h == layer.Progman || h == layer.WorkerW)) return true;
        if (h == Native.GetShellWindow()) return true;
        string c = Native.ClassOf(h);
        return c == "WorkerW" || c == "Progman" || c == "Shell_TrayWnd";
    }

    // ---------------- 鼠标转发 ----------------
    static IntPtr MakeL(int x, int y) { return (IntPtr)((y << 16) | (x & 0xFFFF)); }

    void OnMouse(int flags, int wheel)
    {
        if (layer == null) return;
        Native.POINT pt;
        if (!Native.GetCursorPos(out pt)) return;
        WallpaperWindow w = null;
        foreach (WallpaperWindow x in windows) if (x.Bounds.Contains(pt.X, pt.Y)) { w = x; break; }
        bool moved = pt.X != lastPt.X || pt.Y != lastPt.Y;
        lastPt = pt;
        bool live = false;
        try { live = w != null && w.Ready && w.Alive && w.Ctl.IsVisible; } catch { }
        if (!live || !layer.IsDesktopAt(pt, ours))
        {
            Leave();
            if ((flags & 2) != 0) leftDown = false;
            return;
        }
        IntPtr wd = w.Widget;
        if (wd == IntPtr.Zero) return;
        if (hoverWin != w) { Leave(); hoverWin = w; }
        Native.POINT c = pt;
        Native.ScreenToClient(wd, ref c);
        IntPtr lp = MakeL(c.X, c.Y);
        if (moved) Native.PostMessage(wd, 0x0200, (IntPtr)(leftDown ? 1 : 0), lp); // WM_MOUSEMOVE
        if ((flags & 1) != 0 && !DesktopLayer.IsIconAt(pt)) // 左键按下（按在图标上时不转发，交给桌面）
        {
            leftDown = true;
            Native.PostMessage(wd, 0x0201, (IntPtr)1, lp);
        }
        if ((flags & 2) != 0 && leftDown)
        {
            leftDown = false;
            Native.PostMessage(wd, 0x0202, IntPtr.Zero, lp);
        }
        if ((flags & 0x400) != 0 && wheel != 0) // 滚轮：lParam 用屏幕坐标
            Native.PostMessage(wd, 0x020A, (IntPtr)(wheel << 16), MakeL(pt.X, pt.Y));
    }

    void Leave()
    {
        if (hoverWin == null) return;
        IntPtr wd = hoverWin.Widget;
        if (wd != IntPtr.Zero) Native.PostMessage(wd, 0x02A3, IntPtr.Zero, IntPtr.Zero); // WM_MOUSELEAVE
        hoverWin = null;
    }

    /// <summary>在第一块屏的网页里求值，返回 JSON 字符串（出错返回 null）</summary>
    public async Task<string> Eval(string js)
    {
        foreach (WallpaperWindow w in windows)
            if (w.Ready && w.Alive)
            {
                try { return await w.Ctl.CoreWebView2.ExecuteScriptAsync(js); } catch { return null; }
            }
        return null;
    }

    public void Exec(string js)
    {
        foreach (WallpaperWindow w in windows)
            if (w.Ready && w.Alive) try { w.Ctl.CoreWebView2.ExecuteScriptAsync(js); } catch { }
    }

    public void Stop()
    {
        if (timer != null) { timer.Stop(); timer.Dispose(); timer = null; }
        foreach (WallpaperWindow w in windows) w.Close();
        windows.Clear();
        ours.Clear();
        if (msg != null) { msg.DestroyHandle(); msg = null; }
        layer = null;
    }
}

/// <summary>一块显示器（物理像素坐标）。不用 WinForms 的 Screen：它会缓存，改分辨率后不一定及时更新。</summary>
class Monitor
{
    public string DeviceName;
    public Rectangle Bounds, WorkingArea;
    public bool Primary;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct MONITORINFOEX
    {
        public int cbSize;
        public Native.RECT rcMonitor, rcWork;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
    }
    delegate bool MonitorEnumProc(IntPtr mon, IntPtr hdc, IntPtr rect, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFOEX mi);

    static Rectangle R(Native.RECT r) { return Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom); }

    public static List<Monitor> All()
    {
        List<Monitor> list = new List<Monitor>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr m, IntPtr hdc, IntPtr rc, IntPtr d)
        {
            MONITORINFOEX mi = new MONITORINFOEX();
            mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
            if (GetMonitorInfo(m, ref mi))
            {
                Monitor x = new Monitor();
                x.DeviceName = mi.szDevice;
                x.Bounds = R(mi.rcMonitor);
                x.WorkingArea = R(mi.rcWork);
                x.Primary = (mi.dwFlags & 1) != 0;
                list.Add(x);
            }
            return true;
        }, IntPtr.Zero);
        return list;
    }
}

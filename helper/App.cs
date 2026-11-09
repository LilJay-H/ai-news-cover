// AI news cover 主程序：安装程序 + 托盘 + 桌面壁纸，一个 exe。
// 双击 AI-news-cover-Setup.exe：装到 %LOCALAPPDATA%\AI-news-cover（不要管理员权限，可重复运行覆盖升级），
// 设开机自启，启动装好的那份；桌面出现报纸后弹一句「装好了」。
// 装好的那份：托盘菜单 + 本机服务（127.0.0.1:47821，给外链和主题用）+ 壁纸宿主（Wallpaper.cs）。
// 注意：系统自带的 csc 只支持 C# 5。
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

static partial class Opener
{
    const string ReadyEvent = @"Local\AI-news-cover.Ready";
    const string QuitEvent = @"Local\AI-news-cover.Quit";
    const string WebView2Page = "https://developer.microsoft.com/microsoft-edge/webview2/";

    static readonly string WebRoot = Path.Combine(InstallDir, "www");
    static readonly string DataDir = Path.Combine(InstallDir, "webview-data");

    // ---------------- 设置（只写 HKCU\Software\AINewsCover） ----------------
    static int GetPref(string name, int def)
    {
        try
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(PrefKey, false))
            {
                object v = k == null ? null : k.GetValue(name);
                return v is int ? (int)v : def;
            }
        }
        catch { return def; }
    }

    static void SetPref(string name, int v)
    {
        try { using (RegistryKey k = Registry.CurrentUser.CreateSubKey(PrefKey)) { k.SetValue(name, v); } } catch { }
    }

    /// <summary>WebView2 运行时版本（微软文档里的检测方法：看 EdgeUpdate 的注册表项）；没装返回 null</summary>
    internal static string RuntimeVersion()
    {
        string[] keys = new string[] {
            @"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            @"HKEY_CURRENT_USER\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" };
        foreach (string k in keys)
        {
            try
            {
                string v = Registry.GetValue(k, "pv", null) as string;
                if (!string.IsNullOrEmpty(v) && v != "0.0.0.0") return v;
            }
            catch { }
        }
        return null;
    }

    static void AskInstallWebView2()
    {
        if (MessageBox.Show("显示桌面报纸需要微软的 WebView2 组件（免费，Windows 11 一般自带）。\n点「确定」打开微软官网下载页，选「常青版引导程序」安装，装好后再双击本程序一次。", AppName, MessageBoxButtons.OKCancel, MessageBoxIcon.Information) == DialogResult.OK)
        {
            try { Process.Start(WebView2Page); } catch { }
        }
    }

    static string Arch()
    {
        if (IntPtr.Size == 4) return "win-x86";
        string a = Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "";
        return a.Equals("ARM64", StringComparison.OrdinalIgnoreCase) ? "win-arm64" : "win-x64";
    }

    static void ExtractFile(string res, string target)
    {
        using (Stream rs = Assembly.GetExecutingAssembly().GetManifestResourceStream(res))
        {
            if (rs == null) throw new FileNotFoundException(res);
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            using (FileStream fs = File.Create(target)) rs.CopyTo(fs);
        }
    }

    // ---------------- 安装 ----------------
    static void RunSetup()
    {
        if (RuntimeVersion() == null) { AskInstallWebView2(); return; }

        // 1) 先让正在运行的旧版自己退出（关掉网页、释放文件），等不到再强制结束
        try
        {
            EventWaitHandle q;
            if (EventWaitHandle.TryOpenExisting(QuitEvent, out q)) { q.Set(); q.Dispose(); }
        }
        catch { }
        string[] names = new string[] { "AI-news-cover", "AI-news-cover-Opener", "AINewsCoverOpener" };
        foreach (string nm in names)
        {
            foreach (Process p in Process.GetProcessesByName(nm))
            {
                try
                {
                    bool mine = nm != "AI-news-cover" || string.Equals(p.MainModule.FileName, InstalledExe, StringComparison.OrdinalIgnoreCase);
                    if (!mine) continue;
                    if (!p.WaitForExit(5000)) { p.Kill(); p.WaitForExit(3000); }
                }
                catch { }
            }
        }

        // 2) 复制程序、网页和 WebView2 的接口文件（同名覆盖）
        string err = null;
        for (int attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                Directory.CreateDirectory(InstallDir);
                File.Copy(Application.ExecutablePath, InstalledExe, true);
                ExtractFile("wv2.Core.dll", Path.Combine(InstallDir, "Microsoft.Web.WebView2.Core.dll"));
                foreach (string a in new string[] { "win-x64", "win-arm64", "win-x86" })
                    ExtractFile("wv2." + a + ".WebView2Loader.dll", Path.Combine(InstallDir, "runtimes", a, "WebView2Loader.dll"));
                if (ExtractResource("lively.zip", WebRoot) != 0) throw new IOException("网页文件没有写完整");
                err = null;
                break;
            }
            catch (Exception ex) { err = ex.Message; Thread.Sleep(1000); }
        }
        if (err != null)
        {
            MessageBox.Show("没有装好：" + err + "\n请稍等几秒再双击本程序一次。", AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        // 开机启动：第一次装默认勾上；之后用户在托盘里取消过就记住
        if (GetPref("AutoStartSeen", 0) == 0 || AutoStartEnabled()) SetAutoStart(true, InstalledExe);
        SetPref("AutoStartSeen", 1);

        // 3) 启动装好的那份，等桌面上的报纸载入完成再说「装好了」
        bool ok;
        using (EventWaitHandle ready = new EventWaitHandle(false, EventResetMode.ManualReset, ReadyEvent))
        {
            try { Process.Start(InstalledExe); }
            catch (Exception ex) { MessageBox.Show("没有启动成功：" + ex.Message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            ok = ready.WaitOne(30000);
        }
        string dup = OldHostCopy() ? "\n\n这台电脑的 Lively / Wallpaper Engine 里也导入过本壁纸：请在它们里面换成别的壁纸，不然两份报纸叠在一起，点一下会打开两次网页。" : "";
        if (ok) MessageBox.Show("装好了。\n桌面上的报纸可以直接点；屏幕右下角多了一个小图标，右键可以换预设和外观。" + dup, AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
        else MessageBox.Show("装好了，但报纸还没出现在桌面上。稍等一会儿；还不行的话，右键屏幕右下角的小图标选「退出」，再双击一次安装程序。", AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    /// <summary>Lively / WE 里是不是导入过本壁纸（只看文件夹在不在，不改动它们）</summary>
    static bool OldHostCopy()
    {
        try
        {
            string lv = LivelyLibrary();
            if (lv != null && Directory.Exists(Path.Combine(lv, "AI-news-cover"))) return true;
            string we = UninstallLocation("Wallpaper Engine");
            if (we == null)
            {
                string steam = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam", "SteamPath", null) as string;
                if (!string.IsNullOrEmpty(steam)) we = Path.Combine(steam.Replace('/', '\\'), @"steamapps\common\wallpaper_engine");
            }
            return we != null && Directory.Exists(Path.Combine(we, @"projects\myprojects\AI-news-cover"));
        }
        catch { return false; }
    }

    // ---------------- 托盘 + 壁纸 ----------------
    static NotifyIcon tray;
    static WallpaperHost host;
    static bool hostStarted;

    static Icon LoadIcon()
    {
        // app.ico 的每一帧都是 PNG 压缩的，.NET Framework 的 Icon 类读这种帧会读成乱码：
        // 自己挑一帧（不小于托盘需要的尺寸里最小的那帧），解成图片再缩到托盘尺寸
        try
        {
            byte[] b;
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.ico"))
            {
                if (s == null) return SystemIcons.Application;
                MemoryStream ms = new MemoryStream();
                s.CopyTo(ms);
                b = ms.ToArray();
            }
            int want = SystemInformation.SmallIconSize.Width;
            int n = BitConverter.ToUInt16(b, 4), best = -1, bestW = int.MaxValue, maxI = 0, maxW = 0;
            for (int i = 0; i < n; i++)
            {
                int w = b[6 + 16 * i]; if (w == 0) w = 256;
                if (w >= want && w < bestW) { best = i; bestW = w; }
                if (w > maxW) { maxW = w; maxI = i; }
            }
            if (best < 0) best = maxI;
            int size = (int)BitConverter.ToUInt32(b, 6 + 16 * best + 8);
            int off = (int)BitConverter.ToUInt32(b, 6 + 16 * best + 12);
            using (Image src = Image.FromStream(new MemoryStream(b, off, size)))
            using (Bitmap dst = new Bitmap(want, want))
            {
                using (Graphics g = Graphics.FromImage(dst))
                {
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                    g.DrawImage(src, 0, 0, want, want);
                }
                return Icon.FromHandle(dst.GetHicon());
            }
        }
        catch { }
        return SystemIcons.Application;
    }

    static void ApplyPrefsToPage(WallpaperWindow w)
    {
        int theme = GetPref("Theme", 0); // 0 跟随系统 1 浅色 2 深色（和 Lively 属性面板一致）
        string js = "window.livelyPropertyListener && livelyPropertyListener('theme'," + theme + ");";
        try { w.Ctl.CoreWebView2.ExecuteScriptAsync(js); } catch { }
    }

    static async void StartHost()
    {
        if (hostStarted) return;
        if (RuntimeVersion() == null) { AskInstallWebView2(); return; }
        hostStarted = true;
        host = new WallpaperHost();
        host.WebRoot = WebRoot;
        host.DataDir = DataDir;
        host.LoaderDir = Path.Combine(InstallDir, "runtimes", Arch());
        host.OpenExternalHandler = delegate (string u) { if (Allowed(u)) OpenInBrowser(u); };
        host.PageReady = ApplyPrefsToPage;
        host.Ready = delegate
        {
            try
            {
                EventWaitHandle e;
                if (EventWaitHandle.TryOpenExisting(ReadyEvent, out e)) { e.Set(); e.Dispose(); }
            }
            catch { }
        };
        for (int attempt = 0; ; attempt++)
        {
            Exception err = null;
            try { await host.Start(); }
            catch (Exception ex) { err = ex; }
            if (err == null) return;
            // 旧版刚退出时 WebView2 的后台进程可能还没走完：等一下再试
            host.Stop();
            if (attempt >= 3)
            {
                hostStarted = false;
                tray.ShowBalloonTip(8000, AppName, "桌面报纸没有启动成功：" + err.Message, ToolTipIcon.Warning);
                return;
            }
            await Task.Delay(2000);
        }
    }

    static void Exit()
    {
        try { if (host != null) host.Stop(); } catch { }
        tray.Visible = false;
        Application.Exit();
    }

    static void ImportToHosts()
    {
        string lively = InstallLively();
        string we = InstallWE();
        if (lively == null && we == null)
        {
            MessageBox.Show("没找到 Lively 或 Wallpaper Engine。不装它们也没关系，桌面上的报纸本来就能用。", AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        string msg = (lively ?? "") + (lively != null && we != null ? "\n" : "") + (we ?? "");
        msg += "\n\n如果改用它们来显示，可以在托盘菜单里把本程序的壁纸隐藏，避免叠在一起。";
        MessageBox.Show(msg, AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    static void Uninstall()
    {
        if (MessageBox.Show("卸载 AI news cover？\n（如果导入过 Lively / Wallpaper Engine，那边的壁纸请在它们里面删除。）", AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        try
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey, true))
            {
                if (k != null) { k.DeleteValue(RunName, false); k.DeleteValue(OldRunName, false); }
            }
            try { Registry.CurrentUser.DeleteSubKeyTree(PrefKey, false); } catch { }
            try { if (host != null) host.Stop(); } catch { }
            // 等本程序和 WebView2 的后台进程都退出后再删目录（删不掉就多试几次）
            string cmd = "/c for /l %i in (1,1,10) do (ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"" + InstallDir + "\" 2>nul & if not exist \"" + InstallDir + "\" exit)";
            ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", cmd);
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            Process.Start(psi);
        }
        catch { }
        tray.Visible = false;
        Application.Exit();
    }

    static void RunApp()
    {
        // 壁纸程序不给用户弹技术错误框：界面线程上的意外异常一律吞掉（各处已尽量自己处理）
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += delegate { };
        SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());

        // 旧版本留下的启动项：换成新名字
        using (RegistryKey rk = Registry.CurrentUser.OpenSubKey(RunKey, false))
        {
            if (rk != null && rk.GetValue(OldRunName) != null) SetAutoStart(true);
        }

        Thread t = new Thread(Serve);
        t.IsBackground = true;
        t.Start();

        tray = new NotifyIcon();
        tray.Icon = LoadIcon();
        tray.Text = AppName;
        ContextMenuStrip menu = new ContextMenuStrip();

        ToolStripMenuItem glance = new ToolStripMenuItem("简约版");
        ToolStripMenuItem full = new ToolStripMenuItem("详细版");
        glance.Click += delegate { if (host != null) host.Exec("window.livelyPropertyListener && livelyPropertyListener('preset',0)"); glance.Checked = true; full.Checked = false; };
        full.Click += delegate { if (host != null) host.Exec("window.livelyPropertyListener && livelyPropertyListener('preset',1)"); glance.Checked = false; full.Checked = true; };

        ToolStripMenuItem theme = new ToolStripMenuItem("外观");
        string[] themeNames = new string[] { "跟随系统", "浅色", "深色" };
        for (int i = 0; i < themeNames.Length; i++)
        {
            int idx = i;
            ToolStripMenuItem it = new ToolStripMenuItem(themeNames[i]);
            it.Click += delegate
            {
                SetPref("Theme", idx);
                if (host != null) host.Exec("window.livelyPropertyListener && livelyPropertyListener('theme'," + idx + ")");
            };
            theme.DropDownItems.Add(it);
        }
        theme.DropDownOpening += delegate
        {
            int cur = GetPref("Theme", 0);
            for (int i = 0; i < theme.DropDownItems.Count; i++) ((ToolStripMenuItem)theme.DropDownItems[i]).Checked = i == cur;
        };

        ToolStripMenuItem import = new ToolStripMenuItem("导入到 Lively / Wallpaper Engine");
        import.Click += delegate { ImportToHosts(); };

        ToolStripMenuItem auto = new ToolStripMenuItem("开机启动");
        auto.Click += delegate { SetAutoStart(!auto.Checked); auto.Checked = AutoStartEnabled(); };
        ToolStripMenuItem un = new ToolStripMenuItem("卸载");
        un.Click += delegate { Uninstall(); };
        ToolStripMenuItem quit = new ToolStripMenuItem("退出");
        quit.Click += delegate { Exit(); };

        // 第一层：版式（单选）、外观、更多、退出；不常用的放进「更多」
        ToolStripMenuItem more = new ToolStripMenuItem("更多");
        more.DropDownItems.Add(auto);
        more.DropDownItems.Add(import);
        more.DropDownItems.Add(un);
        menu.Items.Add(glance);
        menu.Items.Add(full);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(theme);
        menu.Items.Add(more);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(quit);
        menu.Opening += async delegate
        {
            bool vis = hostStarted && host != null;
            glance.Enabled = full.Enabled = theme.Enabled = vis;
            auto.Checked = AutoStartEnabled();
            import.Visible = LivelyLibrary() != null || UninstallLocation("Lively Wallpaper") != null || UninstallLocation("Wallpaper Engine") != null
                || Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam", "SteamPath", null) != null;
            // 版式由网页自己记着（右下角的小图标也能切），打开菜单时问一下网页
            if (vis)
            {
                string p = await host.Eval("(function(){var s=document.getElementById('stage');return s?s.dataset.preset:null})()");
                bool isFull = p == "\"full\"";
                glance.Checked = !isFull; full.Checked = isFull;
            }
        };
        tray.ContextMenuStrip = menu;
        // 左键单击托盘图标也弹菜单（很多人只会左键点）
        tray.MouseUp += delegate (object s, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            MethodInfo mi = typeof(NotifyIcon).GetMethod("ShowContextMenu", BindingFlags.Instance | BindingFlags.NonPublic);
            if (mi != null) mi.Invoke(tray, null);
        };
        tray.Visible = true;

        // 安装程序要求旧版退出时：干净地关掉网页再退出
        Control invoker = new Control();
        invoker.CreateControl();
        EventWaitHandle quitEv = new EventWaitHandle(false, EventResetMode.AutoReset, QuitEvent);
        ThreadPool.RegisterWaitForSingleObject(quitEv, delegate { try { invoker.BeginInvoke((Action)Exit); } catch { } }, null, -1, true);

        StartHost();
        Application.Run();
        GC.KeepAlive(quitEv);
        GC.KeepAlive(invoker);
    }

    [STAThread]
    static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        if (!IsInstalledCopy()) { RunSetup(); return; }

        bool created;
        Mutex m = new Mutex(true, "AI-news-cover-Opener.Single", out created);
        if (!created)
        {
            // 已经在运行（比如又从开始菜单点了一次）：不重复启动
            return;
        }
        RunApp();
        GC.KeepAlive(m);
    }
}

// AI news cover 托盘小工具（兼安装程序）：只监听 127.0.0.1:47821。
// 双击 AI-news-cover-Setup.exe：装到用户目录、设开机自启、把壁纸导入已装的 Lively / Wallpaper Engine。
// 装好之后运行的是它自己的一份拷贝，托盘菜单里有「开机启动」「卸载」「退出」。
// 壁纸点外链时请求 /open?url=...，这里用系统默认浏览器打开，并把浏览器拉到前台。
// 只放行 https://aihot.news/ 的网址，其余一律拒绝；跨域只回应壁纸自己的来源。
// 注意：系统自带的 csc 只支持 C# 5，所以不用字符串插值、?. 等新语法。
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Drawing;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Opener
{
    const int Port = 47821;
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RunName = "AI-news-cover-Opener";
    const string OldRunName = "AINewsCoverOpener"; // 旧版本用过的启动项名，启动时迁移到新名

    [DllImport("user32.dll")]
    static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")]
    static extern bool AllowSetForegroundWindow(int pid);

    static bool AutoStartEnabled()
    {
        using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey, false))
        {
            return k != null && (k.GetValue(RunName) != null || k.GetValue(OldRunName) != null);
        }
    }

    static void SetAutoStart(bool on) { SetAutoStart(on, Application.ExecutablePath); }

    static void SetAutoStart(bool on, string exe)
    {
        using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey, true))
        {
            if (k == null) return;
            k.DeleteValue(OldRunName, false);
            if (on) k.SetValue(RunName, "\"" + exe + "\"");
            else k.DeleteValue(RunName, false);
        }
    }

    // 壁纸页面的 Origin：Lively 用 file:// 加载本地网页，浏览器发出的是字面量 "null"；
    // 直接请求（没有 Origin 头，如本机 curl / 自检）也放行。浏览器里的 https 网页一定带 Origin，会被挡下。
    // （实测：Lively 页面的来源是 https://<随机串>.localhost。）
    static bool OriginAllowed(string origin)
    {
        if (string.IsNullOrEmpty(origin)) return true;
        if (origin == "null" || origin.StartsWith("file://", StringComparison.OrdinalIgnoreCase)) return true;
        // Lively 的网页来源是 https://<随机串>.localhost：只放行 localhost 本身和它的子域，其余 https 站点仍拒绝
        Uri u;
        if (!Uri.TryCreate(origin, UriKind.Absolute, out u)) return false;
        if (u.Scheme != "https" && u.Scheme != "http") return false;
        string h = u.Host.ToLowerInvariant();
        return h == "localhost" || h.EndsWith(".localhost", StringComparison.Ordinal);
    }

    const string PrefKey = @"Software\AINewsCover";
    static bool Allowed(string url)
    {
        if (string.IsNullOrEmpty(url) || url.Length > 2000) return false;
        foreach (char c in url)
            if (c <= ' ' || c == '"' || c == '<' || c == '>' || c == '^' || c == '|') return false;
        Uri u;
        if (!Uri.TryCreate(url, UriKind.Absolute, out u)) return false;
        return u.Scheme == "https" && u.Host == "aihot.news" && u.Port == 443 && string.IsNullOrEmpty(u.UserInfo);
    }

    static void OpenInBrowser(string url)
    {
        // 让系统允许“被我们唤起的浏览器”抢到前台：先发一次按键，再放开前台限制。
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        AllowSetForegroundWindow(-1);
        ProcessStartInfo psi = new ProcessStartInfo(url);
        psi.UseShellExecute = true;
        Process.Start(psi);
    }

    static void Serve()
    {
        // 端口被占（比如旧版本还没退出）时每 5 秒再试，不让整个程序崩掉
        for (;;)
        {
            HttpListener l = new HttpListener();
            try
            {
                l.Prefixes.Add("http://127.0.0.1:" + Port + "/");
                l.Start();
            }
            catch { try { l.Close(); } catch { } Thread.Sleep(5000); continue; }
            while (true)
            {
                HttpListenerContext c;
                try { c = l.GetContext(); }
                catch { break; }
                ThreadPool.QueueUserWorkItem(Handle, c);
            }
            try { l.Close(); } catch { }
            Thread.Sleep(2000);
        }
    }

    static string ReadTheme()
    {
        // 读 Windows「应用模式」：0 = 深色，1 = 浅色
        object v = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1);
        return (v is int && (int)v == 0) ? "dark" : "light";
    }

    static void Handle(object state)
    {
        HttpListenerContext c = (HttpListenerContext)state;
        {
            int status = 404;
            try
            {
                // 跨域：只回应壁纸自己的来源；其他网页（浏览器里逛的任意站点）拿不到响应，也不能触发 /open
                string origin = c.Request.Headers["Origin"];
                bool originOk = OriginAllowed(origin);
                if (originOk && origin != null)
                {
                    c.Response.AddHeader("Access-Control-Allow-Origin", origin);
                    c.Response.AddHeader("Vary", "Origin");
                    c.Response.AddHeader("Access-Control-Allow-Private-Network", "true");
                    c.Response.AddHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
                    c.Response.AddHeader("Access-Control-Allow-Headers", "*");
                    c.Response.AddHeader("Access-Control-Max-Age", "600");
                }
                string path = c.Request.Url.AbsolutePath;
                if (c.Request.HttpMethod == "OPTIONS") status = originOk ? 204 : 403;
                else if (!originOk) status = 403;
                else if (path == "/ping") status = 204;
                else if (path == "/theme")
                {
                    // 长轮询：带 wait=<壁纸当前的主题> 时，一直等到系统主题和它不同再返回（最多 25 秒），
                    // 这样系统一变壁纸立刻知道，平时没有任何周期性请求。
                    string cur = ReadTheme();
                    string wait = c.Request.QueryString["wait"];
                    if (wait == "dark" || wait == "light")
                    {
                        int waited = 0;
                        while (cur == wait && waited < 25000) { Thread.Sleep(250); waited += 250; cur = ReadTheme(); }
                    }
                    byte[] body = System.Text.Encoding.ASCII.GetBytes(cur);
                    c.Response.ContentType = "text/plain";
                    c.Response.ContentLength64 = body.Length;
                    c.Response.OutputStream.Write(body, 0, body.Length);
                    status = 200;
                }
                else if (path == "/open")
                {
                    string url = c.Request.QueryString["url"];
                    // /open 必须带壁纸的 Origin（壁纸用 cors 模式请求）；没有 Origin 的跨站简单请求一律拒绝
                    if (!string.IsNullOrEmpty(origin) && Allowed(url)) { OpenInBrowser(url); status = 204; }
                    else status = 403;
                }
            }
            catch { status = 500; }
            try { if (status != 200) c.Response.StatusCode = status; c.Response.Close(); } catch { }
        }
    }

    // ---------------- 安装 / 卸载 ----------------
    const string AppName = "AI news cover";
    static readonly string InstallDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AI-news-cover");
    static readonly string InstalledExe = Path.Combine(InstallDir, "AI-news-cover.exe");

    static bool IsInstalledCopy()
    {
        try { return string.Equals(Path.GetFullPath(Application.ExecutablePath), InstalledExe, StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }

    // 解开内嵌的壁纸包到目录（同名文件直接覆盖；返回写失败的文件数，-1 表示包不存在）
    static int ExtractResource(string name, string dir)
    {
        int failed = 0;
        using (Stream rs = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        {
            if (rs == null) return -1;
            using (ZipArchive z = new ZipArchive(rs, ZipArchiveMode.Read))
            {
                string root = Path.GetFullPath(dir) + Path.DirectorySeparatorChar;
                foreach (ZipArchiveEntry e in z.Entries)
                {
                    if (e.FullName.EndsWith("/")) continue;
                    string target = Path.GetFullPath(Path.Combine(dir, e.FullName.Replace('/', Path.DirectorySeparatorChar)));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
                    try
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        e.ExtractToFile(target, true);
                    }
                    catch { failed++; }
                }
            }
        }
        return failed;
    }

    static string UninstallLocation(string namePart)
    {
        string sub = @"Software\Microsoft\Windows\CurrentVersion\Uninstall";
        string sub32 = @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";
        RegistryKey[] hives = new RegistryKey[] { Registry.CurrentUser, Registry.LocalMachine, Registry.LocalMachine };
        string[] subs = new string[] { sub, sub, sub32 };
        for (int i = 0; i < hives.Length; i++)
        {
            try
            {
                using (RegistryKey k = hives[i].OpenSubKey(subs[i], false))
                {
                    if (k == null) continue;
                    foreach (string n in k.GetSubKeyNames())
                    {
                        using (RegistryKey sk = k.OpenSubKey(n, false))
                        {
                            string dn = sk == null ? null : sk.GetValue("DisplayName") as string;
                            string loc = sk == null ? null : sk.GetValue("InstallLocation") as string;
                            if (dn != null && dn.IndexOf(namePart, StringComparison.OrdinalIgnoreCase) >= 0 && !string.IsNullOrEmpty(loc) && Directory.Exists(loc)) return loc;
                        }
                    }
                }
            }
            catch { }
        }
        return null;
    }

    static bool Running(string procName)
    {
        try { return Process.GetProcessesByName(procName).Length > 0; } catch { return false; }
    }

    static void Launch(string exe, string args)
    {
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(exe, args);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            Process.Start(psi);
        }
        catch { }
    }

    // Lively：库目录在它的 Settings.json 里（WallpaperDir），壁纸放在其下的 wallpapers\ 里
    static string LivelyLibrary()
    {
        string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Lively Wallpaper");
        if (!Directory.Exists(data)) return null;
        string lib = Path.Combine(data, "Library");
        try
        {
            string sj = Path.Combine(data, "Settings.json");
            if (File.Exists(sj))
            {
                Match m = Regex.Match(File.ReadAllText(sj, Encoding.UTF8), "\"WallpaperDir\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
                if (m.Success) lib = m.Groups[1].Value.Replace("\\\\", "\\");
            }
        }
        catch { }
        return Path.Combine(lib, "wallpapers");
    }

    static string InstallLively()
    {
        string wp = LivelyLibrary();
        string exeDir = UninstallLocation("Lively Wallpaper");
        if (wp == null && exeDir == null) return null;
        if (wp == null) return "已找到 Lively，但它还没有运行过。请先打开一次 Lively，再双击本程序一次。";
        string dir = Path.Combine(wp, "AI-news-cover");
        if (ExtractResource("lively.zip", dir) != 0) return "导入 Lively 没有成功。请先退出 Lively，再双击本程序一次。";
        string exe = exeDir == null ? null : Path.Combine(exeDir, "Lively.exe");
        if (exe != null && File.Exists(exe) && Running("Lively"))
        {
            Launch(exe, "setwp --file \"" + dir + "\"");
            return "已导入 Lively，并设为当前壁纸。";
        }
        return "已导入 Lively。打开 Lively，在库里选「AI news cover」即可（没看到的话重启一次 Lively）。";
    }

    static string InstallWE()
    {
        string loc = UninstallLocation("Wallpaper Engine");
        if (loc == null)
        {
            try
            {
                string steam = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam", "SteamPath", null) as string;
                if (!string.IsNullOrEmpty(steam))
                {
                    string cand = Path.Combine(steam.Replace('/', '\\'), @"steamapps\common\wallpaper_engine");
                    if (Directory.Exists(cand)) loc = cand;
                }
            }
            catch { }
        }
        if (loc == null) return null;
        string dir = Path.Combine(loc, @"projects\myprojects\AI-news-cover");
        if (ExtractResource("we.zip", dir) != 0) return "导入 Wallpaper Engine 没有成功。请先退出 Wallpaper Engine，再双击本程序一次。";
        string exe = Path.Combine(loc, "wallpaper64.exe");
        if (!File.Exists(exe)) exe = Path.Combine(loc, "wallpaper32.exe");
        if (File.Exists(exe) && (Running("wallpaper64") || Running("wallpaper32")))
        {
            Launch(exe, "-control openWallpaper -file \"" + Path.Combine(dir, "project.json") + "\"");
            return "已导入 Wallpaper Engine，并设为当前壁纸。";
        }
        return "已导入 Wallpaper Engine。打开它，在「已安装」里找「AI news cover」即可。";
    }

    static void RunSetup()
    {
        // 1) 托盘小工具：装到用户目录（正在运行的旧版先退出）、开机自启、启动
        string[] names = new string[] { "AI-news-cover", "AI-news-cover-Opener", "AINewsCoverOpener" };
        foreach (string nm in names)
        {
            foreach (Process p in Process.GetProcessesByName(nm))
            {
                try
                {
                    bool mine = nm != "AI-news-cover" || string.Equals(p.MainModule.FileName, InstalledExe, StringComparison.OrdinalIgnoreCase);
                    if (mine) { p.Kill(); p.WaitForExit(3000); }
                }
                catch { }
            }
        }
        string trayMsg;
        try
        {
            Directory.CreateDirectory(InstallDir);
            File.Copy(Application.ExecutablePath, InstalledExe, true);
            SetAutoStart(true, InstalledExe);
            try { using (RegistryKey k = Registry.CurrentUser.CreateSubKey(PrefKey)) { k.SetValue("AutoStartSeen", 1); } } catch { }
            Process.Start(InstalledExe);
            trayMsg = "已装好托盘小工具（开机自动运行）。";
        }
        catch (Exception ex) { trayMsg = "托盘小工具没有装好：" + ex.Message; }

        // 2) 壁纸：装了哪个导入哪个
        string lively = InstallLively();
        string we = InstallWE();
        if (lively == null && we == null)
        {
            if (MessageBox.Show("没找到 Lively 或 Wallpaper Engine。先装一个，再运行我一次就好。要现在去下载 Lively 吗？", AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
            {
                try { Process.Start("https://rocksdanister.github.io/lively/"); } catch { }
            }
            return;
        }
        bool allOk = trayMsg.StartsWith("已装好") && (lively == null || lively.StartsWith("已导入")) && (we == null || we.StartsWith("已导入"));
        StringBuilder sb = new StringBuilder();
        if (allOk) sb.Append("装好了。去 Lively 的库或 Wallpaper Engine 的「已安装」里，选「AI news cover」。");
        else
        {
            sb.Append(trayMsg);
            if (lively != null) sb.Append("\n").Append(lively);
            if (we != null) sb.Append("\n").Append(we);
        }
        MessageBox.Show(sb.ToString(), AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    static void Uninstall(NotifyIcon tray)
    {
        if (MessageBox.Show("卸载 AI news cover 的托盘小工具？\n（壁纸本身请在 Lively / Wallpaper Engine 里删除。）", AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        try
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey, true))
            {
                if (k != null) { k.DeleteValue(RunName, false); k.DeleteValue(OldRunName, false); }
            }
            try { Registry.CurrentUser.DeleteSubKeyTree(PrefKey, false); } catch { }
            // 等本程序退出后再删目录
            ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"" + InstallDir + "\"");
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            Process.Start(psi);
        }
        catch { }
        tray.Visible = false;
        Application.Exit();
    }

    [STAThread]
    static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        if (!IsInstalledCopy()) { RunSetup(); return; }

        bool created;
        Mutex m = new Mutex(true, "AI-news-cover-Opener.Single", out created);
        if (!created) return;

        // 旧版本留下的启动项：换成新名字
        using (RegistryKey rk = Registry.CurrentUser.OpenSubKey(RunKey, false))
        {
            if (rk != null && rk.GetValue(OldRunName) != null) SetAutoStart(true);
        }

        Thread t = new Thread(Serve);
        t.IsBackground = true;
        t.Start();

        NotifyIcon tray = new NotifyIcon();
        tray.Icon = SystemIcons.Application;
        tray.Text = AppName;
        ContextMenuStrip menu = new ContextMenuStrip();
        ToolStripMenuItem auto = new ToolStripMenuItem("开机启动");
        auto.Checked = AutoStartEnabled();
        auto.Click += delegate { SetAutoStart(!auto.Checked); auto.Checked = AutoStartEnabled(); };
        ToolStripMenuItem un = new ToolStripMenuItem("卸载");
        un.Click += delegate { Uninstall(tray); };
        ToolStripMenuItem quit = new ToolStripMenuItem("退出");
        quit.Click += delegate { tray.Visible = false; Application.Exit(); };
        menu.Items.Add(auto);
        menu.Items.Add(un);
        menu.Items.Add(quit);
        tray.ContextMenuStrip = menu;
        tray.Visible = true;
        Application.Run();
        GC.KeepAlive(m);
    }
}

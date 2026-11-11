// 网页部分的远程更新（2026-11-11 用户批准方案 A）：只换桌面报纸那份网页，不换程序本身。
// 启动 1 分钟后查一次，之后每 6 小时一次：取 Release 上的 web-update.txt + .sig，
// 用写死在这里的公钥验签 → 版本比现在新、程序能力够 → 下载 web-update.zip、核对 SHA-256 →
// 解到 www-<build>\，记进 web-next.txt。报纸暂停时（锁屏 / 睡眠 / 全屏 / 被挡住）换过去；下次启动直接用。
// 任何一步不对都保持原样，只写日志。只连 HTTPS 的固定地址；只写安装目录里自己的文件。
// 注意：系统自带的 csc 只支持 C# 5。
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

static class WebUpdate
{
    /// <summary>本程序提供给网页的能力版本；网页包要求更高时不换（build/make-update.mjs 的 HOST_API）</summary>
    public const int HostApi = 1;
    const string KeyModulus = "xnNwbZUDFWLIulDYNqD1IPrsIETEvanYCGY9KedyZrjZat1uSiws7Iw4VdsYEyGTyJuGosHlyKCh0J9Pxa7BECA8oHYyKiuOhSwfHMNZw44+1NIVOtQ668f/NJ6n9NhS3+xHxC/Z865/gGN3gt/74vfZxdDvsGhNr7uYvaP+TV/ikiRpDmVuULrYmjc36d030OPFXuvnj79O5311myN5JvJC3AtKJrXqqzEqWSo8I7NE7WAduOT7srCjB0G++vqtR82sx648mGW4ot6o6EQt2oO9dZjSiy8eKIWJO1VTsV7nhpuUiu6ZXyq2gvVytgo/5MKHSQH5rDVtV8Bab8TpXal4pDRz3Se72f/UyDT0+c6+jA4XNJC3QIyQ4ZGjUP6+993SrztuFUDCHXzC+DLliUKYrpkGeUn3QE4a1rMftJVFHPkneZFzmOBAjfFaOFpsDeIQqXsfedhrcWzR92ljvAlO1+WdIdbR9T6ozjUcpxKEf03ApOlJnfMtDTTTKsP/";
    const string KeyExponent = "AQAB";
    const string DefaultBase = "https://github.com/LilJay-H/ai-news-cover/releases/latest/download/";
    const long MaxZip = 64L * 1024 * 1024;

    public static string InstallDir;
    static string Base
    {
        get
        {
            // 自测用：AINC_UPDATE_BASE 换成本机地址（签名照样要对，换地址不会让坏包通过）
            string b = Environment.GetEnvironmentVariable("AINC_UPDATE_BASE");
            return string.IsNullOrEmpty(b) ? DefaultBase : b.TrimEnd('/') + "/";
        }
    }

    static string P(string name) { return Path.Combine(InstallDir, name); }
    static string Pointer { get { return P("web.txt"); } }      // 正在用的网页目录名
    static string NextPointer { get { return P("web-next.txt"); } } // 下好、等着换的目录名

    static string ReadName(string file)
    {
        try
        {
            if (!File.Exists(file)) return null;
            string n = File.ReadAllText(file).Trim();
            // 只认 www-<14 位数字>，防止指到别处
            if (n.Length != 18 || !n.StartsWith("www-")) return null;
            for (int i = 4; i < n.Length; i++) if (n[i] < '0' || n[i] > '9') return null;
            return Valid(P(n)) ? n : null;
        }
        catch { return null; }
    }

    static bool Valid(string dir) { return File.Exists(Path.Combine(dir, "index.html")) && File.Exists(Path.Combine(dir, "build.txt")); }

    public static long BuildOf(string dir)
    {
        try { long b; return long.TryParse(File.ReadAllText(Path.Combine(dir, "build.txt")).Trim(), out b) ? b : 0; }
        catch { return 0; }
    }

    /// <summary>启动时：有下好的新版就转正；返回这次要用的网页目录；顺手删掉用不上的旧目录</summary>
    public static string ActiveRoot()
    {
        string next = ReadName(NextPointer);
        string cur = ReadName(Pointer);
        string www = P("www");
        if (next != null && BuildOf(P(next)) > Math.Max(BuildOf(www), cur == null ? 0 : BuildOf(P(cur))))
        {
            try { File.WriteAllText(Pointer, next); cur = next; Log.Write("网页更新：启动时换到 " + next); } catch { }
        }
        try { File.Delete(NextPointer); } catch { }
        // 安装程序带来的那份更新时（重新装了新版 Setup.exe），以它为准
        if (cur != null && BuildOf(P(cur)) <= BuildOf(www)) { cur = null; try { File.Delete(Pointer); } catch { } }
        Cleanup(cur);
        return cur == null ? www : P(cur);
    }

    static void Cleanup(string keep)
    {
        try
        {
            foreach (string d in Directory.GetDirectories(InstallDir, "www-*"))
            {
                string n = Path.GetFileName(d);
                if (n == keep) continue;
                try { Directory.Delete(d, true); } catch { }
            }
            string tmp = P("web-update.tmp");
            if (File.Exists(tmp)) File.Delete(tmp);
        }
        catch { }
    }

    /// <summary>暂停时要不要换：有就返回新目录（只返回一次）</summary>
    public static string TakePending()
    {
        string n = ReadName(NextPointer);
        if (n == null) return null;
        try { File.WriteAllText(Pointer, n); File.Delete(NextPointer); } catch { return null; }
        return P(n);
    }

    public static bool HasPending { get { return pending; } }
    static volatile bool pending;
    static volatile bool checking;

    /// <summary>查一次（在后台线程上跑）；currentBuild 是正在显示的网页版本</summary>
    public static Task Check(long currentBuild)
    {
        if (checking) return Task.FromResult(0);
        checking = true;
        return Task.Run(delegate
        {
            try { CheckCore(currentBuild); }
            catch (Exception ex) { Log.Write("网页更新：没有完成（" + ex.Message + "）"); }
            finally { checking = false; }
        });
    }

    static byte[] Get(string url, long max)
    {
        HttpWebRequest r = (HttpWebRequest)WebRequest.Create(url);
        r.UserAgent = "AI-news-cover";
        r.Timeout = 30000;
        r.ReadWriteTimeout = 60000;
        r.AllowAutoRedirect = true;
        using (HttpWebResponse res = (HttpWebResponse)r.GetResponse())
        {
            if (!res.ResponseUri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase) && !IsLocalTest(res.ResponseUri))
                throw new IOException("不是 HTTPS");
            using (Stream s = res.GetResponseStream())
            {
                MemoryStream ms = new MemoryStream();
                byte[] buf = new byte[81920];
                int n;
                while ((n = s.Read(buf, 0, buf.Length)) > 0)
                {
                    ms.Write(buf, 0, n);
                    if (ms.Length > max) throw new IOException("文件太大");
                }
                return ms.ToArray();
            }
        }
    }

    static bool IsLocalTest(Uri u) { return u.Host == "127.0.0.1" && !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("AINC_UPDATE_BASE")); }

    static bool Verify(byte[] data, byte[] sig)
    {
        RSAParameters p = new RSAParameters();
        p.Modulus = Convert.FromBase64String(KeyModulus);
        p.Exponent = Convert.FromBase64String(KeyExponent);
        using (RSACryptoServiceProvider rsa = new RSACryptoServiceProvider())
        {
            rsa.PersistKeyInCsp = false;
            rsa.ImportParameters(p);
            return rsa.VerifyData(data, "SHA256", sig);
        }
    }

    static void CheckCore(long currentBuild)
    {
        ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; // TLS 1.2
        byte[] man = Get(Base + "web-update.txt", 4096);
        byte[] sig;
        try { sig = Convert.FromBase64String(Encoding.ASCII.GetString(Get(Base + "web-update.sig", 4096)).Trim()); }
        catch (FormatException) { throw new IOException("签名格式不对"); }
        if (!Verify(man, sig)) { Log.Write("网页更新：签名不对，不用"); return; }

        Dictionary<string, string> kv = new Dictionary<string, string>();
        string[] lines = Encoding.UTF8.GetString(man).Split('\n');
        if (lines.Length == 0 || lines[0].Trim() != "ai-news-cover-web-update 1") { Log.Write("网页更新：说明文件格式不认识"); return; }
        foreach (string line in lines)
        {
            int i = line.IndexOf('=');
            if (i > 0) kv[line.Substring(0, i).Trim()] = line.Substring(i + 1).Trim();
        }
        long build, size; int api;
        string sha;
        if (!kv.ContainsKey("build") || !long.TryParse(kv["build"], out build) || kv["build"].Length != 14
            || !kv.ContainsKey("size") || !long.TryParse(kv["size"], out size) || size <= 0 || size > MaxZip
            || !kv.ContainsKey("hostApi") || !int.TryParse(kv["hostApi"], out api)
            || !kv.TryGetValue("sha256", out sha) || sha.Length != 64)
        { Log.Write("网页更新：说明文件缺项"); return; }

        string nextName = ReadName(NextPointer);
        long have = Math.Max(currentBuild, nextName == null ? 0 : BuildOf(P(nextName)));
        if (build <= have) { Log.Write("网页更新：已是最新（" + have + "）"); return; }
        if (api > HostApi) { Log.Write("网页更新：新网页 " + build + " 需要更新的程序，等重新安装"); return; }

        byte[] zip = Get(Base + "web-update.zip", MaxZip);
        string got;
        using (SHA256 h = SHA256.Create()) got = BitConverter.ToString(h.ComputeHash(zip)).Replace("-", "").ToLowerInvariant();
        if (zip.Length != size || got != sha.ToLowerInvariant()) { Log.Write("网页更新：下载的包校验不符，不用"); return; }

        string name = "www-" + build;
        string dir = P(name), tmp = dir + ".part";
        if (Directory.Exists(tmp)) Directory.Delete(tmp, true);
        Directory.CreateDirectory(tmp);
        string root = Path.GetFullPath(tmp) + Path.DirectorySeparatorChar;
        using (ZipArchive z = new ZipArchive(new MemoryStream(zip), ZipArchiveMode.Read))
        {
            foreach (ZipArchiveEntry e in z.Entries)
            {
                if (e.FullName.EndsWith("/")) continue;
                string target = Path.GetFullPath(Path.Combine(tmp, e.FullName.Replace('/', Path.DirectorySeparatorChar)));
                if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new IOException("包里有越界路径");
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                e.ExtractToFile(target, true);
            }
        }
        if (!Valid(tmp) || BuildOf(tmp) != build) { Directory.Delete(tmp, true); Log.Write("网页更新：包内容不完整"); return; }
        if (Directory.Exists(dir)) Directory.Delete(dir, true);
        Directory.Move(tmp, dir);
        File.WriteAllText(NextPointer, name);
        pending = true;
        Log.Write("网页更新：已下好 " + build + "，等报纸暂停时换上");
    }

    /// <summary>换完之后调用</summary>
    public static void Applied() { pending = false; }
}

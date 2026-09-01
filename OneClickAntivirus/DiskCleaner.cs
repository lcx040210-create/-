using System;
using System.IO;
using System.Runtime.InteropServices;

namespace OneClickAntivirus
{
    public static class DiskCleaner
    {
        public static string FormatBytes(long bytes)
        {
            if (bytes < 1024) return bytes + " B";
            double kb = bytes / 1024.0;
            if (kb < 1024) return kb.ToString("0.0") + " KB";
            double mb = kb / 1024.0;
            if (mb < 1024) return mb.ToString("0.0") + " MB";
            return (mb / 1024.0).ToString("0.0") + " GB";
        }

        public static long CleanDirectory(string dir)
        {
            long freed = 0;
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return 0;

            foreach (string file in SafeGetFiles(dir))
            {
                try
                {
                    long len = new FileInfo(file).Length;
                    File.Delete(file);
                    freed += len;
                }
                catch
                {
                    // 跳过被占用 / 无权限的文件
                }
            }

            try
            {
                foreach (string sub in Directory.GetDirectories(dir))
                {
                    try { Directory.Delete(sub, true); }
                    catch { }
                }
            }
            catch { }

            return freed;
        }

        [DllImport("Shell32.dll", CharSet = CharSet.Unicode)]
        private static extern uint SHEmptyRecycleBin(IntPtr hwnd, string root, uint flags);

        public static void CleanRecycleBin()
        {
            const uint SHERB_NOCONFIRMATION = 0x1;
            const uint SHERB_NOPROGRESSUI = 0x2;
            const uint SHERB_NOSOUND = 0x4;
            try
            {
                SHEmptyRecycleBin(IntPtr.Zero, null, SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND);
            }
            catch { }
        }

        public static long CleanAll(Action<string> onProgress = null)
        {
            long freed = 0;

            if (onProgress != null) onProgress("正在清理:用户临时文件…");
            freed += CleanDirectory(Path.GetTempPath());

            if (onProgress != null) onProgress("正在清理:系统临时文件…");
            freed += CleanDirectory(@"C:\Windows\Temp");

            if (onProgress != null) onProgress("正在清理:Windows 更新缓存…");
            freed += CleanDirectory(@"C:\Windows\SoftwareDistribution\Download");

            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            if (onProgress != null) onProgress("正在清理:Chrome 浏览器缓存…");
            freed += CleanDirectory(Path.Combine(local, @"Google\Chrome\User Data\Default\Cache"));

            if (onProgress != null) onProgress("正在清理:Edge 浏览器缓存…");
            freed += CleanDirectory(Path.Combine(local, @"Microsoft\Edge\User Data\Default\Cache"));

            if (onProgress != null) onProgress("正在清理:回收站…");
            CleanRecycleBin();

            return freed;
        }

        private static string[] SafeGetFiles(string dir)
        {
            try { return Directory.GetFiles(dir, "*", SearchOption.AllDirectories); }
            catch
            {
                try { return Directory.GetFiles(dir); }
                catch { return new string[0]; }
            }
        }
    }
}

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

        public static long CleanAll()
        {
            long freed = 0;

            freed += CleanDirectory(Path.GetTempPath());
            freed += CleanDirectory(@"C:\Windows\Temp");
            freed += CleanDirectory(@"C:\Windows\SoftwareDistribution\Download");

            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            freed += CleanDirectory(Path.Combine(local, @"Google\Chrome\User Data\Default\Cache"));
            freed += CleanDirectory(Path.Combine(local, @"Microsoft\Edge\User Data\Default\Cache"));

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

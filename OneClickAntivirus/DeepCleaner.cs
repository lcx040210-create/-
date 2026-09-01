using System;
using System.Collections.Generic;
using System.IO;

namespace OneClickAntivirus
{
    public class DuplicateGroup
    {
        public List<string> Files = new List<string>();
        public long FileSize;

        // 保留一份后可释放的空间
        public long WasteBytes
        {
            get { return FileSize * (Files.Count - 1); }
        }
    }

    public class InstallerItem
    {
        public string Path;
        public long Size;
    }

    public class ProgramInfo
    {
        public string Name;
        public string Version;
        public string InstallDate;
        public string UninstallString;
        public long SizeBytes;
    }

    public static class DeepCleaner
    {
        // 判断路径是否属于系统/受保护目录(这些目录里的文件绝不碰)
        public static bool IsSystemDirectory(string path)
        {
            if (string.IsNullOrEmpty(path)) return false;
            string full = Path.GetFullPath(path).TrimEnd('\\').ToLowerInvariant();

            string sysDrive = Path.GetPathRoot(Environment.SystemDirectory).ToLowerInvariant();
            string[] protectedDirs = {
                sysDrive + "windows",
                sysDrive + "program files",
                sysDrive + "program files (x86)",
                sysDrive + "programdata",
                sysDrive + "$recycle.bin",
                sysDrive + "system volume information"
            };

            foreach (string d in protectedDirs)
            {
                if (full == d || full.StartsWith(d + "\\")) return true;
            }

            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData).ToLowerInvariant();
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData).ToLowerInvariant();
            if (full == localAppData || full.StartsWith(localAppData + "\\")) return true;
            if (full == appData || full.StartsWith(appData + "\\")) return true;

            return false;
        }

        // 按文件大小分组,只返回数量 >1 的大小组
        public static Dictionary<long, List<string>> GroupBySize(IEnumerable<string> files)
        {
            var bySize = new Dictionary<long, List<string>>();
            foreach (string f in files)
            {
                long size;
                try { size = new FileInfo(f).Length; }
                catch { continue; }

                List<string> list;
                if (!bySize.TryGetValue(size, out list))
                {
                    list = new List<string>();
                    bySize[size] = list;
                }
                list.Add(f);
            }

            var result = new Dictionary<long, List<string>>();
            foreach (var kv in bySize)
            {
                if (kv.Value.Count > 1) result[kv.Key] = kv.Value;
            }
            return result;
        }

        // 扫描根目录:桌面/文档/音乐/图片/视频/下载(不碰系统目录和 AppData)
        public static List<string> GetScanRoots()
        {
            var roots = new List<string>();
            string[] folders = {
                Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                Environment.GetFolderPath(Environment.SpecialFolder.MyMusic),
                Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),
                Environment.GetFolderPath(Environment.SpecialFolder.MyVideos)
            };

            foreach (string f in folders)
            {
                if (!string.IsNullOrEmpty(f) && !roots.Contains(f)) roots.Add(f);
            }

            string downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            if (Directory.Exists(downloads)) roots.Add(downloads);

            return roots;
        }

        // 递归枚举文件(跳过系统目录 + junction)
        public static List<string> EnumerateFiles(IEnumerable<string> roots)
        {
            var files = new List<string>();
            foreach (string root in roots)
            {
                if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) continue;
                CollectFiles(root, files);
            }
            return files;
        }

        private static void CollectFiles(string dir, List<string> files)
        {
            if (IsSystemDirectory(dir)) return;

            string[] fs;
            try { fs = Directory.GetFiles(dir); }
            catch { fs = new string[0]; }
            files.AddRange(fs);

            string[] subs;
            try { subs = Directory.GetDirectories(dir); }
            catch { subs = new string[0]; }
            foreach (string sub in subs)
            {
                try
                {
                    if ((File.GetAttributes(sub) & FileAttributes.ReparsePoint) != 0) continue;
                    CollectFiles(sub, files);
                }
                catch { }
            }
        }

        // 检测重复文件:大小分组 → 哈希分组
        public static List<DuplicateGroup> FindDuplicates(Action<string> onProgress = null)
        {
            var groups = new List<DuplicateGroup>();

            if (onProgress != null) onProgress("正在枚举文件…");
            var files = EnumerateFiles(GetScanRoots());
            if (onProgress != null) onProgress("共 " + files.Count + " 个文件,按大小分组…");

            var bySize = GroupBySize(files);
            int idx = 0;
            foreach (var kv in bySize)
            {
                idx++;
                if (onProgress != null) onProgress("计算哈希 " + idx + "/" + bySize.Count + "…");

                var byHash = new Dictionary<string, List<string>>();
                foreach (string f in kv.Value)
                {
                    string hash = ComputeHash(f);
                    if (hash == null) continue;

                    List<string> list;
                    if (!byHash.TryGetValue(hash, out list))
                    {
                        list = new List<string>();
                        byHash[hash] = list;
                    }
                    list.Add(f);
                }

                foreach (var hk in byHash)
                {
                    if (hk.Value.Count > 1)
                        groups.Add(new DuplicateGroup { Files = hk.Value, FileSize = kv.Key });
                }
            }

            return groups;
        }

        private static string ComputeHash(string path)
        {
            try
            {
                using (var md5 = System.Security.Cryptography.MD5.Create())
                using (var stream = File.OpenRead(path))
                {
                    byte[] hash = md5.ComputeHash(stream);
                    return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
                }
            }
            catch { return null; }
        }

        // 判断文件是否是安装包(扩展名 + 名称关键词)
        public static bool IsInstallerFile(string path)
        {
            if (string.IsNullOrEmpty(path)) return false;
            string ext = Path.GetExtension(path).ToLowerInvariant();
            string name = Path.GetFileName(path).ToLowerInvariant();

            if (ext == ".msi" || ext == ".dmg" || ext == ".iso") return true;

            if (ext == ".exe")
            {
                return name.Contains("setup") || name.Contains("install")
                    || name.Contains("安装") || name.Contains("升级");
            }

            return false;
        }

        // 安装日期 yyyyMMdd → "yyyy-MM-dd"
        public static string FormatInstallDate(string yyyyMMdd)
        {
            if (string.IsNullOrEmpty(yyyyMMdd) || yyyyMMdd.Length != 8) return "未知";
            try
            {
                int y = int.Parse(yyyyMMdd.Substring(0, 4));
                int m = int.Parse(yyyyMMdd.Substring(4, 2));
                int d = int.Parse(yyyyMMdd.Substring(6, 2));
                return y + "-" + m.ToString("00") + "-" + d.ToString("00");
            }
            catch { return "未知"; }
        }

        public static List<string> GetDrives()
        {
            var drives = new List<string>();
            foreach (var d in DriveInfo.GetDrives())
            {
                try
                {
                    if (d.IsReady && d.DriveType == DriveType.Fixed) drives.Add(d.Name);
                }
                catch { }
            }
            return drives;
        }

        // 全盘查找安装包
        public static List<InstallerItem> FindInstallers(Action<string> onProgress = null)
        {
            var results = new List<InstallerItem>();
            foreach (string drive in GetDrives())
            {
                if (onProgress != null) onProgress("正在扫描 " + drive + " 查找安装包…");
                ScanInstallers(drive, results);
            }
            return results;
        }

        private static void ScanInstallers(string dir, List<InstallerItem> results)
        {
            if (IsSystemDirectory(dir)) return;

            string[] files;
            try { files = Directory.GetFiles(dir); }
            catch { files = new string[0]; }
            foreach (string f in files)
            {
                if (!IsInstallerFile(f)) continue;
                try
                {
                    results.Add(new InstallerItem { Path = f, Size = new FileInfo(f).Length });
                }
                catch { }
            }

            string[] subs;
            try { subs = Directory.GetDirectories(dir); }
            catch { subs = new string[0]; }
            foreach (string sub in subs)
            {
                try
                {
                    if ((File.GetAttributes(sub) & FileAttributes.ReparsePoint) != 0) continue;
                    ScanInstallers(sub, results);
                }
                catch { }
            }
        }

        // 从注册表列出已安装程序
        public static List<ProgramInfo> ListPrograms()
        {
            var programs = new List<ProgramInfo>();
            string[] hklmPaths = {
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
            };
            foreach (string p in hklmPaths)
                ReadRegistryPrograms(Microsoft.Win32.Registry.LocalMachine, p, programs);
            ReadRegistryPrograms(Microsoft.Win32.Registry.CurrentUser, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", programs);

            // 按安装日期排序(旧的在前,未知的排最后)
            programs.Sort(delegate(ProgramInfo a, ProgramInfo b)
            {
                string da = a.InstallDate ?? "";
                string db = b.InstallDate ?? "";
                if (da == "" && db == "") return 0;
                if (da == "") return 1;
                if (db == "") return -1;
                return string.Compare(da, db);
            });

            return programs;
        }

        private static void ReadRegistryPrograms(Microsoft.Win32.RegistryKey baseKey, string path, List<ProgramInfo> programs)
        {
            using (Microsoft.Win32.RegistryKey key = baseKey.OpenSubKey(path))
            {
                if (key == null) return;
                foreach (string subName in key.GetSubKeyNames())
                {
                    using (Microsoft.Win32.RegistryKey sub = key.OpenSubKey(subName))
                    {
                        if (sub == null) continue;
                        string name = sub.GetValue("DisplayName") as string;
                        string uninstall = sub.GetValue("UninstallString") as string;
                        if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(uninstall)) continue;

                        var info = new ProgramInfo();
                        info.Name = name;
                        info.Version = sub.GetValue("DisplayVersion") as string ?? "";
                        info.InstallDate = sub.GetValue("InstallDate") as string ?? "";
                        info.UninstallString = uninstall;
                        object size = sub.GetValue("EstimatedSize");
                        if (size is int) info.SizeBytes = (long)(int)size * 1024;
                        programs.Add(info);
                    }
                }
            }
        }
    }
}

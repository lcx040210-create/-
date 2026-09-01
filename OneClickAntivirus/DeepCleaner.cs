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
    }
}

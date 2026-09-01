using System;
using System.Collections.Generic;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace OneClickAntivirus
{
    public class DeepCleanForm : Form
    {
        private TabControl tabs;
        private CheckedListBox lstDup;
        private CheckedListBox lstInst;
        private CheckedListBox lstProg;
        private Button btnScan;
        private Button btnClean;
        private Label lblStatus;

        private List<string> dupPaths = new List<string>();
        private List<string> instPaths = new List<string>();
        private List<ProgramInfo> progInfos = new List<ProgramInfo>();

        public DeepCleanForm()
        {
            Text = "深度清理";
            ClientSize = new Size(660, 470);
            StartPosition = FormStartPosition.CenterParent;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            BackColor = Color.White;

            tabs = new TabControl { Location = new Point(12, 12), Size = new Size(636, 370) };

            lstDup = MakeList();
            lstInst = MakeList();
            lstProg = MakeList();

            TabPage tp1 = new TabPage("重复文件");
            tp1.Controls.Add(lstDup);
            tabs.TabPages.Add(tp1);

            TabPage tp2 = new TabPage("安装包");
            tp2.Controls.Add(lstInst);
            tabs.TabPages.Add(tp2);

            TabPage tp3 = new TabPage("程序");
            tp3.Controls.Add(lstProg);
            tabs.TabPages.Add(tp3);

            btnScan = MakeButton("🔍 开始深度扫描", Color.FromArgb(59, 130, 246), new Point(12, 392), 200);
            btnScan.Click += btnScan_Click;

            btnClean = MakeButton("🗑️ 清理选中项", Color.FromArgb(234, 88, 12), new Point(224, 392), 200);
            btnClean.Click += btnClean_Click;
            btnClean.Enabled = false;

            lblStatus = new Label
            {
                Text = "点击「开始深度扫描」",
                AutoSize = true,
                Font = new Font("Microsoft YaHei UI", 9f),
                ForeColor = Color.Gray,
                Location = new Point(436, 405)
            };

            Controls.Add(tabs);
            Controls.Add(btnScan);
            Controls.Add(btnClean);
            Controls.Add(lblStatus);
        }

        private CheckedListBox MakeList()
        {
            return new CheckedListBox
            {
                Dock = DockStyle.Fill,
                Font = new Font("Microsoft YaHei UI", 9f),
                HorizontalScrollbar = true,
                CheckOnClick = true
            };
        }

        private Button MakeButton(string text, Color color, Point loc, int width)
        {
            Button b = new Button
            {
                Text = text,
                Font = new Font("Microsoft YaHei UI", 10f, FontStyle.Bold),
                Size = new Size(width, 40),
                Location = loc,
                FlatStyle = FlatStyle.Flat,
                BackColor = color,
                ForeColor = Color.White,
                Cursor = Cursors.Hand
            };
            b.FlatAppearance.BorderSize = 0;
            return b;
        }

        private void SetStatus(string text)
        {
            if (InvokeRequired)
            {
                BeginInvoke((Action)(() => SetStatus(text)));
                return;
            }
            lblStatus.Text = text;
        }

        private async void btnScan_Click(object sender, EventArgs e)
        {
            btnScan.Enabled = false;
            lstDup.Items.Clear(); dupPaths.Clear();
            lstInst.Items.Clear(); instPaths.Clear();
            lstProg.Items.Clear(); progInfos.Clear();

            try
            {
                SetStatus("正在读取已安装程序…");
                progInfos = await Task.Run(() => DeepCleaner.ListPrograms());
                foreach (var p in progInfos)
                    lstProg.Items.Add(p.Name + "  (" + DiskCleaner.FormatBytes(p.SizeBytes) + ", " + DeepCleaner.FormatInstallDate(p.InstallDate) + ")");

                SetStatus("正在全盘查找安装包…");
                var installers = await Task.Run(() => DeepCleaner.FindInstallers(s => SetStatus(s)));
                foreach (var i in installers)
                {
                    lstInst.Items.Add(i.Path + "  (" + DiskCleaner.FormatBytes(i.Size) + ")");
                    instPaths.Add(i.Path);
                }

                SetStatus("正在检测重复文件…");
                var groups = await Task.Run(() => DeepCleaner.FindDuplicates(s => SetStatus(s)));
                int gid = 0;
                foreach (var g in groups)
                {
                    gid++;
                    for (int i = 0; i < g.Files.Count; i++)
                    {
                        string f = g.Files[i];
                        lstDup.Items.Add("组" + gid + " [" + (i + 1) + "/" + g.Files.Count + "] " + f + "  (" + DiskCleaner.FormatBytes(g.FileSize) + ")");
                        dupPaths.Add(f);
                        // 默认保留每组的第一个,勾选其余副本
                        lstDup.SetItemChecked(lstDup.Items.Count - 1, i > 0);
                    }
                }

                SetStatus("扫描完成:重复 " + groups.Count + " 组 · 安装包 " + installers.Count + " 个 · 程序 " + progInfos.Count + " 个");
                btnClean.Enabled = true;
            }
            catch (Exception ex)
            {
                SetStatus("扫描出错:" + ex.Message);
            }
            finally
            {
                btnScan.Enabled = true;
            }
        }

        private async void btnClean_Click(object sender, EventArgs e)
        {
            btnClean.Enabled = false;
            SetStatus("正在清理…");

            var dupToDelete = new List<string>();
            for (int i = 0; i < lstDup.Items.Count; i++)
                if (lstDup.GetItemChecked(i)) dupToDelete.Add(dupPaths[i]);

            var instToDelete = new List<string>();
            for (int i = 0; i < lstInst.Items.Count; i++)
                if (lstInst.GetItemChecked(i)) instToDelete.Add(instPaths[i]);

            var progToUninstall = new List<ProgramInfo>();
            for (int i = 0; i < lstProg.Items.Count; i++)
                if (lstProg.GetItemChecked(i)) progToUninstall.Add(progInfos[i]);

            await Task.Run(() =>
            {
                long freed = 0;
                foreach (string f in dupToDelete)
                {
                    try { freed += new System.IO.FileInfo(f).Length; System.IO.File.Delete(f); } catch { }
                }
                foreach (string f in instToDelete)
                {
                    try { freed += new System.IO.FileInfo(f).Length; System.IO.File.Delete(f); } catch { }
                }
                foreach (var p in progToUninstall)
                {
                    try { LaunchUninstaller(p.UninstallString); } catch { }
                }
                return freed;
            }).ContinueWith(t =>
            {
                long freed = t.IsFaulted ? 0 : t.Result;
                SetStatus("完成:释放 " + DiskCleaner.FormatBytes(freed) + ",已启动卸载 " + progToUninstall.Count + " 个程序");
                btnClean.Enabled = true;
            }, TaskScheduler.FromCurrentSynchronizationContext());
        }

        private static void LaunchUninstaller(string uninstallString)
        {
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c " + uninstallString,
                    UseShellExecute = false,
                    CreateNoWindow = true
                });
            }
            catch { }
        }
    }
}

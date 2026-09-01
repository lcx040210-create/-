using System;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace OneClickAntivirus
{
    public class MainForm : Form
    {
        private Button btnScan;
        private Button btnClean;
        private ProgressBar progressBar;
        private Label lblStatus;
        private ListBox lstResults;
        private Label lblLastScan;
        private Timer heartbeatTimer;
        private DateTime scanStartTime;

        public MainForm()
        {
            Text = "一键杀毒 · 电脑清理";
            ClientSize = new Size(540, 500);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            BackColor = Color.White;

            Label lblTitle = new Label
            {
                Text = "🛡️ 一键杀毒 · 电脑清理",
                Font = new Font("Microsoft YaHei UI", 15f, FontStyle.Bold),
                ForeColor = Color.FromArgb(30, 41, 59),
                AutoSize = true,
                Location = new Point(20, 18)
            };

            Label lblSubtitle = new Label
            {
                Text = "极简 · 安全 · 一键搞定",
                Font = new Font("Microsoft YaHei UI", 9f),
                ForeColor = Color.Gray,
                AutoSize = true,
                Location = new Point(22, 48)
            };

            btnScan = MakeButton("🛡️ 一键全盘杀毒", Color.FromArgb(59, 130, 246), new Point(20, 80), 500);
            btnScan.Click += btnScan_Click;

            btnClean = MakeButton("🧹 一键清理磁盘", Color.FromArgb(34, 197, 94), new Point(20, 142), 500);
            btnClean.Click += btnClean_Click;

            progressBar = new ProgressBar
            {
                Style = ProgressBarStyle.Blocks,
                Size = new Size(500, 16),
                Location = new Point(20, 212)
            };

            lblStatus = new Label
            {
                Text = "选择上方操作开始",
                AutoSize = true,
                Font = new Font("Microsoft YaHei UI", 10f),
                ForeColor = Color.FromArgb(30, 41, 59),
                Location = new Point(20, 238)
            };

            lstResults = new ListBox
            {
                Size = new Size(500, 200),
                Location = new Point(20, 264),
                BorderStyle = BorderStyle.FixedSingle,
                HorizontalScrollbar = true,
                Font = new Font("Microsoft YaHei UI", 9f)
            };

            lblLastScan = new Label
            {
                Text = "上次扫描时间:—",
                AutoSize = true,
                Font = new Font("Microsoft YaHei UI", 9f),
                ForeColor = Color.Gray,
                Location = new Point(20, 472)
            };

            Controls.Add(lblTitle);
            Controls.Add(lblSubtitle);
            Controls.Add(btnScan);
            Controls.Add(btnClean);
            Controls.Add(progressBar);
            Controls.Add(lblStatus);
            Controls.Add(lstResults);
            Controls.Add(lblLastScan);
        }

        private Button MakeButton(string text, Color color, Point loc, int width)
        {
            Button b = new Button
            {
                Text = text,
                Font = new Font("Microsoft YaHei UI", 13f, FontStyle.Bold),
                Size = new Size(width, 54),
                Location = loc,
                FlatStyle = FlatStyle.Flat,
                BackColor = color,
                ForeColor = Color.White,
                Cursor = Cursors.Hand
            };
            b.FlatAppearance.BorderSize = 0;
            return b;
        }

        private void AppendLog(string text)
        {
            if (InvokeRequired)
            {
                BeginInvoke((Action)(() => AppendLog(text)));
                return;
            }
            lstResults.Items.Add(text);
            lstResults.TopIndex = lstResults.Items.Count - 1;
        }

        private void StartHeartbeat()
        {
            scanStartTime = DateTime.Now;
            heartbeatTimer = new Timer();
            heartbeatTimer.Interval = 1000;
            heartbeatTimer.Tick += (s, e) =>
            {
                int sec = (int)(DateTime.Now - scanStartTime).TotalSeconds;
                lblStatus.Text = "正在全盘扫描… 已运行 " + sec + " 秒";
            };
            heartbeatTimer.Start();
        }

        private void StopHeartbeat()
        {
            if (heartbeatTimer != null)
            {
                heartbeatTimer.Stop();
                heartbeatTimer.Dispose();
                heartbeatTimer = null;
            }
        }

        private async void btnScan_Click(object sender, EventArgs e)
        {
            btnScan.Enabled = false;
            btnClean.Enabled = false;
            progressBar.Style = ProgressBarStyle.Marquee;
            progressBar.MarqueeAnimationSpeed = 30;
            lstResults.Items.Clear();
            AppendLog("开始全盘扫描…");
            StartHeartbeat();

            try
            {
                ScanResult result = await Task.Run(() => DefenderScanner.RunFullScan(line => AppendLog("  " + line)));

                StopHeartbeat();
                progressBar.Style = ProgressBarStyle.Blocks;
                progressBar.Value = 100;
                lblStatus.Text = result.Message;

                foreach (ThreatInfo t in result.Threats)
                    lstResults.Items.Add(t.Name + " — " + t.Path + " (" + t.DetectedAt + ")");

                lblLastScan.Text = "上次扫描时间:" + DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            }
            catch (Exception ex)
            {
                StopHeartbeat();
                progressBar.Style = ProgressBarStyle.Blocks;
                progressBar.Value = 0;
                lblStatus.Text = "扫描出错:" + ex.Message;
            }
            finally
            {
                StopHeartbeat();
                btnScan.Enabled = true;
                btnClean.Enabled = true;
            }
        }

        private async void btnClean_Click(object sender, EventArgs e)
        {
            btnScan.Enabled = false;
            btnClean.Enabled = false;
            progressBar.Style = ProgressBarStyle.Marquee;
            progressBar.MarqueeAnimationSpeed = 30;
            lblStatus.Text = "正在清理磁盘…";
            lstResults.Items.Clear();

            try
            {
                long freed = await Task.Run(() => DiskCleaner.CleanAll(step => AppendLog(step)));

                progressBar.Style = ProgressBarStyle.Blocks;
                progressBar.Value = 100;
                lblStatus.Text = "✅ 清理完成,已释放 " + DiskCleaner.FormatBytes(freed);
                lstResults.Items.Add("已释放磁盘空间:" + DiskCleaner.FormatBytes(freed));
            }
            catch (Exception ex)
            {
                progressBar.Style = ProgressBarStyle.Blocks;
                progressBar.Value = 0;
                lblStatus.Text = "清理出错:" + ex.Message;
            }
            finally
            {
                btnScan.Enabled = true;
                btnClean.Enabled = true;
            }
        }
    }
}

# 流感的季节 · 流感观测站

一幅可以旋转、聆听、探索的时间图谱。纸张、植物形态与三维数据雕塑，将 2021–2025 年的教学模拟记录展开为季候花冠、年度山脊和观测星轨。

**[打开在线演示](https://yzc0219.github.io/annual-influenza-dashboard/)** · [完整技术说明](docs/TECHNICAL.md)

把上面的在线演示链接发给朋友即可，手机和电脑都可以直接打开，无需安装 Python 或数据库。GitHub 仓库地址用于查看、下载源码。

## 体验

- 三种原生 WebGL2 三维形态，支持拖拽旋转、缩放、点选年月、沉浸查看和保存图谱；图形能力不足时回退为 SVG。
- 月份与年份以淡出、换片、渐显衔接；支持时间轴播放，尊重系统“减少动态效果”设置。
- 手机采用单列阅读、独立触控布局和一键三维观测；沉浸横屏时图谱与控制区并列，单指旋转、双指缩放。
- 可选的季候环境音由本地 Web Audio 合成，默认关闭，点击“听见季候”开启。
- 年度、地区、年龄组筛选，月度对比、热力图、趋势推演、数据档案和报告导出。
- 全部前端库在仓库内，无 CDN；Flask 完整版支持 CSV 校验、预览、确认导入，不覆盖原数据库。

## 图表说明

| 图表 | 表达与轴 | 拖拽 / 触屏 |
| --- | --- | --- |
| 季候花冠 | 角度为月份，花瓣长度为 ILI%，颜色为年度 | 支持旋转、缩放、点选年月 |
| 年度山脊 | X 为月份、Z 为年度、Y 为 ILI% | 支持旋转、缩放、点选年月 |
| 观测星轨 | 节点沿年月顺序展开，高度为 ILI% | 支持旋转、缩放、点选年月 |
| 平面图谱 | SVG 季候花冠，相同数据语义 | 二维回退，支持选择，不支持三维旋转 |
| 地区年度矩阵 | X 为地区、Y 为年度、Z 为 ILI%（ECharts GL 坐标） | 支持拖拽旋转、缩放、点选地区 |
| 月度对比 | X 为月份、Y 为 ILI%，对照上一年度 | 二维图表，支持查看提示 |
| 月度热力图 | X 为月份、Y 为年度，颜色为 ILI% | 二维图表，支持查看提示 |
| 趋势推演 | X 为月份、Y 为 ILI%，显示留出验证与未来六个月 | 二维图表，支持查看提示 |

## 数据与在线版边界

所有公开数据均由仓库中的 [教学 SQL 初始化脚本](sql/init_influenza.sql) 生成，不代表真实疫情。地区和年龄指标使用既有系数估算；5% 观察线和统计预测仅用于教学，不作医学判断。

GitHub Pages 是只读静态演示：筛选、三维、音乐、预测和导出可用；CSV 导入需要本地运行 Flask。在线版的 25 种地区 / 年龄预测组合由与 Flask 相同的 Python 模型预计算，构建过程不会连接个人数据库，也不会发布用户上传的数据。

## 运行完整版

需要 Python 3.10+、MySQL 8+。先在 MySQL 执行 `sql/init_influenza.sql`，然后设置数据库连接并启动 Flask。Windows 示例（把目录改为你自己的位置）：

```powershell
cd D:\github\annual-influenza-dashboard
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:FLU_DB_HOST = '127.0.0.1'
$env:FLU_DB_PORT = '3306'
$env:FLU_DB_USER = 'root'
$env:FLU_DB_NAME = 'influenza_db'
$secureFluPassword = Read-Host '输入本机 MySQL 密码' -AsSecureString
$env:FLU_DB_PASSWORD = [System.Net.NetworkCredential]::new('', $secureFluPassword).Password
.\.venv\Scripts\python.exe app.py
```

打开 `http://127.0.0.1:5000/`。不要把本机密码提交到仓库。导入内容保存于被忽略的 `data/`；后端接口仍为 `/api/influenza`、`/api/datasets`、`/api/forecast` 与两阶段 CSV 导入接口。

## 构建和发布在线演示

```powershell
python scripts/build_demo.py
python -m http.server 8000 --directory _site
```

打开 `http://127.0.0.1:8000/` 预览。提交到 `main` 会运行 GitHub Actions：测试、从 SQL 构建 `_site`，再部署至 GitHub Pages。首次使用需将仓库 Settings → Pages → Source 设为 **GitHub Actions**。仓库根目录的 `index.html` 和 `demo/` 是生成的便携演示快照；修改后用 `python scripts/build_demo.py --output .` 更新它们。

## 检查

```powershell
python -m unittest discover -s tests -v
node tests/test_experience.cjs
node tests/test_specimen_gl.cjs
node tests/test_signal_worker.cjs
node tests/test_soundscape.cjs
```

界面另检查手机窄屏、竖屏与横屏沉浸布局。自动测试覆盖年份 / 月份动画中断、触摸旋转与双指缩放、图形恢复、默认静音、统计计算、数据校验及静态构建的相对路径。

第三方库的许可证随对应本地发行文件保留；其他说明见 [技术文档](docs/TECHNICAL.md)。

## CSV 一键排表

在“数据档案”页选择或拖入 CSV，即可生成独立表格。支持 UTF-8、GB18030/GBK 与带 BOM 的 UTF-16，自动识别逗号、分号、制表符，保留带引号的逗号、双引号和多行内容。默认首行为表头，可取消勾选以保留首行数据。

自动排版包括列宽估算、数字右对齐、前导零编号保留、长文字换行、隔行底色与固定表头。支持按列排序、全文搜索、25/50/100 条分页，以及下载当前全部匹配记录的独立 HTML 排版表格（不只当前页），可用浏览器打印为 PDF。

限制：单文件 2 MB、最多 20,000 条数据与 100 列。列数不齐时补空列，保留超出表头的列并提示。格式错误会显示原因。文件只在当前浏览器页面内处理，不发送到服务器，也不保存到本地存储；刷新即清除。该功能生成独立表格，不把任意 CSV 直接当作流感分析数据；Flask 的月度数据集导入仍保留。

验证：CSV 解析与导出回归测试；本机 Chrome 实测文件选择、搜索、数字排序、分页、HTML 文件下载、错误恢复、清除，检查 1440 / 768 / 390 像素截图，无页面横向溢出。应用内浏览器连接组件缺失，因此使用本机 Chrome 复验。

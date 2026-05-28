# EJU 志愿推荐

根据 **EJU（日本留学试验）分数**，在可达分数段内，综合 **学校声誉** 与 **毕业生就业率**，推荐 3–5 所日本大学学部方向。

> ⚠️ 当前内置为 **示例参考数据**，非各校官方最新募集要項。出愿前请务必以官网为准。

## 功能

- 支持 **理科**（数学コース2 + 物理/化学/生物）与 **文科**（日本与世界）两种路径
- 按分数匹配 **稳妥 / 匹配 / 冲刺** 档位
- 在同分数带内按 **声誉档位 + 就业率** 排序
- 同一所大学最多推荐一个学部，避免结果重复

> 说明：示例数据中，部分理学部按“物化生任意两科达标”，部分工学/理工类按“物理+化学必须达标”。你填的物化生组合会直接影响推荐结果。

## 本地预览

静态站点，无需构建。任选一种方式：

```bash
# Python 3
cd "EJU 分数报名"
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

或使用任意静态文件服务器。

## 部署到 GitHub Pages

1. 将本仓库推送到 GitHub（见下方）
2. 仓库 **Settings → Pages → Build and deployment**
   - Source: **GitHub Actions**
3. 推送 `main` 分支后，Actions 会自动部署
4. 访问 `https://<你的用户名>.github.io/<仓库名>/`

## 项目结构

```
├── index.html          # 页面
├── css/main.css
├── js/
│   ├── app.js          # 表单与展示
│   └── recommend.js    # 推荐算法
├── data/
│   ├── programs.json         # 学部推荐数据
│   ├── schools_catalog.json  # T2.docx 中的 63 校目录
│   └── crawl_results/        # 爬虫发现的募集页面
├── scripts/crawl/
│   ├── discover.py           # 扫描官网，发现 EJU/募集链接
│   └── domains.json
└── .github/workflows/
    ├── deploy.yml            # GitHub Pages 部署
    └── crawl.yml             # 定时/手动爬虫
```

## T2.docx 学校目录与爬虫

`T2.docx` 中 T2–T8 共 **63 所学校** 已整理到 `data/schools_catalog.json`。

本地试跑（例如先扫 8 校）：

```bash
python3 scripts/crawl/discover.py 8
```

全量扫描：

```bash
python3 scripts/crawl/discover.py
```

结果写入 `data/crawl_results/discovery_YYYYMMDD.json`。

> 当前爬虫处于 **第 1 阶段：发现链接**。下一步才是 PDF 下载、EJU 分数抽取、人工审核后写入 `programs.json`。

## 托管方案：只用 GitHub 够不够？

**MVP 阶段：GitHub 账号就够，不必额外买服务器。**

| 能力 | 用什么 | 说明 |
|------|--------|------|
| 前端网站 | GitHub Pages | 已有 `deploy.yml` |
| 定时爬虫 | GitHub Actions | 已有 `crawl.yml`，可手动或每月自动跑 |
| 数据存储 | 仓库里的 JSON | `programs.json`、`crawl_results/` |

**什么时候才需要其他服务？**

- 学校数量很大、爬虫跑很久 → 可考虑 VPS / Railway（可选）
- 需要数据库、用户登录、审核后台 → Supabase 等（可选）
- 要用 LLM 批量解析 PDF → 需要 API Key（OpenAI 等），可放在 GitHub Secrets

**结论：你现在有 GitHub 账号，就可以完成「网站 + 定期扫描 + 数据入库（JSON）」的闭环。**


编辑 `data/programs.json`，每条记录字段说明：

| 字段 | 说明 |
|------|------|
| `track` | `science` 或 `humanities` |
| `mathCourse` | 1 或 2 |
| `requiredSubjects` | 参与比对的科目 |
| `minScores` / `pastMin` / `pastAvg` | 官方或往年参考分 |
| `reputationTier` | 1–5，声誉档位 |
| `employmentRate` | 就业率（%） |

## 免责声明

本工具仅供学习与个人规划参考，不构成任何录取或出愿承诺。使用者须自行核对各校最新要項。

## License

MIT

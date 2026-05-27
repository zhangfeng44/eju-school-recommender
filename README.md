# EJU 志愿推荐

根据 **EJU（日本留学试验）分数**，在可达分数段内，综合 **学校声誉** 与 **毕业生就业率**，推荐 3–5 所日本大学学部方向。

> ⚠️ 当前内置为 **示例参考数据**，非各校官方最新募集要項。出愿前请务必以官网为准。

## 功能

- 支持 **理科**（数学コース2 + 理科）与 **文科**（日本与世界）两种路径
- 按分数匹配 **稳妥 / 匹配 / 冲刺** 档位
- 在同分数带内按 **声誉档位 + 就业率** 排序
- 同一所大学最多推荐一个学部，避免结果重复

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
│   └── programs.json   # 学校/学部数据（可扩展）
└── .github/workflows/deploy.yml
```

## 扩展数据

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

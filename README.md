<div align="center">
  <img src="public/logo.png" alt="Project Logo" width="120">
</div>

# LunaTV Proxy Edition

面向自建用户的 MoonTV/LunaTV 扩展版本。除了继承原有的多源聚合播放体验，本项目额外实现：

- **全量流量代理**：所有接口、m3u8、key、ts 片段都会先进入你的服务器，再转发到上游，终端设备只会看到你自己的域名/IP。
- **默认订阅即插即用**：内置 [vodtv/api](https://github.com/vodtv/api) 的 Base58 源（精简无 18+），首次启动自动导入，也支持覆盖/热更新。
- **Docker 一键部署**：镜像里自带健康检查、manifest 生成脚本，配合 Kvrocks/Redis 即可上线。

> ⚠️ 声明：本项目仅供个人学习、研究。请勿在公共平台宣传，勿用于任何商业或盈利活动，由此产生的法律风险与作者无关。

---

## 目录

1. [核心特性](#核心特性)
2. [架构一览](#架构一览)
3. [快速开始](#快速开始)
4. [环境变量](#环境变量)
5. [配置与订阅](#配置与订阅)
6. [开发指南](#开发指南)
7. [常见问题](#常见问题)
8. [许可证](#许可证)

---

## 核心特性

| 功能点 | 说明 |
| ------ | ---- |
| 全量代理 | `/api/proxy` 会解析 m3u8、重写 EXT-X-KEY/segment 地址，所有播放流量都走你自己的服务器，便于加速、审计或隐藏来源。 |
| 默认源 | `config/default-config.base58` 中嵌入 VodTV 精简源，第一次登录后台即可看到完整站点列表，也可通过后台覆盖/自定义。 |
| 多端同步 | 兼容 Kvrocks/Redis/Upstash，浏览记录、收藏、搜索历史都可共享。 |
| PWA 与响应式 | 内置移动端导航、桌面侧栏和 PWA Manifest，适配手机、平板、TV 浏览器。 |
| Docker 友好 | 官方 Dockerfile 使用 `next build` 产出的 standalone 目录，部署体积更小，支持健康检查与定时任务。 |

---

## 架构一览

```
Browser ⇄ LunaTV Proxy (Next.js)
                     ├─ Kvrocks/Redis (播放记录/配置)
                     ├─ /api/proxy (所有 m3u8/ts/key 流量)
                     └─ Vod/影视资源站 (被 LunaTV 代理访问)
```

* **界面层**：Next.js App Router + Tailwind CSS + ArtPlayer。
* **存储层**：Kvrocks（默认推荐），也可切换 Redis / Upstash。
* **采集层**：遵循苹果 CMS V10 接口，支持多源聚合搜索。
* **代理层**：`src/lib/proxy-utils.ts` + `src/app/api/proxy/route.ts` 负责把所有播放地址包装为 `/api/proxy`。

---

## 快速开始

### 1. 准备 Kvrocks/Redis

```bash
docker network create lunatv-proxy-net

docker run -d \
  --name lunatv-proxy-kvrocks \
  --network lunatv-proxy-net \
  apache/kvrocks
```

### 2. 启动 LunaTV Proxy

```bash
docker run -d \
  --name lunatv-proxy \
  --network lunatv-proxy-net \
  --dns=223.5.5.5 --dns=114.114.114.114 \
  -p 3100:3000 \
  -e USERNAME=admin \
  -e PASSWORD=strong_password \
  -e NEXT_PUBLIC_STORAGE_TYPE=kvrocks \
  -e KVROCKS_URL=redis://lunatv-proxy-kvrocks:6666 \
  -e DEFAULT_CONFIG_FILE=/app/config/default-config.base58 \
  lunatv-proxy:latest
```

首启后访问 `http://服务器IP:3100/`，用 `USERNAME/PASSWORD` 登录即可看到后台与影视源。

> 说明：`--dns=223.5.5.5` 等参数可以绕过部分 DNSSEC 故障域名（例如某些 CDN）。如有需要可改成你信任的解析器。

---

## 环境变量

| 变量 | 说明 | 默认值 |
| ---- | ---- | ------ |
| `USERNAME` / `PASSWORD` | 后台管理员账户/密码 | 必填 |
| `NEXT_PUBLIC_STORAGE_TYPE` | `kvrocks` / `redis` / `upstash` | - |
| `KVROCKS_URL` / `REDIS_URL` | 数据库连接串 | - |
| `UPSTASH_URL` / `UPSTASH_TOKEN` | Upstash HTTPS Endpoint + Token | - |
| `SITE_BASE` | 对外域名（用于分享链接） | 空 |
| `NEXT_PUBLIC_SITE_NAME` | 站点名称 | MoonTV |
| `ANNOUNCEMENT` | 首页公告 | 默认免责声明 |
| `DEFAULT_CONFIG_FILE` | 当数据库为空时自动导入的配置文件（JSON 或 Base58） | `config/default-config.base58` |
| `NEXT_PUBLIC_SEARCH_MAX_PAGE` | 每个源搜索最多拉取的页数 | 5 |
| `NEXT_PUBLIC_DOUBAN_*` | 豆瓣数据/图片代理设置 | 见 `.env.example` |
| `NEXT_PUBLIC_FLUID_SEARCH` | 是否启用流式搜索结果 | true |

更多变量可参考 `README` 中的表格或 `.env.local` 示例。

---

## 配置与订阅

1. **默认源**  
   - 位于 `config/default-config.base58`（精简版，自动导入）。  
   - 需要 18+ 或自定义订阅时，直接替换该文件或在后台粘贴新的 JSON 即可。  

2. **后台操作**  
   - 进入 `/admin → 配置文件`，支持拉取订阅、粘贴 JSON、设置自动更新。  
   - 配置保存后会触发 `refineConfig`，自动合并环境变量、ConfigFile 与数据库。

3. **全量代理说明**  
   - `src/lib/downstream.ts` 在解析 `vod_play_url` 时会调用 `wrapEpisodesWithProxy`。  
   - `/api/proxy` 会判断 `type=manifest` 或 `segment`，对 m3u8 做二次改写，并透传 Range、Referer、Origin。  
   - 如果你想进一步限制上游域名，可在 `src/app/api/proxy/route.ts` 的 `ALLOWED_PROTOCOLS`/白名单里自行扩展。

---

## 开发指南

```bash
git clone https://github.com/616310/LunaTV-proxy.git
cd LunaTV-proxy
pnpm install
pnpm dev --hostname :: --port 3000
```

本地开发通常使用 Redis/Kvrocks：  
```bash
KVROCKS_URL=redis://127.0.0.1:6666
NEXT_PUBLIC_STORAGE_TYPE=kvrocks
USERNAME=admin
PASSWORD=admin
```

构建与运行：
```bash
pnpm build
pnpm start
# 或 docker build -t lunatv-proxy:latest .
```


## 发布预编译 Docker 包

硬件较好的机器可以先完成构建，再把打包好的镜像上传到 GitHub Release，弱机只需下载运行：

1. 构建镜像：
   ```bash
   docker build -t lunatv-proxy:latest .
   ```
2. 使用脚本导出 gzip 包（默认输出到 `dist/lunatv-proxy-prebuilt.tar.gz`）：
   ```bash
   ./scripts/export-docker-image.sh
   # 或自定义输出路径
   ./scripts/export-docker-image.sh lunatv-proxy:latest dist/lunatv-proxy-v0.1.0.tar.gz
   ```
3. 把生成的 `.tar.gz` 上传到 GitHub Releases，供客户下载。

客户端机器无需 `pnpm build`，只需从本仓库 [Releases](https://github.com/616310/LunaTV-proxy/releases) 下载 `.tar.gz` 并加载镜像：

```bash
wget https://github.com/616310/LunaTV-proxy/releases/download/<tag>/lunatv-proxy-prebuilt.tar.gz
docker load -i lunatv-proxy-prebuilt.tar.gz
# 然后复用上文的 docker run 命令
docker run -d ... lunatv-proxy:latest
```

---

## 常见问题

1. **播放提示“检查失败”？**  
   - 检查 `/api/proxy` 日志是否是 DNS 错误或 403。某些源会限制 Referer，需要在代理层补齐 header。  
   - 确认数据库里确实保存了配置（管理员后台 → 配置文件）。

2. **如何替换默认订阅？**  
   - 将新的 Base58 链接保存为 `config/default-config.base58`。  
   - 或设置 `DEFAULT_CONFIG_FILE=/path/to/xxx.txt`，然后在后台点击“恢复默认配置”。

3. **如何只代理部分源？**  
   - 修改 `wrapEpisodesWithProxy`，根据 `source` 条件决定是否添加代理前缀即可。

---

## 许可证

[MIT](LICENSE)

本仓库基于 MoonTechLab/LunaTV 的开源代码，感谢原作者及所有贡献者对社区的支持。欢迎提交 Issue / PR，一起完善这个代理版。***

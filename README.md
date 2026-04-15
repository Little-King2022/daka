# 打卡小工具

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Little-King2022/daka)

一个基于 Vue 3 + Vite 的前端打卡工具，无需独立后端，直接部署到 Vercel 即可使用。

## 功能特性

- 自动打卡，支持定时任务
- 支持多语言（中文/英文）
- 支持 Supabase 数据库集成，遥测打卡状态
- 一键部署到 Vercel

---

## 部署到 Vercel

### 方式一：一键部署（推荐）

1. 点击上方 **Deploy with Vercel** 按钮。
2. 登录或注册 Vercel 账号。
3. Vercel 会自动 Fork 本仓库到你的 GitHub 账号，并进入部署向导。
4. 在 **Configure Project** 页面按需填写环境变量（见下方[环境变量](#环境变量)说明），也可以跳过，部署后再在项目设置里添加。
5. 点击 **Deploy**，等待构建完成（约 1 分钟）。
6. 部署成功后，Vercel 会分配一个 `*.vercel.app` 域名，直接访问即可使用。

### 方式二：手动导入已有仓库

1. 先将本仓库 **Fork** 到你自己的 GitHub 账号。
2. 打开 [vercel.com/new](https://vercel.com/new)，选择 **Import Git Repository**，授权并选择刚刚 Fork 的仓库。
3. **Framework Preset** 选择 `Vite`（Vercel 通常会自动识别）。
4. **Build & Output Settings** 保持默认即可：
   - Build Command：`vite build`
   - Output Directory：`dist`
   - Install Command：`npm install`
5. 展开 **Environment Variables**，按需添加环境变量（见下方说明）。
6. 点击 **Deploy**，等待构建完成。

### 部署后配置环境变量

如果部署时未填写环境变量，或后续需要修改，可在 Vercel 控制台操作：

1. 进入你的 Vercel 项目 → **Settings** → **Environment Variables**。
2. 添加所需变量，保存后点击 **Redeploy** 使配置生效。

---

## 环境变量

项目根目录的 `vercel.json` 已为以下变量设置了默认值，无需额外配置即可正常运行。如需开启相关功能，在 Vercel 控制台覆盖对应变量值即可。

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `VITE_ENABLE_SUPABASE_LOG` | `false` | 是否启用 Supabase 日志记录。设为 `true` 时，打卡、登录等操作会写入 Supabase 数据库 |
| `VITE_ENABLE_TIME_RESTRICTION` | `false` | 是否启用打卡时间限制。设为 `true` 时，凌晨 02:00 – 08:30 期间禁止打卡 |
| `VITE_SUPABASE_KEY` | —      | Supabase 匿名密钥（启用 Supabase 日志记录时必填） |

> **提示**：`vercel.json` 中的 `env` 字段为构建时默认值，Vercel 控制台中手动设置的同名变量优先级更高，会覆盖默认值。

---

## Supabase 集成

如需启用数据库记录功能，请参考 [README_SUPABASE.md](./README_SUPABASE.md)。

---

## 本地开发

```sh
# 安装依赖
npm install

# 开发模式
npm run dev

# 生产构建
npm run build
```

本地开发时，在项目根目录新建 `.env.local` 文件，按需填写环境变量：

```
VITE_ENABLE_SUPABASE_LOG=false
VITE_ENABLE_TIME_RESTRICTION=false
VITE_SUPABASE_KEY=your-supabase-anon-key
```

---

## 技术栈

- [Vue 3](https://vuejs.org/)
- [Vite](https://vite.dev/)
- [TDesign Mobile Vue](https://tdesign.tencent.com/mobile-vue/)
- [Supabase](https://supabase.com/)（可选）

## License

MIT

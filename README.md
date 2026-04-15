# 打卡小工具 (Daka)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Little-King2022/daka)
[![GitHub](https://img.shields.io/badge/Github-%E9%A1%B9%E7%9B%AE%E5%9C%B0%E5%9D%80-blue)](https://github.com/Little-King2022/daka)

一个基于 Vue 3 + Vite 的前端打卡工具，无需独立后端，直接部署到 Vercel 即可使用。

## 功能特性

- 自动打卡，支持定时任务
- 支持多语言（中文/英文）
- 支持 Supabase 数据库集成，记录打卡状态
- 一键部署到 Vercel

## 快速开始

### 一键部署到 Vercel

点击上方 **Deploy with Vercel** 按钮，按照引导完成部署。

### 本地开发

```sh
# 安装依赖
npm install

# 开发模式
npm run dev

# 生产构建
npm run build
```

## 环境变量

| 变量名 | 说明 | 是否必须 |
|--------|------|----------|
| `VITE_SUPABASE_KEY` | Supabase 匿名密钥，用于记录打卡数据 | 否 |

## Supabase 集成

如需启用数据库记录功能，请参考 [README_SUPABASE.md](./README_SUPABASE.md)。

## 技术栈

- [Vue 3](https://vuejs.org/)
- [Vite](https://vite.dev/)
- [TDesign Mobile Vue](https://tdesign.tencent.com/mobile-vue/)
- [Supabase](https://supabase.com/)（可选）

## License

MIT

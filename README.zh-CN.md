# 本地网盘

[English](./README.md) | 简体中文

一个轻量级本地网盘 Web 应用，使用原生 Node.js、HTML、CSS 和 JavaScript 构建。支持空间隔离、大文件上传、上传进度、文件列表、下载和删除。

本项目运行时不依赖任何 npm 第三方包。

## 功能特性

- 支持创建多个存储空间，例如 `用户A` 和 `用户B`
- 文件会上传到当前选中的空间
- 不同空间的文件相互隔离，保存在 `uploads/<空间名>` 下
- 大文件上传采用流式写入，服务端边接收边落盘
- 浏览器展示上传进度
- 展示文件名、大小和修改时间
- 支持下载和删除文件
- 支持本机访问，也支持同一局域网内其他设备访问

## 技术栈

- Node.js HTTP 服务
- 原生 JavaScript 前端
- HTML 和 CSS
- 基于文件系统的本地存储

## 环境要求

- Node.js 18 或更高版本
- Windows、macOS 或 Linux

## 快速开始

```bash
npm start
```

打开：

```text
http://127.0.0.1:3107/
```

服务默认监听 `0.0.0.0`，所以同一局域网内的其他设备也可以通过这台电脑的局域网 IP 访问：

```text
http://<你的局域网IP>:3107/
```

示例：

```text
http://192.168.0.102:3107/
```

## 配置

可以通过环境变量配置监听地址和端口：

```bash
HOST=0.0.0.0 PORT=3107 node server.js
```

Windows PowerShell：

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "3107"
npm start
```

## 存储结构

上传的文件会保存在 `uploads` 目录：

```text
uploads/
  默认空间/
    example.mp4
  用户A/
    report.pdf
  用户B/
    photo.png
```

每个空间对应一个独立目录。上传到某个空间的文件，不会显示在其他空间里。

如果同名文件已经存在，服务端会自动追加后缀，避免覆盖：

```text
video.mp4
video-1.mp4
video-2.mp4
```

## 项目结构

```text
.
|-- package.json
|-- README.md
|-- README.zh-CN.md
|-- server.js
|-- public/
|   |-- app.js
|   |-- index.html
|   `-- styles.css
`-- uploads/
```

## API 概览

获取空间列表：

```http
GET /api/spaces
```

创建空间：

```http
POST /api/spaces
Content-Type: application/json

{
  "name": "用户A"
}
```

获取某个空间的文件列表：

```http
GET /api/files?space=%E7%94%A8%E6%88%B7A
```

上传文件：

```http
POST /api/upload?space=%E7%94%A8%E6%88%B7A
x-file-name: video.mp4
Content-Type: video/mp4
```

下载文件：

```http
GET /files?space=%E7%94%A8%E6%88%B7A&name=video.mp4
```

删除文件：

```http
DELETE /api/files?space=%E7%94%A8%E6%88%B7A&name=video.mp4
```

## 局域网访问说明

如果 `http://127.0.0.1:3107/` 可以访问，但 `http://<你的局域网IP>:3107/` 访问不了：

- 确认另一台设备和本机在同一个网络下
- 使用真实局域网 IP，不要使用虚拟网卡 IP
- 允许 Node.js 或 TCP 端口 `3107` 通过防火墙
- 避免使用会阻止设备互访的访客 Wi-Fi

Windows 下可以通过 `ipconfig` 查看局域网 IP。通常它在以太网或 Wi-Fi 适配器下，格式类似 `192.168.x.x`。

## 安全说明

这是一个本地局域网文件共享应用，不是生产级云存储服务。

当前尚未包含：

- 用户登录
- 密码保护
- 权限管理
- HTTPS
- 文件类型限制
- 病毒扫描

请只在可信网络内运行。不要在没有认证和传输加密的情况下直接暴露到公网。

## 开发

检查 JavaScript 语法：

```bash
node --check server.js
node --check public/app.js
```

启动应用：

```bash
npm start
```

## 许可证

MIT

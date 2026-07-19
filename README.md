# Dev Toolbox

基于 Node.js、npm、Vue 3 和 TypeScript 的浏览器端开发工具箱。转换和生成操作均在本地浏览器中完成。

## 启动

```bash
npm install
npm run dev
```

默认地址：<http://localhost:5173>

## Docker Compose（OrbStack）

```bash
docker compose up -d
```

Compose 不映射宿主机端口，项目目录挂载到容器的 `/workspace`，容器内 Vite 监听 `0.0.0.0:80`。OrbStack 默认访问地址：<http://web.dev-tool.orb.local>。

## 离线参考文档

Redis、PHP 和 Laravel 参考文档通过 `public/offline-docs/current` 在项目内读取，不会跳转到外部网站。内容范围为：

- Redis：实际命令、参数、语法、示例、兼容性和返回值
- PHP：语言语法、类型、函数、类和方法说明
- Laravel：包含命令、方法、语法、代码或参考表格的章节及其直接说明

需要更新官方内容时执行：

```bash
npm run docs:sync
```

同步默认依次使用 `http://127.0.0.1:7892` 和 `socks5h://127.0.0.1:7891`，可通过 `DOCS_PROXY` 覆盖。下载缓存位于 `.cache/offline-docs`，活动文档版本位于 `.cache/offline-docs-releases`；同步完成后通过相对软链接一次切换，普通启动不会访问网络或重复下载。

## 验证

```bash
npm test
npm run build
```

## 工具

- 生成器：UUID、ULID、RSA 密钥对、MAC 地址、IPv6 ULA
- 编码与解析：Hash、Base32/Base58、Base64 字符串/文件、ASCII 二进制、Unicode、URL 编解码、JWT、X.509 证书解析与密钥验证
- 数据格式：JSON、YAML、TOML、XML、PHP 数组、CSV 的转换、格式化、压缩和差异比较
- 网络工具：URL 分析、IPv4 子网、IPv4 地址转换、IPv4 范围扩展
- 开发辅助：SQL 格式化、Docker Run/Compose 双向转换、cURL 转 Fetch、Regex Tester
- 文本与数值：日期时间、进制、罗马数字、字符串打乱、文本比较、文本统计

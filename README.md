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

## GitHub Pages

推送到 `master` 后，GitHub Actions 会自动执行测试、按仓库子路径构建并部署站点：

<https://yunlingdie.github.io/dev-tool/>

仓库首次部署前，需要在 GitHub 的 `Settings > Pages` 中将 `Source` 设置为 `GitHub Actions`。

## 验证

```bash
npm test
npm run build
```

## 工具

- 生成器：UUID、ULID、RSA 密钥对、MAC 地址、IPv6 ULA
- 编码与解析：Hash、Base32/Base58、Base64 字符串/文件、音频解析与波形、ASCII 二进制、Unicode、URL 编解码、JWT、X.509 证书解析与密钥验证
- 数据格式：JSON、YAML、TOML、XML、PHP 数组、CSV 的转换、格式化、压缩和差异比较
- 网络工具：URL 分析、IPv4 子网、IPv4 地址转换
- 开发辅助：SQL 格式化、Docker Run/Compose 双向转换、cURL 转 Fetch、Regex Tester
- 文本与数值：日期时间、进制、罗马数字、字符串打乱、文本比较、文本统计

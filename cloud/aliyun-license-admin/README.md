# 数智学工独立授权管理后台

独立 FC Node.js 20 管理后台，复用 `shuzhi-license` Tablestore 实例。浏览器只接收短期会话与 CSRF 令牌，不接收阿里云 AccessKey、激活码哈希密钥或签名私钥。

## 功能

- 管理员账号密码登录（失败限流、短期会话、CSRF 防护）
- 批量生成激活码，使用独立 AES-256-GCM 密钥加密保存；登录后可显示、隐藏、复制并下载 CSV
- 独立记录客户姓名、小红书 ID、微信名或微信号，支持查询和编辑
- 授权查询（支持按激活码精确查找）、编辑、停用、恢复、永久删除
- 查看和解除设备绑定
- 元数据 CSV 导出
- 登录及敏感操作审计（包括查看激活码和删除授权）

升级前由旧接口生成的授权只保存了不可逆哈希，无法恢复原激活码。部署本版本时必须通过 FC 维护指令一次性强制停用全部此类记录；后台会显示“旧接口生成 · 明文不可恢复”，并禁止恢复启用。升级后新生成的授权会记录生成渠道、管理员、来源 IP 与请求编号，且支持再次查看。激活码不会以明文写入 Tablestore，列表接口也不会批量返回明文。

## 部署顺序

1. `npm install && npm test`
2. `powershell -ExecutionPolicy Bypass -File .\configure-admin.ps1`
3. 临时配置 Serverless Devs 凭据别名 `shuzhi-xuegong-deploy`
4. `node .\provision-admin-ram.cjs cn-hangzhou shuzhi-license`（会将最小权限策略更新为 `GetRange/PutRow/UpdateRow/DeleteRow`）
5. `node .\init-admin-table.js https://shuzhi-license.cn-hangzhou.ots.aliyuncs.com shuzhi-license`
6. 使用上一步角色 ARN 运行 `deploy.ps1`
7. 通过 FC 直接调用 `inspect-unrecoverable` 预检，再调用 `revoke-unrecoverable` 强制停用所有历史不可恢复授权；重复预检必须为 `active: 0`
8. 云端验收后删除临时 RAM 用户与本机凭据别名

`admin-secrets.json` 和原授权服务的 `deployment-secrets.json` 均不得上传、公开或发送到聊天中。

# 数智学工授权服务（阿里云 FC + Tablestore）

该目录是独立授权服务。它只保存激活码的 HMAC-SHA256 哈希、设备指纹哈希、设备显示名称和验证时间，不接收任何学生业务数据。

核心规则：一个授权记录默认最多 5 个设备槽位；设备增删在同一 Tablestore 行内通过 `revision` 条件更新完成，避免并发激活突破上限。FC 使用 RAM 角色访问 Tablestore，不在代码中保存阿里云 AccessKey。

环境变量：

- `TABLESTORE_ENDPOINT`、`TABLESTORE_INSTANCE`、`TABLESTORE_LICENSE_TABLE`
- `LICENSE_CODE_PEPPER`（至少 32 字节随机值）
- `LICENSE_PRIVATE_KEY`（Ed25519 PKCS#8 PEM，可用 `\\n` 表示换行）
- `LICENSE_PRODUCT=shuzhi-xuegong`
- `LICENSE_VERIFY_HOURS=72`、`LICENSE_OFFLINE_DAYS=180`

正式部署后，仅公开 HTTP 触发器 URL。旧版创建接口 `POST /v1/admin/licenses` 已永久停用并固定返回 HTTP 410，不再接受任何管理密钥。激活码只能通过独立授权管理平台生成；激活、验证、解除激活分别为 `/v1/licenses/activate`、`/verify`、`/deactivate`。

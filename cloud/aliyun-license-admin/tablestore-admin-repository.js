"use strict";

function promiseCall(client, method, params) {
  return new Promise((resolve, reject) => client[method](params, (error, data) => error ? reject(error) : resolve(data)));
}

function columnMap(row) {
  const result = {};
  if (!row) return result;
  const columns = row.attributes || row.attributeColumns || row.attribute_columns || [];
  for (const item of columns) {
    if (Array.isArray(item)) result[item[0]] = item[1];
    else if (item && item.columnName !== undefined) result[item.columnName] = item.columnValue;
    else if (item && item.name !== undefined) result[item.name] = item.value;
    else if (item && typeof item === "object") Object.assign(result, item);
  }
  return result;
}

function licenseColumns(record) {
  const activeDevices = (Array.isArray(record.devices) ? record.devices : []).filter(Boolean).length;
  return [
    { record_json: JSON.stringify(record) },
    { revision: String(record.revision) },
    { license_id: record.id },
    { status: record.status },
    { customer: record.customer || "" },
    { customer_name: record.customerName || record.customer || "" },
    { customer_xhs_id: record.customerXhsId || "" },
    { customer_wechat: record.customerWechat || "" },
    { max_devices: String(record.maxDevices || 5) },
    { active_devices: String(activeDevices) },
    { created_at: String(record.createdAt || 0) },
    { expires_at: String(record.expiresAt || 0) },
    { updated_at: String(record.updatedAt || 0) }
  ];
}

class TablestoreAdminRepository {
  constructor(TableStore, client, tableName) {
    this.TableStore = TableStore;
    this.client = client;
    this.tableName = tableName || "shuzhi_licenses";
  }

  async list() {
    const records = [];
    let start = [{ license_hash: this.TableStore.INF_MIN }];
    const end = [{ license_hash: this.TableStore.INF_MAX }];
    do {
      const data = await promiseCall(this.client, "getRange", {
        tableName: this.tableName,
        direction: this.TableStore.Direction.FORWARD,
        inclusiveStartPrimaryKey: start,
        exclusiveEndPrimaryKey: end,
        maxVersions: 1,
        limit: 200
      });
      for (const row of data.rows || []) {
        const columns = columnMap(row);
        if (!columns.record_json) continue;
        try { records.push(JSON.parse(String(columns.record_json))); } catch (_error) {}
      }
      if (!data.nextStartPrimaryKey) break;
      start = [{ license_hash: data.nextStartPrimaryKey[0].value }];
    } while (records.length < 20000);
    return records;
  }

  async getById(id) {
    const records = await this.list();
    return records.find((item) => item && item.id === id) || null;
  }

  async create(record) {
    const params = {
      tableName: this.tableName,
      condition: new this.TableStore.Condition(this.TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
      primaryKey: [{ license_hash: record.licenseHash }],
      attributeColumns: licenseColumns(record)
    };
    try { await promiseCall(this.client, "putRow", params); return true; }
    catch (error) { if (/condition|exist/i.test(String(error.code || error.message))) return false; throw error; }
  }

  async compareAndSwap(current, updated) {
    const condition = new this.TableStore.SingleColumnCondition("revision", String(current.revision), this.TableStore.ComparatorType.EQUAL);
    condition.passIfMissing = false;
    const params = {
      tableName: this.tableName,
      condition: new this.TableStore.Condition(this.TableStore.RowExistenceExpectation.EXPECT_EXIST, condition),
      primaryKey: [{ license_hash: current.licenseHash }],
      updateOfAttributeColumns: [{ PUT: licenseColumns(updated) }]
    };
    try { await promiseCall(this.client, "updateRow", params); return true; }
    catch (error) { if (/condition|OTSConditionCheckFail/i.test(String(error.code || error.message))) return false; throw error; }
  }

  async delete(current) {
    const condition = new this.TableStore.SingleColumnCondition("revision", String(current.revision), this.TableStore.ComparatorType.EQUAL);
    condition.passIfMissing = false;
    const params = {
      tableName: this.tableName,
      condition: new this.TableStore.Condition(this.TableStore.RowExistenceExpectation.EXPECT_EXIST, condition),
      primaryKey: [{ license_hash: current.licenseHash }]
    };
    try { await promiseCall(this.client, "deleteRow", params); return true; }
    catch (error) { if (/condition|OTSConditionCheckFail/i.test(String(error.code || error.message))) return false; throw error; }
  }

  async backfillMetadata() {
    const records = await this.list();
    let updated = 0;
    for (const record of records) {
      const current = Object.assign({}, record);
      const next = Object.assign({}, record, { revision: Number(record.revision || 1) + 1, updatedAt: Number(record.updatedAt || Date.now()) });
      if (await this.compareAndSwap(current, next)) updated++;
    }
    return updated;
  }
}

class TablestoreAuditRepository {
  constructor(TableStore, client, tableName) {
    this.TableStore = TableStore;
    this.client = client;
    this.tableName = tableName || "shuzhi_license_audit";
  }

  async append(event) {
    const reverseTime = String(9999999999999 - Number(event.createdAt || Date.now())).padStart(13, "0");
    const suffix = require("crypto").randomBytes(8).toString("hex");
    const eventKey = `${reverseTime}_${suffix}`;
    await promiseCall(this.client, "putRow", {
      tableName: this.tableName,
      condition: new this.TableStore.Condition(this.TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
      primaryKey: [{ event_key: eventKey }],
      attributeColumns: [
        { event_json: JSON.stringify(event) },
        { action: event.action || "" },
        { actor: event.actor || "" },
        { license_id: event.licenseId || "" },
        { created_at: String(event.createdAt || 0) }
      ]
    });
  }

  async list(limit = 200) {
    const data = await promiseCall(this.client, "getRange", {
      tableName: this.tableName,
      direction: this.TableStore.Direction.FORWARD,
      inclusiveStartPrimaryKey: [{ event_key: this.TableStore.INF_MIN }],
      exclusiveEndPrimaryKey: [{ event_key: this.TableStore.INF_MAX }],
      maxVersions: 1,
      limit
    });
    const events = [];
    for (const row of data.rows || []) {
      const columns = columnMap(row);
      if (!columns.event_json) continue;
      try { events.push(JSON.parse(String(columns.event_json))); } catch (_error) {}
    }
    return events;
  }
}

module.exports = { TablestoreAdminRepository, TablestoreAuditRepository, columnMap, licenseColumns, promiseCall };

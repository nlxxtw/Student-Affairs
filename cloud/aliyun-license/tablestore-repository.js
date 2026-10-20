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

class TablestoreLicenseRepository {
  constructor(TableStore, client, tableName) {
    this.TableStore = TableStore;
    this.client = client;
    this.tableName = tableName || "shuzhi_licenses";
  }

  async get(licenseHash) {
    const data = await promiseCall(this.client, "getRow", { tableName: this.tableName, primaryKey: [{ license_hash: licenseHash }], maxVersions: 1 });
    const columns = columnMap(data.row);
    if (!columns.record_json) return null;
    return JSON.parse(String(columns.record_json));
  }

  async create(record) {
    const params = {
      tableName: this.tableName,
      condition: new this.TableStore.Condition(this.TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
      primaryKey: [{ license_hash: record.licenseHash }],
      attributeColumns: [{ record_json: JSON.stringify(record) }, { revision: String(record.revision) }, { license_id: record.id }, { updated_at: String(record.updatedAt) }]
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
      updateOfAttributeColumns: [{ PUT: [{ record_json: JSON.stringify(updated) }, { revision: String(updated.revision) }, { updated_at: String(updated.updatedAt) }] }]
    };
    try { await promiseCall(this.client, "updateRow", params); return true; }
    catch (error) { if (/condition|OTSConditionCheckFail/i.test(String(error.code || error.message))) return false; throw error; }
  }
}

module.exports = { TablestoreLicenseRepository, columnMap, promiseCall };

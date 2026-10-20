'use strict';
const crypto=require('node:crypto');

// Version 1 is the existing schema. Keep published migrations immutable.
const MIGRATIONS=Object.freeze([
 Object.freeze({version:1,name:'existing-encrypted-schema',sql:`
    CREATE TABLE IF NOT EXISTS academic_public_state(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS academic_public_artifacts(id TEXT PRIMARY KEY,kind TEXT NOT NULL,actor TEXT NOT NULL,expires INTEGER NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS academic_public_batches(id TEXT PRIMARY KEY,actor TEXT NOT NULL,created TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS academic_public_warning_runs(id TEXT PRIMARY KEY,actor TEXT NOT NULL,created TEXT NOT NULL,selection_key TEXT NOT NULL,data_version INTEGER NOT NULL,payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS academic_public_warning_runs_created ON academic_public_warning_runs(created DESC);
    CREATE INDEX IF NOT EXISTS academic_public_warning_runs_actor ON academic_public_warning_runs(actor,created DESC);
    CREATE TABLE IF NOT EXISTS legacy_ui_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_legacy_ui_store_updated ON legacy_ui_store(updated_at);
    CREATE TABLE IF NOT EXISTS web_backup_records (
      id TEXT PRIMARY KEY,
      relative_path TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS migration_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    /* 本机密码仅保存 scrypt 哈希；短期会话只驻留进程内存，服务重启即失效。 */
    CREATE TABLE IF NOT EXISTS local_auth (
      id INTEGER PRIMARY KEY CHECK(id=1),
      password_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    /* 仅服务端可见的 AI 配置与审计（不进 legacy_ui_store，前端经桥永远拿不到） */
    CREATE TABLE IF NOT EXISTS ai_secret (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    /* WebDAV 地址与授权码仅存服务端，并以当前本机数据密钥加密。 */
    CREATE TABLE IF NOT EXISTS webdav_secret (
      id INTEGER PRIMARY KEY CHECK(id=1),
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ai_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      host TEXT NOT NULL DEFAULT '',
      status INTEGER NOT NULL DEFAULT 0,
      ms INTEGER NOT NULL DEFAULT 0,
      prompt_len INTEGER NOT NULL DEFAULT 0,
      resp_len INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT ''
    );
    /* AI 用量只记录非敏感元数据，用于原子额度控制、Token 与费用统计。 */
    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      feature TEXT NOT NULL DEFAULT 'general',
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      request_kind TEXT NOT NULL DEFAULT 'chat',
      request_count INTEGER NOT NULL DEFAULT 1,
      input_chars INTEGER NOT NULL DEFAULT 0,
      image_bytes INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0,
      status INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ai_usage_ts ON ai_usage(ts);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_feature_ts ON ai_usage(feature,ts);
    CREATE TABLE IF NOT EXISTS departments (
      name TEXT PRIMARY KEY,
      code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS majors (
      name TEXT PRIMARY KEY,
      code TEXT NOT NULL DEFAULT '',
      department_name TEXT NOT NULL REFERENCES departments(name) ON UPDATE CASCADE ON DELETE RESTRICT,
      years TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS class_groups (
      name TEXT PRIMARY KEY,
      department_name TEXT NOT NULL REFERENCES departments(name) ON UPDATE CASCADE ON DELETE RESTRICT,
      major_name TEXT NOT NULL REFERENCES majors(name) ON UPDATE CASCADE ON DELETE RESTRICT,
      grade TEXT NOT NULL DEFAULT '',
      counselor TEXT NOT NULL DEFAULT '',
      teacher TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL DEFAULT '',
      enroll_type TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS terms (
      name TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_current INTEGER NOT NULL DEFAULT 0 CHECK(is_current IN (0,1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_terms_current ON terms(is_current) WHERE is_current=1;
    CREATE TABLE IF NOT EXISTS students (
      student_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      department_name TEXT NOT NULL DEFAULT '',
      major_name TEXT NOT NULL DEFAULT '',
      class_name TEXT NOT NULL DEFAULT '',
      grade TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '在校',
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_students_org ON students(department_name,major_name,grade,class_name,status);
    CREATE TABLE IF NOT EXISTS party_profiles (
      student_id TEXT PRIMARY KEY REFERENCES students(student_id) ON UPDATE CASCADE ON DELETE CASCADE,
      stage TEXT NOT NULL DEFAULT '群众',
      league_status TEXT NOT NULL DEFAULT '非团员',
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS party_history (
      record_id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(student_id) ON UPDATE CASCADE ON DELETE CASCADE,
      stage TEXT NOT NULL,
      record_date TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_party_history_student ON party_history(student_id,record_date,stage);
    CREATE TABLE IF NOT EXISTS classroom_records (
      record_id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(student_id) ON UPDATE CASCADE ON DELETE CASCADE,
      term_name TEXT NOT NULL DEFAULT '',
      record_date TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_classroom_records_student ON classroom_records(student_id,term_name,record_date);
    CREATE TABLE IF NOT EXISTS student_dorm_records (
      record_id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(student_id) ON UPDATE CASCADE ON DELETE CASCADE,
      term_name TEXT NOT NULL DEFAULT '',
      record_date TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_student_dorm_records_student ON student_dorm_records(student_id,term_name,record_date);
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      term_name TEXT NOT NULL DEFAULT '',
      class_name TEXT NOT NULL DEFAULT '',
      department_name TEXT NOT NULL DEFAULT '',
      major_name TEXT NOT NULL DEFAULT '',
      grade TEXT NOT NULL DEFAULT '',
      topic TEXT NOT NULL DEFAULT '',
      meeting_date TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_meetings_filter ON meetings(term_name,department_name,major_name,grade,class_name);
    CREATE TABLE IF NOT EXISTS talk_records (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL DEFAULT '',
      term_name TEXT NOT NULL DEFAULT '',
      record_date TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_talk_records_student ON talk_records(student_id,term_name,record_date);
    CREATE TABLE IF NOT EXISTS home_contacts (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL DEFAULT '',
      term_name TEXT NOT NULL DEFAULT '',
      record_date TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_home_contacts_student ON home_contacts(student_id,term_name,record_date);
    CREATE TABLE IF NOT EXISTS punishment_records (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL DEFAULT '',
      term_name TEXT NOT NULL DEFAULT '',
      punishment_type TEXT NOT NULL DEFAULT '',
      record_date TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_punishment_records_filter ON punishment_records(student_id,term_name,punishment_type);
    CREATE TABLE IF NOT EXISTS fund_records (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL DEFAULT '',
      term_name TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS dorm_distribution_records (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS dorm_module_state (
      id INTEGER PRIMARY KEY CHECK(id=1),
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS academic_term_records (
      module_name TEXT NOT NULL CHECK(module_name IN ('academic_terms','academic_warnings')),
      term_id TEXT NOT NULL,
      term_name TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(module_name,term_id)
    );
    CREATE TABLE IF NOT EXISTS recycle_bin (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      module_key TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_lookup TEXT NOT NULL DEFAULT '',
      entity_id_enc TEXT NOT NULL,
      display_title_enc TEXT NOT NULL,
      student_lookup TEXT NOT NULL DEFAULT '',
      delete_kind TEXT NOT NULL DEFAULT 'single',
      payload_json TEXT NOT NULL,
      attachment_ids_json TEXT NOT NULL,
      source_keys_json TEXT NOT NULL,
      relation_count INTEGER NOT NULL DEFAULT 0,
      attachment_count INTEGER NOT NULL DEFAULT 0,
      attachment_bytes INTEGER NOT NULL DEFAULT 0,
      schema_version INTEGER NOT NULL DEFAULT 1,
      checksum TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      deleted_at TEXT NOT NULL,
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_recycle_bin_active_time ON recycle_bin(status,deleted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_recycle_bin_module ON recycle_bin(module_key,entity_type,entity_lookup);
    CREATE INDEX IF NOT EXISTS idx_recycle_bin_student ON recycle_bin(student_lookup,status);
    CREATE TABLE IF NOT EXISTS recycle_bin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recycle_id TEXT NOT NULL,
      action TEXT NOT NULL,
      module_key TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_lookup TEXT NOT NULL DEFAULT '',
      action_at TEXT NOT NULL,
      result TEXT NOT NULL DEFAULT 'success',
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS recycle_bin_requests (
      request_id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
`}),
 Object.freeze({version:2,name:'snapshot-read-indexes',sql:`
CREATE INDEX IF NOT EXISTS idx_party_history_snapshot ON party_history(record_date,record_id);
CREATE INDEX IF NOT EXISTS idx_classroom_records_snapshot ON classroom_records(record_date,record_id);
CREATE INDEX IF NOT EXISTS idx_student_dorm_records_snapshot ON student_dorm_records(record_date,record_id);
CREATE INDEX IF NOT EXISTS idx_meetings_snapshot ON meetings(created_at);
CREATE INDEX IF NOT EXISTS idx_talk_records_snapshot ON talk_records(created_at);
CREATE INDEX IF NOT EXISTS idx_home_contacts_snapshot ON home_contacts(created_at);
CREATE INDEX IF NOT EXISTS idx_punishment_records_snapshot ON punishment_records(created_at);
CREATE INDEX IF NOT EXISTS idx_fund_records_snapshot ON fund_records(created_at);
CREATE INDEX IF NOT EXISTS idx_dorm_distribution_snapshot ON dorm_distribution_records(created_at);
CREATE INDEX IF NOT EXISTS idx_academic_term_records_snapshot ON academic_term_records(module_name,term_name);`})
]);

function checksum(migration){return crypto.createHash('sha256').update(migration.version+'\n'+migration.name+'\n'+migration.sql).digest('hex');}

function migrateDatabase(db,migrations=MIGRATIONS){
 if(!migrations.length||migrations.some((migration,index)=>migration.version!==index+1))throw Error('数据库迁移版本必须从1连续递增。');
 const supported=migrations.at(-1).version;
 const version=Number(db.prepare('PRAGMA user_version').get().user_version);
 if(version>supported)throw Error('数据库来自新版本，当前程序不支持此结构；请使用对应新版本程序。');
 const hasLedger=db.prepare("SELECT 1 FROM sqlite_master WHERE name='workbench_schema_migrations'").get();
 if(hasLedger){const latest=Number(db.prepare('SELECT MAX(version) version FROM workbench_schema_migrations').get().version||0);if(latest!==version)throw Error('数据库结构版本与迁移记录不一致。');}
 else if(version!==0)throw Error('数据库缺少对应结构迁移记录。');
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec('CREATE TABLE IF NOT EXISTS workbench_schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const read=db.prepare('SELECT checksum FROM workbench_schema_migrations WHERE version=?');
  const record=db.prepare('INSERT INTO workbench_schema_migrations(version,name,checksum) VALUES(?,?,?)');
  for(const migration of migrations){
   const hash=checksum(migration),applied=read.get(migration.version);
   if(applied){if(applied.checksum!==hash)throw Error('已应用的数据库迁移校验不一致：'+migration.version);continue;}
   db.exec(migration.sql);record.run(migration.version,migration.name,hash);
  }
  const check=db.prepare('PRAGMA quick_check(1)').get();
  if(Object.values(check)[0]!=='ok')throw Error('数据库一致性检查失败。');
  db.exec('PRAGMA user_version='+supported);
  db.exec('COMMIT');
  return supported;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
module.exports={migrateDatabase,MIGRATIONS};

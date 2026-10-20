'use strict';
const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {migrateDatabase,MIGRATIONS}=require('../workbench-database.js');
const db=new DatabaseSync(':memory:');
try{
 // A database produced by the previous version has tables but no version ledger.
 db.exec(MIGRATIONS[0].sql);
 db.prepare('INSERT INTO students(student_id,name,data_json) VALUES(?,?,?)').run('hashed-student','encrypted-name','enc:opaque-payload');
 migrateDatabase(db);
 const rows=()=>db.prepare('SELECT * FROM students').all();const before=rows();const ledger=()=>db.prepare('SELECT * FROM workbench_schema_migrations ORDER BY version').all();const firstLedger=ledger();
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);assert.equal(firstLedger.length,2);assert.deepEqual(before.map(r=>r.data_json),['enc:opaque-payload']);
 migrateDatabase(db);assert.deepEqual(rows(),before);assert.deepEqual(ledger(),firstLedger,'repeat startup must not rewrite migration records');
 const plan=db.prepare('EXPLAIN QUERY PLAN SELECT student_id,data_json FROM classroom_records ORDER BY record_date,record_id').all();assert(!plan.some(r=>r.detail.includes('TEMP B-TREE')),JSON.stringify(plan));
 assert.throws(()=>migrateDatabase(db,[...MIGRATIONS,{version:3,name:'test-failure',sql:'CREATE TABLE partial_migration(id TEXT); INSERT INTO missing_table VALUES(1);'}]));
 assert.equal(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name='partial_migration'").get().c,0,'failed migration must roll back DDL');assert.deepEqual(ledger(),firstLedger);assert.deepEqual(rows(),before);
 db.exec('PRAGMA user_version=99');assert.throws(()=>migrateDatabase(db),/新版本|higher|newer/i);assert.deepEqual(ledger(),firstLedger);assert.deepEqual(rows(),before);
 db.exec('PRAGMA user_version=2');db.prepare('UPDATE workbench_schema_migrations SET checksum=? WHERE version=1').run('tampered');assert.throws(()=>migrateDatabase(db),/校验|checksum/i);
 console.log('database migrations: passed (old DB, encryption/IDs unchanged, repeat startup, index plan, transactional rollback, future-version guard, checksum)');
}finally{db.close();}

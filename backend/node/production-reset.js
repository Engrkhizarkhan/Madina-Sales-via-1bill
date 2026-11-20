import {randomBytes} from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { config } from "./config.js";
import { transaction } from "./db.js";
import { audit } from "./operations.js";
import {requireOwner} from './account-access.js';
import {printJobSnapshot,clearPrintJobs} from './print-jobs.js';
import {maintenance} from '../update/maintenance.js';

// Sales-only cleanup retains accounts, devices and every roster row, including
// date-specific vehicle/time assignments. This is never a release migration.
export async function clearTestSales(owner,req,command) {
  requireOwner(owner);
  if(!maintenance.draining())throw new Error('Sales cleanup requires the maintenance write fence.');
  if(command?.action!=='clear-test-sales'||!/^[a-f0-9]{32}$/.test(command.nonce||''))throw new Error('A fixed sales-cleanup command is required.');
  const tables=['counter_cash_entries','financial_transactions','expenses','shift_closures','counter_shifts','refunds','booking_seats','payment_events','bookings'];
  const auditTypes=['booking','expense','trip_run','shift','counter_shift','refund','payment','counter_cash'];
  return transaction(async connection=>{
    const marker=`production_reset_${command.nonce}`;
    const [[applied]]=await connection.execute('SELECT setting_value FROM settings WHERE setting_key=? FOR UPDATE',[marker]);
    if(applied)return {...(typeof applied.setting_value==='string'?JSON.parse(applied.setting_value):applied.setting_value),alreadyApplied:true};
    const snapshot={createdAt:new Date().toISOString(),scope:'sales-only',tables:{},printJobs:await printJobSnapshot()};
    for(const table of [...tables,'trip_runs'])snapshot.tables[table]=(await connection.query(`SELECT * FROM \`${table}\``))[0];
    const placeholders=auditTypes.map(()=>'?').join(',');
    snapshot.tables.audit_logs=(await connection.execute(`SELECT * FROM audit_logs WHERE entity_type IN (${placeholders})`,auditTypes))[0];
    const directory=join(config.terminal.directory,'backups');await mkdir(directory,{recursive:true,mode:0o700});
    const filename=`production-reset-${Date.now()}-${randomBytes(4).toString('hex')}.json.gz`;
    await writeFile(join(directory,filename),gzipSync(JSON.stringify(snapshot)),{mode:0o600,flag:'wx',flush:true});
    const cleared={};
    for(const table of tables)cleared[table]=(await connection.query(`DELETE FROM \`${table}\``))[0].affectedRows;
    cleared.audit_logs=(await connection.execute(`DELETE FROM audit_logs WHERE entity_type IN (${placeholders})`,auditTypes))[0].affectedRows;
    cleared.trip_runs_reset=(await connection.execute("UPDATE trip_runs SET status='Scheduled',sales_paused=0,sales_override=0,notes='',boarding_started_at=NULL,departed_at=NULL,returned_at=NULL,snapshot=JSON_REMOVE(snapshot,'$.voucher','$.passengers')"))[0].affectedRows;
    cleared.print_jobs=await clearPrintJobs();
    const result={cleared,backup:filename,inventoryPreserved:true,accountsPreserved:true,devicesPreserved:true,schedulePreserved:true,releaseId:command.releaseId,completedAt:new Date().toISOString()};
    await connection.execute('INSERT INTO settings(setting_key,setting_value,updated_by) VALUES (?,?,?)',[marker,JSON.stringify(result),owner.id]);
    await audit('production.data_cleared','system','test-sales',null,{...result,scope:'sales-only'},owner.id,req,connection);
    return result;
  });
}

// An explicit owner operation, never an automatic release migration or seed.
export async function clearOperationalData(owner, req, command = null) {
  const devicesPreserved=command?.action!=="prepare-main-pc-handover";
  const tables = ["counter_cash_entries","financial_transactions","expenses","shift_closures","counter_shifts","refunds","booking_seats","payment_events","bookings","trip_runs","api_sessions","audit_logs","users","crew"];
  return transaction(async connection => {
    const marker = command ? `production_reset_${command.nonce}` : null;
    if (marker) {
      const [[applied]]=await connection.execute("SELECT setting_value FROM settings WHERE setting_key=? FOR UPDATE",[marker]);
      if (applied) return {...(typeof applied.setting_value === "string" ? JSON.parse(applied.setting_value) : applied.setting_value),alreadyApplied:true};
    }
    const snapshot = {createdAt:new Date().toISOString(),tables:{}};
    for (const table of tables) {
      const [rows] = await connection.query(`SELECT * FROM \`${table}\``);
      snapshot.tables[table] = rows;
    }
    const directory = join(config.terminal.directory,"backups");
    await mkdir(directory,{recursive:true,mode:0o700});
    const filename = `production-reset-${Date.now()}-${randomBytes(4).toString("hex")}.json.gz`;
    await writeFile(join(directory,filename),gzipSync(JSON.stringify(snapshot)),{mode:0o600,flag:"wx"});
    const cleared = {};
    for (const table of tables.filter(name=>!["users","api_sessions"].includes(name))) {
      const [result] = await connection.query(`DELETE FROM \`${table}\``);
      cleared[table] = result.affectedRows;
    }
    await connection.execute("UPDATE settings SET updated_by=? WHERE updated_by IS NOT NULL",[owner.id]);
    await connection.execute("UPDATE terminal_enrollments SET created_by=?",[owner.id]);
    if (command?.action==="prepare-main-pc-handover") {
      const [enrollments]=await connection.execute("DELETE FROM terminal_enrollments");
      const [devices]=await connection.execute("DELETE FROM terminal_devices");
      cleared.terminal_enrollments=enrollments.affectedRows;cleared.terminal_devices=devices.affectedRows;
    }
    await connection.execute("DELETE FROM api_sessions WHERE user_id<>?",[owner.id]);
    const [removed] = await connection.execute("DELETE FROM users WHERE id<>?",[owner.id]);
    cleared.users = removed.affectedRows;
    await connection.execute("UPDATE trips SET status='Scheduled',run_number=1,last_departed_at=NULL");
    await connection.execute("UPDATE buses SET status='Ready' WHERE status='On route'");
    if (marker) await connection.execute("INSERT INTO settings(setting_key,setting_value,updated_by) VALUES (?,?,?)",[marker,JSON.stringify({cleared,inventoryPreserved:true,devicesPreserved,releaseId:command.releaseId,completedAt:new Date().toISOString()}),owner.id]);
    await audit("production.data_cleared","system","operational-data",null,{cleared,backup:filename,inventoryPreserved:true,devicesPreserved},owner.id,req,connection);
    return {cleared,inventoryPreserved:true,devicesPreserved};
  });
}

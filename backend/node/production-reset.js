import {randomBytes} from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { config } from "./config.js";
import { transaction } from "./db.js";
import { audit } from "./operations.js";

// An explicit owner operation, never an automatic release migration or seed.
export async function clearOperationalData(owner, req, command = null) {
  const tables = ["financial_transactions","expenses","shift_closures","counter_shifts","refunds","booking_seats","payment_events","bookings","trip_runs","api_sessions","audit_logs","users","crew"];
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
    await connection.execute("DELETE FROM api_sessions WHERE user_id<>?",[owner.id]);
    const [removed] = await connection.execute("DELETE FROM users WHERE id<>?",[owner.id]);
    cleared.users = removed.affectedRows;
    await connection.execute("UPDATE trips SET status='Scheduled',run_number=1,last_departed_at=NULL");
    await connection.execute("UPDATE buses SET status='Ready' WHERE status='On route'");
    if (marker) await connection.execute("INSERT INTO settings(setting_key,setting_value,updated_by) VALUES (?,?,?)",[marker,JSON.stringify({cleared,inventoryPreserved:true,devicesPreserved:true,releaseId:command.releaseId,completedAt:new Date().toISOString()}),owner.id]);
    await audit("production.data_cleared","system","operational-data",null,{cleared,backup:filename,inventoryPreserved:true,devicesPreserved:true},owner.id,req,connection);
    return {cleared,inventoryPreserved:true,devicesPreserved:true};
  });
}

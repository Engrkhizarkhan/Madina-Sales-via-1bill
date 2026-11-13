import mysql from "mysql2/promise";
import { config } from "./config.js";
import {beginChanges,flushChanges,endChanges} from './transaction-changes.js';

export const pool = mysql.createPool({
  ...config.db,
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
  charset: "utf8mb4",
  timezone: "+05:00",
  dateStrings: true,
  decimalNumbers: true,
  namedPlaceholders: true,
});

export async function transaction(operation) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    beginChanges(connection);
    const result = await operation(connection);
    await flushChanges(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    endChanges(connection);
    connection.release();
  }
}

export async function closePool() {
  await pool.end();
}

import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

dotenv.config({ path: resolve("backend", ".env") });

const env = (key, fallback = "") => process.env[key] || fallback;
const database = env("DB_NAME");
const appUser = env("DB_USER");
const appPassword = env("DB_PASSWORD");
if (![database, appUser].every((value) => /^[a-zA-Z0-9_]+$/.test(value))) {
  throw new Error("Database and user names may contain only letters, numbers and underscores.");
}

const adminSocket = env("MYSQL_ADMIN_SOCKET");
const admin = await mysql.createConnection({
  ...(adminSocket ? { socketPath: adminSocket } : { host: env("DB_HOST", "127.0.0.1") }),
  port: Number(env("DB_PORT", "3306")),
  user: env("MYSQL_ADMIN_USER", "root"),
  password: env("MYSQL_ADMIN_PASSWORD", ""),
  multipleStatements: true,
});

try {
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const quotedPassword = admin.escape(appPassword);
  for (const host of ["localhost", "127.0.0.1"]) {
    await admin.query(`CREATE USER IF NOT EXISTS '${appUser}'@'${host}' IDENTIFIED BY ${quotedPassword}`);
    await admin.query(`ALTER USER '${appUser}'@'${host}' IDENTIFIED BY ${quotedPassword}`);
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${appUser}'@'${host}'`);
  }
  await admin.changeUser({ database });
  await admin.query(await readFile(resolve("backend", "database", "schema.sql"), "utf8"));
  const migrationDirectory = resolve("backend", "database", "migrations");
  const migrations = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
  for (const migration of migrations) {
    await admin.query(await readFile(resolve(migrationDirectory, migration), "utf8"));
  }

  const adminEmail = env("ADMIN_EMAIL").toLowerCase();
  const adminUsername = env("ADMIN_USERNAME").toLowerCase();
  const [existing] = await admin.execute("SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1", [adminEmail, adminUsername]);
  if (!existing.length) {
    await admin.execute(
      "INSERT INTO users (name, email, username, password_hash, role, force_password_change) VALUES (?, ?, ?, ?, 'admin', 1)",
      [env("ADMIN_NAME"), adminEmail, adminUsername, await bcrypt.hash(env("ADMIN_PASSWORD"), 12)],
    );
  }

  // Demo records are opt-in and must never reappear during a production update.
  if (env("SEED_DEMO_DATA") === "true") {
  const routes = [
    ["psh-khi", "Peshawar", "Karachi", "1,380 km", "14h 00m", 7000, "Madina Terminal, Peshawar"],
    ["psh-lhr", "Peshawar", "Lahore", "520 km", "5h 45m", 4200, "Madina Terminal, Peshawar"],
    ["psh-isb", "Peshawar", "Islamabad", "185 km", "2h 30m", 1800, "Madina Terminal, Peshawar"],
    ["psh-mul", "Peshawar", "Multan", "690 km", "7h 30m", 4500, "Madina Terminal, Peshawar"],
    ["khi-psh", "Karachi", "Peshawar", "1,380 km", "14h 15m", 7000, "Sohrab Goth Terminal, Karachi"],
    ["lhr-psh", "Lahore", "Peshawar", "520 km", "5h 45m", 4200, "Thokar Niaz Baig, Lahore"],
  ];
  for (const route of routes) await admin.execute("INSERT IGNORE INTO routes (id, origin, destination, distance, duration, fare, boarding_point, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'Active')", route);

  const buses = [
    ["tae-388", "TAE-388", "Standard Plus", 49, "Yutong ZK6122H9", 2024, "On route", "12 Sep 2026"],
    ["taj-977", "TAJ-977", "Executive", 44, "Daewoo BH-120", 2023, "Ready", "18 Sep 2026"],
    ["les-221", "LES-221", "Sleeper Bus", 35, "Yutong C13 Pro", 2025, "Ready", "26 Sep 2026"],
    ["bsa-840", "BSA-840", "Executive", 41, "Higer KLQ6128", 2022, "Maintenance", "In workshop"],
  ];
  for (const bus of buses) await admin.execute("INSERT IGNORE INTO buses (id, registration, service, seats, model, model_year, status, next_service) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", bus);

  const crew = [
    ["Muhammad Ameen", "Driver", "0300 1122456", "17301-2481162-1", "HTV-PSH-10428", "Peshawar to Karachi", "On duty", "MA"],
    ["Adeel Shah", "Driver", "0304 3310098", "17301-8842160-7", "HTV-PSH-11802", "Available at terminal", "Available", "AS"],
    ["Ayesha Khan", "Female attendant", "0315 6621908", "17301-6621908-4", "—", "Peshawar to Karachi", "On duty", "AK"],
    ["Nazia Bibi", "Female attendant", "0332 5514402", "17301-5514402-8", "—", "Available at terminal", "Available", "NB"],
    ["Faisal Khan", "Driver", "0307 9912045", "17301-9912045-2", "HTV-PSH-12561", "Peshawar to Lahore", "Scheduled", "FK"],
    ["Sadia Noor", "Female attendant", "0318 7441280", "17301-7441280-5", "—", "Peshawar to Lahore", "Scheduled", "SN"],
  ];
  for (const person of crew) await admin.execute("INSERT IGNORE INTO crew (name, role, phone, cnic, license, duty, status, initials) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", person);

  const trips = [
    ["psh-khi-night", "psh-khi", "tae-388", "23:30", "13:30", "Muhammad Ameen", "Ayesha Khan", "Platform 1", "Scheduled", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]],
    ["psh-lhr-evening", "psh-lhr", "taj-977", "22:00", "03:45", "Faisal Khan", "Sadia Noor", "Platform 2", "Scheduled", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]],
    ["psh-isb-morning", "psh-isb", "les-221", "10:00", "12:30", "Adeel Shah", "Nazia Bibi", "Platform 3", "Scheduled", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]],
    ["psh-mul-night", "psh-mul", "taj-977", "21:30", "05:00", "Adeel Shah", "Nazia Bibi", "Platform 4", "Scheduled", ["Mon", "Wed", "Fri", "Sun"]],
  ];
  for (const trip of trips) {
    const values = [...trip.slice(0, 9), JSON.stringify(trip[9])];
    await admin.execute("INSERT IGNORE INTO trips (id, route_id, bus_id, departure, arrival, driver, attendant, platform, status, service_days, active, run_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)", values);
  }
  }
  console.log("Madina Express MySQL database installed for the Node.js backend.");
} finally {
  await admin.end();
}

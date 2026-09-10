import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profilePath = resolve(".qa-browser", "cdp-profile");
const debugPort = 9333;
const appUrl = (process.env.BROWSER_APP_URL || "http://localhost/madina-express").replace(/\/$/, "");
const apiHealthUrl = process.env.BROWSER_API_URL || "http://localhost:3101/health";
let qaAdminId = null;
let qaConnection = null;
mkdirSync(resolve(".qa-browser"), { recursive: true });
rmSync(profilePath, { recursive: true, force: true });

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--disable-background-networking",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profilePath}`,
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true },
);

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function waitForDebugger() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }
  throw new Error("Chrome DevTools endpoint did not start.");
}

function readBackendEnv() {
  const values = {};
  for (const line of readFileSync(resolve("backend", ".env"), "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    values[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }
  return values;
}

try {
  await waitForDebugger();
  const created = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`${appUrl}/`)}`,
    { method: "PUT" },
  ).then((response) => response.json());
  const socket = new WebSocket(created.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const runtimeErrors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      runtimeErrors.push(
        message.params?.exceptionDetails?.exception?.description ??
          message.params?.exceptionDetails?.text ??
          "Unknown browser exception",
      );
    }
    if (!message.id || !pending.has(message.id)) return;
    const { resolveRequest, rejectRequest } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) rejectRequest(new Error(message.error.message));
    else resolveRequest(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolveRequest, rejectRequest) => {
      const id = ++nextId;
      pending.set(id, { resolveRequest, rejectRequest });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text);
    }
    return result.result.value;
  };
  const navigate = async (url) => {
    await send("Page.navigate", { url });
    await delay(1400);
  };
  let passed = 0;
  const expect = (condition, label) => {
    if (!condition) throw new Error(`FAIL  ${label}`);
    passed++;
    console.log(`PASS  ${label}`);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await navigate(`${appUrl}/`);
  await delay(1200);
  const publicState = await evaluate(`({
    title: document.title,
    loginVisible: Boolean(document.querySelector('.login-form')),
    publicSearchVisible: Boolean(document.querySelector('.public-search')),
    publicBookingCopy: document.body.innerText.includes('Book your journey')
  })`);
  expect(publicState.title.includes("Madina Express"), "application page title renders");
  expect(publicState.loginVisible, "public URL shows staff sign-in while client website is disabled");
  expect(!publicState.publicSearchVisible && !publicState.publicBookingCopy, "client booking website is hidden");
  const apiProbe = await evaluate(`fetch(${JSON.stringify(apiHealthUrl)}, { credentials: 'include' }).then(async (response) => ({ status: response.status, text: await response.text() })).catch((error) => ({ error: error.message }))`);
  expect(apiProbe.status === 200 && apiProbe.text.includes('"runtime":"node"'), "browser connects to the Node.js API");

  await navigate(`${appUrl}/manage`);
  const guardedPath = await evaluate("location.pathname");
  expect(guardedPath.endsWith("/login"), "management URL redirects anonymous users to sign in");

  const invalidLogin = await evaluate(`(async () => {
    const setValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = document.querySelectorAll('.login-form input');
    setValue(inputs[0], 'invalid-user');
    setValue(inputs[1], 'invalid-password');
    document.querySelector('.login-form').requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 900));
    return document.querySelector('.login-notice')?.textContent || '';
  })()`);
  if (!invalidLogin.includes("incorrect")) console.log(`Invalid-login notice: ${invalidLogin || "(empty)"}`);
  expect(invalidLogin.includes("incorrect"), "login form displays the API authentication error");

  let qaUsername = process.env.BROWSER_USERNAME;
  let qaPassword = process.env.BROWSER_PASSWORD;
  if (Boolean(qaUsername) !== Boolean(qaPassword)) {
    throw new Error("Set both BROWSER_USERNAME and BROWSER_PASSWORD, or neither.");
  }
  if (!qaUsername) {
    const environment = readBackendEnv();
    qaUsername = `browser-admin-${Date.now()}`;
    qaPassword = "BrowserAdmin!2026Test";
    qaConnection = await mysql.createConnection({
      host: environment.DB_HOST,
      port: Number(environment.DB_PORT || 3306),
      user: environment.DB_USER,
      password: environment.DB_PASSWORD,
      database: environment.DB_NAME,
    });
    const [qaAdmin] = await qaConnection.execute(
      "INSERT INTO users (name, email, username, password_hash, role, force_password_change) VALUES (?, ?, ?, ?, 'admin', 1)",
      ["Browser QA Administrator", `${qaUsername}@example.invalid`, qaUsername, await bcrypt.hash(qaPassword, 12)],
    );
    qaAdminId = Number(qaAdmin.insertId);
  }
  const loginResult = await evaluate(`(async () => {
    const setValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = document.querySelectorAll('.login-form input');
    setValue(inputs[0], ${JSON.stringify(qaUsername)});
    setValue(inputs[1], ${JSON.stringify(qaPassword)});
    document.querySelector('.login-form').requestSubmit();
    for (let attempt = 0; attempt < 50 && !document.querySelector('.admin-shell'); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { path: location.pathname, text: document.body.innerText };
  })()`);
  expect(loginResult.path.endsWith("/manage"), "valid staff login opens management");
  if (!loginResult.text.includes("System settings")) {
    console.log(loginResult.text.slice(0, 1200) || "[empty document body]");
    console.log(runtimeErrors.join("\n"));
  }
  expect(loginResult.text.includes("System settings"), "forced password-change settings load from MySQL session");
  expect(loginResult.text.includes("MySQL operational database connected"), "management system reports the central database");
  expect(loginResult.text.includes("Staff access"), "administrator staff-account management is available");

  const posState = await evaluate(`(async () => {
    const navButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('New sale'));
    navButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const toolbar = document.querySelector('.sale-toolbar');
    const input = document.querySelector('.passenger-card input');
    return {
      bellAbsent: !document.querySelector('[aria-label="Notifications"]'),
      shiftControlAbsent: !document.querySelector('.admin-shift') && !document.body.innerText.includes('Open shift'),
      saleNavFound: Boolean(navButton),
      sidebarScrollable: (() => {
        const nav = document.querySelector('.admin-sidebar nav');
        return nav && ['auto', 'scroll'].includes(getComputedStyle(nav).overflowY);
      })(),
      expensesNav: Array.from(document.querySelectorAll('.admin-sidebar nav button'))
        .some((button) => button.textContent?.includes('Expenses')),
      passengerHeading: document.querySelector('.passenger-card h2')?.innerText ?? '',
      repeatedPassengerLabel: [...document.querySelectorAll('.section-label')]
        .some((label) => label.innerText.includes('PASSENGER DETAILS')),
      toggleBelowTrip: Boolean(toolbar?.previousElementSibling?.classList.contains('admin-trip-panel')),
      inputFontSize: Number.parseFloat(getComputedStyle(input).fontSize)
    };
  })()`);
  expect(posState.saleNavFound, "new sale opens directly from navigation");
  expect(posState.bellAbsent, "notification bell is removed");
  expect(posState.shiftControlAbsent, "POS starts immediately without opening or closing shifts");
  expect(posState.sidebarScrollable, "sidebar navigation has its own vertical scroller");
  expect(posState.expensesNav, "administrator has an expense page");
  expect(posState.passengerHeading === "Passenger" && !posState.repeatedPassengerLabel, "POS passenger wording is concise");
  expect(posState.toggleBelowTrip, "paid ticket and reservation toggle sits below trip selection");
  expect(posState.inputFontSize >= 15, "POS fields use readable text sizing");

  const dashboardState = await evaluate(`(async () => {
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Dashboard'))?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const text = document.querySelector('.admin-main').innerText;
    return {
      hasOperations: text.includes("Scheduled trips") && text.includes("Buses ready"),
      hasFinance: text.includes("Monthly sales") || text.includes("Revenue overview") || text.includes("net revenue")
    };
  })()`);
  expect(dashboardState.hasOperations && !dashboardState.hasFinance, "staff dashboard shows operations without financial totals");

  const tripsState = await evaluate(`(async () => {
    Array.from(document.querySelectorAll('.admin-sidebar nav button'))
      .find((button) => button.textContent?.includes('Trips & schedules'))?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const firstRow = document.querySelector('.trip-cards article');
    const actions = document.querySelector('.trip-actions');
    const heading = document.querySelector('.view-heading h1');
    const instruction = document.querySelector('.view-heading > div > p:last-child');
    return {
      datePicker: Boolean(document.querySelector('.date-switcher input[type="date"]')),
      tableHeader: document.querySelector('.trip-table-head')?.innerText ?? '',
      deleteAction: Boolean(document.querySelector('.trip-actions [aria-label^="Delete"]')),
      actionsFit: !firstRow || !actions || actions.scrollWidth <= actions.clientWidth + 1,
      headingSize: Number.parseFloat(getComputedStyle(heading).fontSize),
      instructionSize: Number.parseFloat(getComputedStyle(instruction).fontSize)
    };
  })()`);
  expect(tripsState.datePicker, "trip schedules use a direct date picker");
  expect(tripsState.tableHeader.includes("Time") && tripsState.tableHeader.includes("Actions"), "trip schedule has a clear table structure");
  expect(tripsState.deleteAction && tripsState.actionsFit, "trip actions include delete without overlap");
  expect(tripsState.headingSize <= 28 && tripsState.instructionSize >= 14, "page headings and instructions use balanced readable type");

  const deleteControls = await evaluate(`(async () => {
    const open = async (label) => {
      Array.from(document.querySelectorAll('.admin-sidebar nav button'))
        .find((button) => button.textContent?.trim() === label)?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return Boolean(document.querySelector('[aria-label^="Delete"]'));
    };
    return {
      buses: await open('Buses'),
      routes: await open('Routes'),
      crew: await open('Staff & crew')
    };
  })()`);
  expect(deleteControls.buses && deleteControls.routes && deleteControls.crew, "buses, routes and crew expose delete controls");

  const financeState = await evaluate(`(async () => {
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Finance')?.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      lock: Boolean(document.querySelector('.finance-unlock-card')),
      blur: Boolean(document.querySelector('.finance-blur-preview')),
      realTotalsHidden: !document.querySelector('.finance-metrics')
    };
  })()`);
  expect(financeState.lock && financeState.blur && financeState.realTotalsHidden, "finance is blurred and password-locked before figures load");

  const logoutResult = await evaluate(`(async () => {
    document.querySelector('.admin-signout').click();
    await new Promise((resolve) => setTimeout(resolve, 900));
    return location.pathname;
  })()`);
  expect(logoutResult.endsWith("/login"), "staff sign-out returns to the login page");

  console.log(`\n${passed} browser smoke checks passed.`);
  socket.close();
} finally {
  chrome.kill();
  if (qaConnection && qaAdminId) {
    await qaConnection.execute("DELETE FROM api_sessions WHERE user_id = ?", [qaAdminId]);
    await qaConnection.execute("DELETE FROM audit_logs WHERE user_id = ?", [qaAdminId]);
    await qaConnection.execute("DELETE FROM users WHERE id = ?", [qaAdminId]);
  }
  if (qaConnection) await qaConnection.end();
}

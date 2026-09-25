import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
let qaFixture = null;
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
  await send("Emulation.setDeviceMetricsOverride", {width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await navigate(`${appUrl}/`);
  await delay(1200);
  const publicState = await evaluate(`({
    title: document.title,
    loginVisible: Boolean(document.querySelector('.login-form')),
    publicSearchVisible: Boolean(document.querySelector('.public-search')),
    publicBookingCopy: document.body.innerText.includes('Find your bus'),
    oneBillDeferred: document.body.innerText.includes('1Bill payment coming soon')
  })`);
  expect(publicState.title.includes("Madina Express"), "application page title renders");
  expect(!publicState.loginVisible && publicState.publicSearchVisible && publicState.publicBookingCopy, "public URL shows the passenger timetable and reservation search");
  expect(publicState.oneBillDeferred, "public website clearly defers 1Bill without simulating payment");
  expect(await evaluate("!document.querySelector('.hero-visual') && !document.querySelector('.staff-login-button')"), "public home has no hero image or staff login link");
  writeFileSync(resolve('.qa-browser/public.png'), Buffer.from((await send('Page.captureScreenshot')).data,'base64'));
  const apiProbe = await evaluate(`fetch(${JSON.stringify(apiHealthUrl)}, { credentials: 'include' }).then(async (response) => ({ status: response.status, text: await response.text() })).catch((error) => ({ error: error.message }))`);
  if (apiProbe.status !== 200) console.log(`API probe failed: ${JSON.stringify(apiProbe)}`);
  expect(apiProbe.status === 200 && apiProbe.text.includes('"runtime":"node"'), "browser connects to the Node.js API");

  await navigate(`${appUrl}/manage`);
  const guardedPath = await evaluate("location.pathname");
  expect(guardedPath.endsWith("/login"), "management URL redirects anonymous users to sign in");
  expect(await evaluate("document.querySelector('.login-form').innerText.includes('Welcome back') && !document.querySelector('.login-brand-panel')"), "login has a simple welcome without generic branding");
  writeFileSync(resolve('.qa-browser/login.png'), Buffer.from((await send('Page.captureScreenshot')).data,'base64'));

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
      port: Number(process.env.BROWSER_DB_PORT || environment.DB_PORT || 3306),
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
  if (!loginResult.path.endsWith("/manage")) console.log(`Login result: ${JSON.stringify(loginResult).slice(0, 1600)}`);
  expect(loginResult.path.endsWith("/manage"), "valid staff login opens management");
  if (!loginResult.text.includes("System settings")) {
    console.log(loginResult.text.slice(0, 1200) || "[empty document body]");
    console.log(runtimeErrors.join("\n"));
  }
  expect(loginResult.text.includes("System settings"), "forced password-change settings load from MySQL session");
  expect(loginResult.text.includes("MySQL operational database connected"), "management system reports the central database");
  expect(loginResult.text.includes("Staff access"), "administrator staff-account management is available");

  if (qaConnection) {
    await qaConnection.execute('UPDATE users SET force_password_change = 0 WHERE id = ?', [qaAdminId]);
    qaFixture = {bookings:[]};
    const post = (path,body) => evaluate(`fetch(${JSON.stringify(new URL(path,apiHealthUrl.replace(/\/health$/, '/')).href)}, {method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':sessionStorage.getItem('madina-express-csrf')},body:${JSON.stringify(JSON.stringify(body))}}).then(async r => {const b=await r.json();if(!r.ok)throw new Error(b.error?.message);return b;})`);
    qaFixture.route = (await post('routes/new',{from:'QA Print Origin',to:'QA Print Destination',distance:'20 km',duration:'1h',fare:500,boarding:'QA Terminal',status:'Active'})).route;
    qaFixture.bus = (await post('buses/new',{registration:`QA-${Date.now()}`,service:'Executive',seats:49,model:'QA',year:2026,status:'Ready',nextService:'Not scheduled'})).bus;
    qaFixture.trip = (await post('trips/new',{routeId:qaFixture.route.id,busId:qaFixture.bus.id,departure:'23:59',arrival:'01:00',driver:'QA Print Driver',attendant:'QA Print Attendant',platform:'QA',status:'Scheduled',days:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],active:true})).trip;
    const date = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const booking = {passenger:'QA Passenger',phone:'03001112222',cnic:'17301-1234567-1',gender:'Male',tripId:qaFixture.trip.id,date,paymentMethod:'Cash'};
    qaFixture.bookings.push((await post('bookings',{...booking,seats:Array.from({length:40},(_,i)=>i+1),bookingStatus:'Confirmed'})).booking.id);
    qaFixture.bookings.push((await post('bookings',{...booking,passenger:'QA Reservation',seats:[41,42],bookingStatus:'Reserved'})).booking.id);
    await post(`bookings/${qaFixture.bookings[0]}/refunds`,{amount:100,method:'Cash',reason:'Passenger request',notes:'QA printed refund'});
    await navigate(`${appUrl}/manage`);
    await delay(300);
  }

  const posState = await evaluate(`(async () => {
    const navButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Sell ticket'));
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
  expect(posState.saleNavFound, "ticket sale opens directly from navigation");
  expect(posState.bellAbsent, "notification bell is removed");
  expect(posState.shiftControlAbsent, "POS starts immediately without opening or closing shifts");
  expect(posState.sidebarScrollable, "sidebar navigation has its own vertical scroller");
  expect(posState.expensesNav, "administrator has an expense page");
  expect(posState.passengerHeading === "Passenger" && !posState.repeatedPassengerLabel, "POS passenger wording is concise");
  expect(posState.toggleBelowTrip, "paid ticket and reservation toggle sits below trip selection");
  expect(posState.inputFontSize >= 15, "POS fields use readable text sizing");
  expect(await evaluate("!document.querySelector('.admin-sidebar .brand-mark')"), "staff sidebar has no ME logo");

  const dashboardState = await evaluate(`(async () => {
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Today')?.click();
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
      .find((button) => button.textContent?.trim() === 'Roster')?.click();
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
  writeFileSync(resolve('.qa-browser/roster.png'), Buffer.from((await send('Page.captureScreenshot')).data,'base64'));

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
      crew: await open('Crew')
    };
  })()`);
  expect(deleteControls.buses && deleteControls.routes && deleteControls.crew, "buses, routes and crew expose delete controls");

  await evaluate(`Array.from(document.querySelectorAll('.admin-sidebar nav button')).find(b => b.textContent.trim() === 'Print')?.click()`);
  await delay(250);
  if (qaFixture) {
    await evaluate(`(()=>{const select=document.querySelectorAll('.report-selector select')[0];Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(qaFixture.trip.id)});select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await delay(100);
  }
  expect(await evaluate("document.querySelectorAll('.report-card').length === 4 && !!document.querySelector('.report-selector input[type=date]')"), "print workspace offers a dated bus selector and four formats");
  writeFileSync(resolve('.qa-browser/print-workspace.png'), Buffer.from((await send('Page.captureScreenshot')).data,'base64'));
  for (let index=0;index<4;index++) {
    await evaluate(`document.querySelectorAll('.report-card button')[${index}].click()`);
    await delay(200);
    const state = await evaluate(`({text:document.querySelector('.print-document').innerText,width:document.querySelector('.print-document').scrollWidth})`);
    expect(state.text.includes('MADINA EXPRESS') && (index < 2 || state.text.includes('Net collected')), `print format ${index+1} contains its expected document and totals`);
    if (qaFixture) expect(state.text.includes('QA Passenger') && (index !== 1 || !state.text.includes('QA Reservation')), `print format ${index+1} uses real ticket records and appropriate passenger status`);
    await evaluate(`document.body.classList.add('${index === 3 ? 'printing-thermal' : 'printing-a4'}')`);
    const pdf = await send('Page.printToPDF', {printBackground:true, preferCSSPageSize:true, landscape:index!==3, paperWidth:index===3?80/25.4:297/25.4,paperHeight:210/25.4,marginTop:0,marginBottom:0,marginLeft:0,marginRight:0});
    writeFileSync(resolve('.qa-browser', ['bus-detail','cnic','terminal-a4','terminal-thermal'][index]+'.pdf'),Buffer.from(pdf.data,'base64'));
    await evaluate(`document.body.classList.remove('printing-thermal','printing-a4');Array.from(document.querySelectorAll('.report-toolbar button')).find(b => b.textContent.trim() === 'Close').click()`);
    await delay(100);
  }
  expect(runtimeErrors.length === 0, "all visited views and print previews have no JavaScript exceptions");

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
    if (qaFixture) {
      for (const id of qaFixture.bookings) {
        await qaConnection.execute('DELETE FROM financial_transactions WHERE booking_id = ?', [id]);
        await qaConnection.execute('DELETE FROM refunds WHERE booking_id = ?', [id]);
        await qaConnection.execute('DELETE FROM booking_seats WHERE booking_id = ?', [id]);
        await qaConnection.execute('DELETE FROM bookings WHERE id = ?', [id]);
      }
      if (qaFixture.trip) {
        await qaConnection.execute('DELETE FROM trip_runs WHERE trip_id = ?', [qaFixture.trip.id]);
        await qaConnection.execute('DELETE FROM trips WHERE id = ?', [qaFixture.trip.id]);
      }
      if (qaFixture.bus) await qaConnection.execute('DELETE FROM buses WHERE id = ?', [qaFixture.bus.id]);
      if (qaFixture.route) await qaConnection.execute('DELETE FROM routes WHERE id = ?', [qaFixture.route.id]);
    }
    await qaConnection.execute("DELETE FROM api_sessions WHERE user_id = ?", [qaAdminId]);
    await qaConnection.execute("DELETE FROM audit_logs WHERE user_id = ?", [qaAdminId]);
    await qaConnection.execute("DELETE FROM users WHERE id = ?", [qaAdminId]);
  }
  if (qaConnection) await qaConnection.end();
}

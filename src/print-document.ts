import { printEpsonTickets } from "./epson-ticket-printer";

export type TicketPaper = "thermal" | "a4" | "tm-t88iv";

let ticketPrintQueue = Promise.resolve();

export function silentCounterPrinting() {
  try {
    if (new URLSearchParams(window.location.search).get("counterPrint") === "dialog") sessionStorage.removeItem("madina-counter-silent");
    if (new URLSearchParams(window.location.search).get("counterPrint") === "silent") sessionStorage.setItem("madina-counter-silent", "true");
    return sessionStorage.getItem("madina-counter-silent") === "true";
  } catch { return false; }
}

export function printTicketBatch(source: HTMLElement, paper: TicketPaper, signal: AbortSignal) {
  if (paper === "a4" && silentCounterPrinting()) return Promise.reject(new Error("Use the Reports browser shortcut for A4 printer selection. Choose 80 mm thermal paper in the Counter shortcut."));
  const slips = Array.from(source.querySelectorAll(".passenger-receipt, .conductor-token"), slip => slip.cloneNode(true) as Element);
  if (!slips.length) return Promise.resolve();
  const batch = ticketPrintQueue.then(async () => {
    if (paper === "tm-t88iv") {
      await printEpsonTickets(ticketPrintContent(slips), signal);
      return;
    }
    // A thermal driver can cut at the end of each job, even when it prints all pages on one roll.
    const jobs = paper === "thermal" ? slips.map(slip => [slip]) : [slips];
    for (const job of jobs) await printBrowserTickets(job, paper, signal);
  });
  ticketPrintQueue = batch.catch(() => undefined);
  return batch;
}

function ticketPrintContent(slips: Element[]) {
  const printArea = document.createElement("div");
  printArea.className = "receipt thermal-ticket";
  printArea.style.maxWidth = "none";
  printArea.append(...slips);
  return printArea;
}

function printBrowserTickets(slips: Element[], paper: "thermal" | "a4", signal: AbortSignal) {
  const slipPages = `@media print {
    body > .receipt.thermal-ticket > article { page: auto; break-after: auto; }
    body > .receipt.thermal-ticket > article + article { break-before: page; }
  }`;
  return printDocument(ticketPrintContent(slips), {
    title: slips.length > 1 ? "Madina Express tickets" : slips[0].getAttribute("aria-label") ?? "Madina Express ticket",
    width: paper === "a4" ? "210mm" : "80mm",
    pageCss: paper === "a4"
      ? `@page { size: A4 portrait; margin: 10mm; }
         @media print { body > .receipt.thermal-ticket { margin-inline: auto !important; } }
         ${slipPages}`
      : body => {
        const heightPx = body.querySelector(".thermal-ticket > article")!.scrollHeight;
        const heightMm = Math.max(81, Math.ceil(heightPx * 25.4 / 96) + 2);
        return `@page { size: 80mm ${heightMm}mm; margin: 0; } ${slipPages}`;
      },
    signal,
    silent: paper === "thermal" && silentCounterPrinting(),
  });
}

export async function printDocument(content: HTMLElement, { title, width, pageCss, signal, silent = false }: {
  title: string;
  width: string;
  pageCss: string | ((printBody: HTMLElement) => string);
  signal: AbortSignal;
  silent?: boolean;
}) {
  signal.throwIfAborted();

  // Each job contains only the material that belongs on paper.
  const job = document.implementation.createHTMLDocument(title);
  job.documentElement.lang = document.documentElement.lang;
  const base = job.createElement("base");
  base.href = document.baseURI;
  job.head.append(base);
  for (const stylesheet of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
    job.head.append(stylesheet.cloneNode(true));
  }
  job.body.append(content);

  const frame = document.createElement("iframe");
  frame.title = title;
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed; left:-10000px; top:0; width:${width}; height:1px; border:0;`;
  frame.srcdoc = "<!doctype html>" + job.documentElement.outerHTML;

  try {
    await new Promise<void>(resolve => {
      frame.addEventListener("load", () => resolve(), { once: true });
      document.body.append(frame);
    });
    signal.throwIfAborted();

    const printWindow = frame.contentWindow;
    if (!printWindow) throw new Error("Print document could not be opened.");
    await printWindow.document.fonts.load('12px "Noto Nastaliq Urdu"').catch(() => undefined);
    await printWindow.document.fonts.ready;
    signal.throwIfAborted();

    const pageStyle = printWindow.document.createElement("style");
    pageStyle.textContent = typeof pageCss === "string" ? pageCss : pageCss(printWindow.document.body);
    printWindow.document.head.append(pageStyle);

    await new Promise<void>((resolve, reject) => {
      let started = false;
      let returned = false;
      let completed = false;
      let silentTimer: number | undefined;
      const clearStartTimer = () => window.clearTimeout(startTimer);
      const cleanup = () => {
        clearStartTimer();
        window.clearTimeout(silentTimer);
        printWindow.removeEventListener("beforeprint", onBeforePrint);
        printWindow.removeEventListener("afterprint", onAfterPrint);
        signal.removeEventListener("abort", onAbort);
      };
      const onAfterPrint = () => {
        if (completed) return;
        completed = true;
        cleanup();
        resolve();
      };
      const onBeforePrint = () => { started = true; clearStartTimer(); if (silent && returned && !completed) silentTimer=window.setTimeout(onAfterPrint,2000); };
      const onAbort = () => {
        cleanup();
        reject(signal.reason);
      };
      const startTimer = window.setTimeout(() => {
        cleanup();
        reject(new Error("The browser did not start printing."));
      }, 10000);
      printWindow.addEventListener("beforeprint", onBeforePrint, { once: true });
      printWindow.addEventListener("afterprint", onAfterPrint, { once: true });
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        printWindow.print();
        returned = true;
        // Chromium kiosk printing can omit afterprint. Once print() has returned
        // and printing started, release this job after spooling; never reprint it.
        // Ordinary dialog jobs still wait for afterprint, including cancellation.
        if (silent && started && !completed) silentTimer = window.setTimeout(onAfterPrint, 2000);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  } finally {
    frame.remove();
  }
}

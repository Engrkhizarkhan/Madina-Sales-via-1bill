import { printEpsonTickets } from "./epson-ticket-printer";

export type TicketPaper = "thermal" | "a4" | "tm-t88iv";

let ticketPrintQueue = Promise.resolve();

export function printTicketBatch(source: HTMLElement, paper: TicketPaper, signal: AbortSignal) {
  const slips = Array.from(source.querySelectorAll(".passenger-receipt, .conductor-token"), slip => slip.cloneNode(true) as Element);
  if (!slips.length) return Promise.resolve();
  const printArea = document.createElement("div");
  printArea.className = "receipt thermal-ticket";
  printArea.style.maxWidth = "none";
  printArea.append(...slips);
  const slipPages = `@media print {
    body > .receipt.thermal-ticket > article { page: auto; break-after: auto; }
    body > .receipt.thermal-ticket > article + article { break-before: page; }
  }`;
  const batch = ticketPrintQueue.then(() => paper === "tm-t88iv" ? printEpsonTickets(printArea, signal) : printDocument(printArea, {
    title: slips.length > 1 ? "Madina Express tickets" : slips[0].getAttribute("aria-label") ?? "Madina Express ticket",
    width: paper === "a4" ? "210mm" : "80mm",
    pageCss: paper === "a4"
      ? `@page { size: A4 portrait; margin: 10mm; }
         @media print { body > .receipt.thermal-ticket { margin-inline: auto !important; } }
         ${slipPages}`
      : body => {
        const heightPx = Math.max(...Array.from(body.querySelectorAll(".thermal-ticket > article"), slip => slip.scrollHeight));
        const heightMm = Math.max(81, Math.ceil(heightPx * 25.4 / 96) + 2);
        return `@page { size: 80mm ${heightMm}mm; margin: 0; } ${slipPages}`;
      },
    signal,
  }));
  ticketPrintQueue = batch.catch(() => undefined);
  return batch;
}

export async function printDocument(content: HTMLElement, { title, width, pageCss, signal }: {
  title: string;
  width: string;
  pageCss: string | ((printBody: HTMLElement) => string);
  signal: AbortSignal;
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
      const clearStartTimer = () => window.clearTimeout(startTimer);
      const cleanup = () => {
        clearStartTimer();
        printWindow.removeEventListener("beforeprint", clearStartTimer);
        printWindow.removeEventListener("afterprint", onAfterPrint);
        signal.removeEventListener("abort", onAbort);
      };
      const onAfterPrint = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(signal.reason);
      };
      const startTimer = window.setTimeout(() => {
        cleanup();
        reject(new Error("The browser did not start printing."));
      }, 10000);
      printWindow.addEventListener("beforeprint", clearStartTimer, { once: true });
      printWindow.addEventListener("afterprint", onAfterPrint, { once: true });
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        printWindow.print();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  } finally {
    frame.remove();
  }
}

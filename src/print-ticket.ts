export async function printTicketSlip(slip: HTMLElement, signal: AbortSignal) {
  signal.throwIfAborted();

  // Each slip has its own document so the browser sends a separate printer job.
  const title = slip.getAttribute("aria-label") ?? "Madina Express ticket";
  const printDocument = document.implementation.createHTMLDocument(title);
  const base = printDocument.createElement("base");
  base.href = document.baseURI;
  printDocument.head.append(base);
  for (const stylesheet of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
    printDocument.head.append(stylesheet.cloneNode(true));
  }

  const heightMm = Math.ceil(slip.getBoundingClientRect().height * 25.4 / 96) + 2;
  const pageName = slip.classList.contains("conductor-token") ? "madina-boarding-pass" : "madina-passenger-ticket";
  const pageStyle = printDocument.createElement("style");
  pageStyle.textContent = `@page ${pageName} { size: 80mm ${heightMm}mm; margin: 0; }`;
  printDocument.head.append(pageStyle);

  const printArea = printDocument.createElement("div");
  printArea.className = "receipt thermal-ticket";
  printArea.append(slip.cloneNode(true));
  printDocument.body.append(printArea);

  const frame = document.createElement("iframe");
  frame.title = title;
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed; left:-10000px; top:0; width:80mm; height:1px; border:0;";
  frame.srcdoc = "<!doctype html>" + printDocument.documentElement.outerHTML;

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

    await new Promise<void>((resolve, reject) => {
      const onAfterPrint = () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        printWindow.removeEventListener("afterprint", onAfterPrint);
        reject(signal.reason);
      };
      printWindow.addEventListener("afterprint", onAfterPrint, { once: true });
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        printWindow.print();
      } catch (error) {
        printWindow.removeEventListener("afterprint", onAfterPrint);
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    });
  } finally {
    frame.remove();
  }
}

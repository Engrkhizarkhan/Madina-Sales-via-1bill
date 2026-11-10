export function printTicketSlip(slip: HTMLElement, signal: AbortSignal) {
  const heightMm = Math.ceil(slip.getBoundingClientRect().height * 25.4 / 96) + 2;
  const pageName = slip.classList.contains("conductor-token") ? "madina-boarding-pass" : "madina-passenger-ticket";
  const printArea = document.createElement("div");
  printArea.className = "receipt thermal-ticket";
  printArea.append(slip.cloneNode(true));
  return printDocument(printArea, {
    title: slip.getAttribute("aria-label") ?? "Madina Express ticket",
    width: "80mm",
    pageCss: `@page ${pageName} { size: 80mm ${heightMm}mm; margin: 0; }`,
    signal,
  });
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

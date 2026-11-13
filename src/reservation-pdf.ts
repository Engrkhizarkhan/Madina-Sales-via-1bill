export const downloadReservationPdf = (card:HTMLElement,reference:string) => downloadPdf(card,reference,"Reservation");
export const downloadJourneyPdf = (card:HTMLElement,reference:string) => downloadPdf(card,reference,"Journey");

async function downloadPdf(card: HTMLElement, reference: string, kind: string) {
  const [{ toCanvas }, { PDFDocument }] = await Promise.all([
    import("html-to-image"), import("pdf-lib"),
  ]);
  await document.fonts.ready;
  const printArea = document.createElement("div");
  printArea.style.cssText = "position:fixed;top:0;left:-10000px;width:640px;";
  printArea.setAttribute("aria-hidden", "true");
  const copy = card.cloneNode(true) as HTMLElement;
  copy.classList.add("reservation-pdf-card");
  copy.querySelectorAll("button").forEach(button=>button.remove());
  printArea.append(copy);
  document.body.append(printArea);

  const canvas = await toCanvas(copy, { backgroundColor: "#ffffff", pixelRatio: 2, skipFonts: true })
    .finally(() => printArea.remove());
  const documentPdf = await PDFDocument.create();
  documentPdf.setTitle(`Madina Express ${kind} Details`);
  const image = await documentPdf.embedPng(canvas.toDataURL("image/png"));
  const page = documentPdf.addPage([595.28, 841.89]);
  const scale = Math.min((page.getWidth() - 72) / image.width, (page.getHeight() - 72) / image.height, 0.75 / 2);
  const { width, height } = image.scale(scale);
  page.drawImage(image, { x: (page.getWidth() - width) / 2, y: page.getHeight() - 36 - height, width, height });
  const bytes = await documentPdf.save();
  const file = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Madina-Express-${kind}-${reference}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

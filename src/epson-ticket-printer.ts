const epsonUsbId = { vendorId: 0x04b8, productId: 0x0202 };
const printableDots = 512;

function isTicketPrinter(device: USBDevice) {
  return device.vendorId === epsonUsbId.vendorId && device.productId === epsonUsbId.productId
    && device.productName === "TM-T88IV";
}

async function openPrinter(device: USBDevice) {
  await device.open();
  if (!device.configuration) await device.selectConfiguration(device.configurations[0].configurationValue);
  for (const usbInterface of device.configuration?.interfaces ?? []) {
    const endpoint = usbInterface.alternate.endpoints.find(item => item.direction === "out" && item.type === "bulk");
    if (endpoint) {
      await device.claimInterface(usbInterface.interfaceNumber);
      return endpoint.endpointNumber;
    }
  }
  throw new Error("The TM-T88IV USB print interface is unavailable.");
}

export async function connectEpsonTicketPrinter() {
  if (!navigator.usb) throw new Error("Open Madina Express in Chrome or Edge to connect the USB printer.");
  const printer = await navigator.usb.requestDevice({ filters: [epsonUsbId] });
  if (!isTicketPrinter(printer)) throw new Error("Select the Epson TM-T88IV.");
  try {
    await openPrinter(printer);
  } finally {
    if (printer.opened) await printer.close();
  }
}

function rasterize(canvas: HTMLCanvasElement) {
  const { width, height } = canvas;
  const pixels = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
  const bytesPerRow = width / 8;
  const bytes = new Uint8Array(8 + bytesPerRow * height);
  // GS v 0 prints the raster at the TM-T88IV's native density.
  bytes.set([0x1d, 0x76, 0x30, 0, bytesPerRow, 0, height & 0xff, height >> 8]);
  for (let index = 0; index < width * height; index++) {
    const offset = index * 4;
    const luminance = (pixels[offset] * 299 + pixels[offset + 1] * 587 + pixels[offset + 2] * 114) / 1000;
    if (luminance < 180) bytes[8 + (index >> 3)] |= 0x80 >> (index & 7);
  }
  return bytes;
}

export async function printEpsonTickets(source: HTMLElement, signal: AbortSignal) {
  const printer = (await navigator.usb?.getDevices())?.find(isTicketPrinter);
  if (!printer) throw new Error("Connect the TM-T88IV under Settings → Receipt configuration, then reprint the ticket.");
  signal.throwIfAborted();

  const { getFontEmbedCSS, toCanvas } = await import("html-to-image");
  const rasters: Uint8Array<ArrayBuffer>[] = [];
  source.style.cssText = "position:fixed;left:-10000px;top:0;max-width:none;margin:0;box-shadow:none;";
  document.body.append(source);
  try {
    await document.fonts.ready;
    const fontEmbedCSS = await getFontEmbedCSS(source);
    for (const slip of source.querySelectorAll<HTMLElement>("article")) {
      signal.throwIfAborted();
      const { width, height } = slip.getBoundingClientRect();
      const canvas = await toCanvas(slip, {
        backgroundColor: "white",
        canvasWidth: printableDots,
        canvasHeight: Math.ceil(height * printableDots / width),
        pixelRatio: 1,
        fontEmbedCSS,
      });
      rasters.push(rasterize(canvas));
    }
  } finally {
    source.remove();
  }

  try {
    const endpoint = await openPrinter(printer);
    const send = async (bytes: Uint8Array<ArrayBuffer>) => {
      const result = await printer.transferOut(endpoint, bytes);
      if (result.status !== "ok" || result.bytesWritten !== bytes.length) {
        throw new Error("USB printing stopped. Check the printer and reprint any missing slips.");
      }
    };
    signal.throwIfAborted();
    await send(Uint8Array.of(0x1b, 0x40));
    for (const raster of rasters) {
      for (let offset = 0; offset < raster.length; offset += 4096) {
        await send(raster.subarray(offset, offset + 4096));
      }
      // GS V 66 feeds to the cutter and makes one tear-off cut per slip.
      await send(Uint8Array.of(0x1d, 0x56, 66, 0));
    }
  } finally {
    if (printer.opened) await printer.close();
  }
}

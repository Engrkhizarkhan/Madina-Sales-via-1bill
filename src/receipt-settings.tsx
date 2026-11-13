import { createContext, useContext } from "react";
import { receiptDefaults, type ReceiptLayout } from "../shared/receipt-layout.mjs";
export const ReceiptSettingsContext = createContext<{layout:ReceiptLayout;save:(layout:ReceiptLayout)=>Promise<void>}>({layout:{...receiptDefaults},save:async()=>{}});
export const useReceiptSettings = () => useContext(ReceiptSettingsContext);

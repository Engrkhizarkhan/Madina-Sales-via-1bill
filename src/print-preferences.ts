import {createContext,useCallback,useContext,useEffect,useState} from 'react';
import {api} from './api';
export type TerminalPrintPolicy={slot:number|null;managed:boolean;autoPrint:boolean;preview:boolean};
export type PrintSettingsPayload={own:TerminalPrintPolicy;terminals?:(TerminalPrintPolicy&{slot:number})[]};
export const PrintPreferencesContext=createContext<{own:TerminalPrintPolicy|null;refresh:()=>Promise<void>}>({own:null,refresh:async()=>{}});
export const usePrintPreferences=()=>useContext(PrintPreferencesContext);
export function useManagedPrinting(){
 const [own,setOwn]=useState<TerminalPrintPolicy|null>(null);
 const refresh=useCallback(async()=>{try{const value=await api.printingSettings();setOwn(current=>JSON.stringify(current)===JSON.stringify(value.own)?current:value.own);}catch{/* Keep the last known setting through brief reconnections. */}},[]);
 useEffect(()=>{const initial=setTimeout(()=>void refresh(),0);const check=()=>{if(!document.hidden)void refresh();};const timer=setInterval(check,5000);window.addEventListener('focus',check);window.addEventListener('madina-print-settings-changed',check);return()=>{clearTimeout(initial);clearInterval(timer);window.removeEventListener('focus',check);window.removeEventListener('madina-print-settings-changed',check);};},[refresh]);
 return {own,refresh};
}

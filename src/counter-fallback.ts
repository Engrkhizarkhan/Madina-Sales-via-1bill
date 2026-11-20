import {onlineCounterUrl,onlineCounterPreferences,type CounterPrintPreferences} from '../shared/counter-fallback.mjs';
import {terminalOrigin} from '../shared/domains.mjs';

export function onlineCounterLink() {
  const preferences:CounterPrintPreferences={};
  try{
    const auto=localStorage.getItem('madina.autoPrintTickets'),paper=localStorage.getItem('madina.ticketPaper');
    if(auto==='true'||auto==='false')preferences.autoPrint=auto==='true';
    if(paper==='thermal'||paper==='tm-t88iv'||paper==='a4')preferences.paper=paper;
  }catch{/* The fallback remains usable when browser storage is disabled. */}
  return onlineCounterUrl(window.location.href,preferences);
}

export function restoreOnlineCounterPreferences() {
  const preferences=onlineCounterPreferences(window.location.href);
  if(!preferences)return;
  try{
    if(preferences.autoPrint!==undefined)localStorage.setItem('madina.autoPrintTickets',String(preferences.autoPrint));
    if(preferences.paper)localStorage.setItem('madina.ticketPaper',preferences.paper);
    if(preferences.reports)sessionStorage.setItem('madina-open-reports','true');
  }catch{/* Storage restrictions must not prevent the login page from opening. */}
}

export async function tryOnlineCounter(signal:AbortSignal) {
  const href=onlineCounterLink();
  if(!href||navigator.onLine===false||signal.aborted)return false;
  const reachable=await new Promise<boolean>(resolve=>{
    const image=new Image();let finished=false;
    const done=(ok:boolean)=>{if(finished)return;finished=true;window.clearTimeout(timer);signal.removeEventListener('abort',abort);image.onload=null;image.onerror=null;resolve(ok);};
    const abort=()=>done(false);
    const timer=window.setTimeout(()=>done(false),4000);
    image.onload=()=>done(true);image.onerror=()=>done(false);image.referrerPolicy='no-referrer';
    signal.addEventListener('abort',abort,{once:true});
    image.src=terminalOrigin+'/favicon.svg?counter-check='+Date.now();
  });
  if(!reachable||signal.aborted)return false;
  window.location.assign(href);return true;
}

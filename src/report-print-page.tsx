import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {printDocument} from './print-document';
import {validateReportTree,type ReportNode} from '../shared/report-print.mjs';
type PrintJob={title:string;orientation:'portrait'|'landscape';document:ReportNode};
const claims=new Map<string,Promise<PrintJob>>();
function element(node:ReportNode):Node{
 if(typeof node==='string')return document.createTextNode(node);
 const item=document.createElement(node.tag);for(const [key,value]of Object.entries(node.attrs))item.setAttribute(key,value);
 item.append(...node.children.map(element));return item;
}
export function ReportPrintPage(){
 const [request]=useState(()=>window.location.hash.slice(1));const [job,setJob]=useState<PrintJob|null>(null);const [error,setError]=useState('');const [done,setDone]=useState(false);const [busy,setBusy]=useState(false);
 const source=useRef<HTMLDivElement>(null),started=useRef(false);
 useEffect(()=>{const next=()=>{if(window.location.hash)window.location.reload();};window.addEventListener('hashchange',next);return()=>window.removeEventListener('hashchange',next);},[]);
 useEffect(()=>{
  let active=true;
  window.history.replaceState(null,'',window.location.pathname);
  const match=request.match(/^([a-f0-9]{64})\.([a-f0-9]{64})$/);
  if(!match)return;
  let pending=claims.get(request);
  if(!pending){pending=api.claimPrintJob<PrintJob>(match[1],match[2]);claims.set(request,pending);if(claims.size>5)claims.delete(claims.keys().next().value!);}
  pending.then(value=>{if(active){value.document=validateReportTree(value.document);setJob(value);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'The report could not be opened.');});
  return()=>{active=false;};
 },[request]);
 async function print(value:PrintJob){
  if(!source.current)return;setBusy(true);setError('');
  const content=element(value.document) as HTMLElement;source.current.replaceChildren(content);
  try{
   await printDocument(content.cloneNode(true) as HTMLElement,{title:value.title,width:value.orientation==='portrait'?'210mm':'297mm',pageCss:`@page { size: A4 ${value.orientation}; margin: 8mm; }`,signal:new AbortController().signal});
   setDone(true);window.close();
  }catch(e){setError(e instanceof Error?e.message:'The printer dialog could not open.');}finally{setBusy(false);}
 }
 useEffect(()=>{if(job&&!started.current){started.current=true;void print(job);}},[job]);
 return <main style={{padding:'24px',maxWidth:'900px',margin:'auto'}}><h1>{job?.title||'A4 printing'}</h1><p>{done?'Finished. Return to the Counter window.':busy?'Choose your A4 printer in the print dialog.':'Preparing the printer dialog…'}</p>{(error||!request.match(/^[a-f0-9]{64}\.[a-f0-9]{64}$/))&&<p role="alert">{error||"Open this report using Print on the Counter page."}</p>}{job&&!busy&&<button onClick={()=>void print(job)}>Open printer dialog</button>}<button onClick={()=>window.close()}>Close</button><div ref={source} style={{position:'fixed',left:'-12000px',width:job?.orientation==='portrait'?'210mm':'297mm'}}/></main>;
}

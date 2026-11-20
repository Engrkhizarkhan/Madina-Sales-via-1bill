import {api} from './api';
import {staffOrigin,terminalOrigin} from '../shared/domains.mjs';
import {validateReportTree,reportProtocol,type ReportNode} from '../shared/report-print.mjs';
export function reportBridgeConfigured(){
 const configured=new URLSearchParams(window.location.search).get('a4Bridge')==='1';
 try{if(configured)sessionStorage.setItem('madina-a4-bridge','true');return configured||sessionStorage.getItem('madina-a4-bridge')==='true';}catch{return configured;}
}
function reportNode(node:Node):ReportNode{
 if(node.nodeType===Node.TEXT_NODE)return node.textContent||'';
 if(!(node instanceof HTMLElement))throw Error('This report contains an unsupported element.');
 const attrs:Record<string,string>={};
 for(const name of ['class','lang','dir','colspan','rowspan'])if(node.hasAttribute(name))attrs[name]=node.getAttribute(name)!;
 if(['COL','ARTICLE'].includes(node.tagName)&&node.hasAttribute('style'))attrs.style=node.getAttribute('style')!.trim();
 return {tag:node.tagName.toLowerCase(),attrs,children:Array.from(node.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE||n.nodeType===Node.ELEMENT_NODE).map(reportNode)};
}
export async function openA4Report(source:HTMLElement,title:string,orientation:'portrait'|'landscape',signal:AbortSignal){
 if(!reportBridgeConfigured())throw Error('Update the Counter shortcuts once to enable A4 printer selection here. Use Download printing setup below.');
 const document=validateReportTree(reportNode(source));
 const job=await api.createPrintJob<{id:string;key:string}>({title,orientation,document},signal);
 signal.throwIfAborted();
 const url=reportProtocol(window.location.origin===terminalOrigin?staffOrigin:window.location.origin,job.id,job.key);
 const link=window.document.createElement('a');link.href=url;link.hidden=true;window.document.body.append(link);link.click();link.remove();
 return url;
}

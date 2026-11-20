// An inert report tree, never executable HTML, URLs, images or arbitrary CSS.
function voucherStyleAllowed(value){
 const rules={'--voucher-font':/^(Arial|Tahoma|Georgia|Times New Roman)$/,'--voucher-font-size':/^(?:\d+(?:\.\d+)?|\.\d+)px$/,'--voucher-heading-size':/^(?:\d+(?:\.\d+)?|\.\d+)px$/,'--voucher-padding-x':/^(?:\d+(?:\.\d+)?|\.\d+)mm$/,'--voucher-padding-y':/^(?:\d+(?:\.\d+)?|\.\d+)mm$/,'--voucher-line-height':/^(?:\d+(?:\.\d+)?|\.\d+)$/,'--voucher-row-padding':/^(?:\d+(?:\.\d+)?|\.\d+)px$/};
 const entries=value.split(';').map(part=>part.trim()).filter(Boolean);const seen=new Set();
 return entries.length>0&&entries.length<=7&&entries.every(part=>{const [key,val,...extra]=part.split(':').map(x=>x.trim());if(extra.length||seen.has(key)||!rules[key]?.test(val))return false;seen.add(key);return true;});
}
const tags=new Set(['article','header','footer','section','div','span','p','strong','small','b','em','h1','h2','h3','table','colgroup','col','thead','tbody','tfoot','tr','th','td','br','hr','ul','ol','li']);
export function validateReportTree(input){
 let count=0,characters=0;
 function node(value,depth){
  if(++count>10000||depth>30)throw Error('The report is too large.');
  if(typeof value==='string'){characters+=value.length;if(characters>180000)throw Error('The report is too large.');return value;}
  if(!value||typeof value!=='object'||Array.isArray(value)||!tags.has(value.tag)||!Array.isArray(value.children))throw Error('Invalid report content.');
  if(Object.keys(value).some(k=>!['tag','attrs','children'].includes(k)))throw Error('Invalid report content.');
  const attrs={};
  for(const [key,val] of Object.entries(value.attrs||{})){
   if(typeof val!=='string')throw Error('Invalid report attribute.');
   const valid=key==='class'?/^[a-zA-Z0-9_\s-]{0,300}$/.test(val):key==='lang'?/^(en|ur)$/.test(val):key==='dir'?/^(rtl|ltr|auto)$/.test(val):['colspan','rowspan'].includes(key)?/^[1-9][0-9]?$/.test(val):key==='style'&&value.tag==='article'?voucherStyleAllowed(val):key==='style'&&value.tag==='col'?/^width:\s*(?:100|[0-9]{1,2})(?:\.\d{1,2})?%;?$/.test(val):false;
   if(!valid)throw Error('Invalid report attribute.');attrs[key]=val;
  }
  return {tag:value.tag,attrs,children:value.children.map(child=>node(child,depth+1))};
 }
 const result=node(input,0);if(typeof result==='string'||result.tag!=='article')throw Error('Invalid report document.');return result;
}
export function reportProtocol(origin,id,key){
 if(!/^[a-f0-9]{64}$/.test(id)||!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid print job.');
 const url=new URL(origin);if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw Error('Invalid report server.');
 return 'madina-report://print/?origin='+encodeURIComponent(url.origin)+'&job='+id+'&key='+key;
}

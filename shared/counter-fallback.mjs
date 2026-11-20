// Self-contained so the same allowlisted URL builder can run before React loads.
export function onlineCounterUrl(href,preferences={}) {
  try {
    const source=new URL(href),parts=source.hostname.split('.').map(Number);
    if(source.protocol!=='https:'||source.username||source.password||source.port!=='8443'||parts.length!==4||parts.some(n=>!Number.isInteger(n)||n<0||n>255)||
      !(parts[0]===10||parts[0]===192&&parts[1]===168||parts[0]===172&&parts[1]>=16&&parts[1]<=31)||
      !['/manage','/login'].includes(source.pathname))return null;
    const target=new URL('https://terminal.madinaexpress.pk/login');
    target.searchParams.set('counterFallback','lan');
    for(const [key,allowed] of [['counterPrint',['silent','dialog']],['a4Bridge',['1']],['view',['reports']]]){
      const value=source.searchParams.get(key);if(allowed.includes(value))target.searchParams.set(key,value);
    }
    if(typeof preferences.autoPrint==='boolean')target.searchParams.set('fallbackAutoPrint',preferences.autoPrint?'1':'0');
    if(['thermal','tm-t88iv','a4'].includes(preferences.paper))target.searchParams.set('fallbackPaper',preferences.paper);
    return target.href;
  }catch{return null;}
}

export function onlineCounterPreferences(href) {
  try{
    const url=new URL(href);
    if(url.origin!=='https://terminal.madinaexpress.pk'||!['/login','/manage'].includes(url.pathname)||url.searchParams.get('counterFallback')!=='lan')return null;
    const auto=url.searchParams.get('fallbackAutoPrint'),paper=url.searchParams.get('fallbackPaper');
    return {autoPrint:auto==='1'?true:auto==='0'?false:undefined,paper:['thermal','tm-t88iv','a4'].includes(paper)?paper:undefined,reports:url.searchParams.get('view')==='reports'};
  }catch{return null;}
}

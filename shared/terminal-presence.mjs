export function presenceSummary(contacts,sourceReachable,enrolled){
  const ordered=[...contacts].sort((a,b)=>a.ageMs-b.ageMs),fresh=ordered.filter(row=>row.ageMs<90000);
  const latest=fresh.find(row=>row.phase==='ready')||ordered[0];
  const status=!enrolled?'not-enrolled':!sourceReachable?'unknown':!latest?'never-seen':!fresh.length?'offline':latest.phase==='ready'?'online':'opening';
  return {status,lastSeen:ordered[0]?.lastSeen||null,ageMs:ordered[0]?.ageMs??null,transport:latest?.transport||null,phase:latest?.phase||null,
    rttMs:latest?.rtt_ms??null,downloadMbps:latest?.download_mbps??null,lossPct:latest?.loss_pct??null,probeOk:latest?.probe_ok==null?null:Boolean(latest.probe_ok),version:latest?.version||null,
    localOpening:fresh.some(row=>row.transport==='lan'&&row.phase==='opening')&&fresh.some(row=>row.phase==='ready')};
}
export function qualityBars(value){
  if(!['online','opening'].includes(value.status))return 0;
  if(value.probeOk===false||value.lossPct>=25||value.downloadMbps!==null&&value.downloadMbps<.5)return 1;
  if(value.rttMs===null)return 0;
  if(value.rttMs>500||value.lossPct>10)return 1;
  if(value.rttMs>200||value.lossPct>0||value.downloadMbps!==null&&value.downloadMbps<2)return 2;
  if(value.rttMs>100||value.downloadMbps!==null&&value.downloadMbps<10)return 3;
  return 4;
}

// Self-contained: this also runs from the small startup file if the app bundle stalls.
export function startCounterPresence(version){
  try{
    const here=new URL(location.href),ip=here.hostname.split('.').map(Number);
    const local=here.protocol==='https:'&&here.port==='8443'&&ip.length===4&&(ip[0]===10||ip[0]===192&&ip[1]===168||ip[0]===172&&ip[1]>=16&&ip[1]<=31);
    const remote=here.origin==='https://terminal.madinaexpress.pk';
    if(!local&&!remote||!['/login','/manage'].includes(here.pathname))return;
    let instance;
    try{instance=sessionStorage.getItem('madina-presence-instance');if(!/^[a-f0-9]{32}$/.test(instance||'')){instance=crypto.randomUUID().replaceAll('-','');sessionStorage.setItem('madina-presence-instance',instance);}}
    catch{instance=crypto.randomUUID().replaceAll('-','');}
    let stopped=false,timer,probeDue=Date.now()+5000,rttMs=null,downloadMbps=null,probeOk=null;
    const outcomes=[];const controllers=new Set();
    const request=async(path,options,timeout)=>{
      const control=new AbortController();controllers.add(control);const limit=setTimeout(()=>control.abort(),timeout);
      try{const response=await fetch('/api/terminal/presence/'+path,{credentials:'include',cache:'no-store',...options,signal:control.signal});await response.arrayBuffer();return response;}
      finally{clearTimeout(limit);controllers.delete(control);}
    };
    const ping=async()=>{
      if(stopped)return;
      const started=performance.now();
      const root=document.getElementById('root');
      const phase=root&&Array.from(root.children).some(child=>!child.hasAttribute('data-madina-startup'))?'ready':'opening';
      try{
        const response=await request('heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instance,phase,version,rttMs,downloadMbps,probeOk,lossPct:outcomes.length?outcomes.filter(ok=>!ok).length/outcomes.length*100:null})},4000);
        if([401,403,404].includes(response.status)){stopped=true;return;}
        if(!response.ok)throw Error('contact failed');rttMs=Math.round(performance.now()-started);outcomes.push(true);
      }catch{outcomes.push(false);}
      if(outcomes.length>8)outcomes.shift();
      if(!stopped)timer=setTimeout(ping,15000);
    };
    const probe=async()=>{
      if(stopped)return;
      if(Date.now()>=probeDue&&document.visibilityState!=='hidden'){
        probeDue=Date.now()+60000;
        const start=performance.now();
        try{
          // Read the complete body within the deadline, not just its headers.
          const controller=new AbortController();controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),8000);
          try{
            const response=await fetch('/api/terminal/presence/probe?check='+Date.now(),{credentials:'include',cache:'no-store',signal:controller.signal});
            const bytes=await response.arrayBuffer();if(!response.ok||bytes.byteLength!==98304)throw Error('incomplete transfer');
            downloadMbps=Math.round(bytes.byteLength*8/Math.max(1,performance.now()-start)/1000*1000)/1000;probeOk=true;
          }finally{clearTimeout(timeout);controllers.delete(controller);}
        }catch{downloadMbps=null;probeOk=false;}
      }
      if(!stopped)setTimeout(probe,5000);
    };
    setTimeout(ping,250);setTimeout(probe,5000);
    addEventListener('pagehide',event=>{if(event.persisted)return;stopped=true;clearTimeout(timer);for(const controller of controllers)controller.abort();},{once:true});
  }catch{/* Diagnostics must never prevent the counter from opening. */}
}

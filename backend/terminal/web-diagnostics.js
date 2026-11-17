import https from 'node:https';
import {createHash,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {networkInterfaces} from 'node:os';
import {config} from '../node/config.js';

export function diagnosticsAllowed(req,terminal=config.terminal) {
  if(!terminal.local||req.socket.encrypted||!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress))return false;
  const expected=Buffer.from(terminal.relayKey||''),actual=Buffer.from(req.get('X-Madina-Diagnostic-Key')||'');
  return expected.length===64&&actual.length===expected.length&&timingSafeEqual(actual,expected);
}

// Fixed public build files only: no cookies, customer records, commands or
// caller-provided URLs. Verify the installed CA and localhost certificate.
export function probeWebFile({port,ca,path,expected,version,timeout=5000}) {
  return new Promise(resolveResult=>{
    const started=performance.now(),hash=createHash('sha256');
    let bytes=0,status=null,complete=false,protocol=null,finished=false;
    const done=error=>{
      if(finished)return;finished=true;clearTimeout(timer);
      resolveResult({path,version,status,bytes,expectedBytes:expected.length,complete,
        matches:!error&&status===200&&complete&&bytes===expected.length&&hash.digest('hex')===createHash('sha256').update(expected).digest('hex'),
        milliseconds:Math.round(performance.now()-started),protocol,error:error||null});
    };
    const request=https.get({hostname:'localhost',family:4,port,path,ca,agent:false,
      minVersion:version,maxVersion:version,headers:{'Cache-Control':'no-cache'}},response=>{
      status=response.statusCode;protocol=response.socket.getProtocol();
      response.on('data',chunk=>{
        bytes+=chunk.length;hash.update(chunk);
        if(bytes>4*1024*1024){done('RESPONSE_TOO_LARGE');request.destroy();}
      });
      response.once('end',()=>{complete=response.complete;done();});
      response.once('aborted',()=>done('RESPONSE_ABORTED'));
      response.once('error',error=>done(error.code||'RESPONSE_ERROR'));
    });
    const timer=setTimeout(()=>{done('TRANSFER_TIMEOUT');request.destroy();},timeout);
    request.once('error',error=>done(error.code||'CONNECTION_ERROR'));
  });
}

export async function inspectTerminalWeb({directory=resolve('dist'),terminal=config.terminal,timeout=5000}={}) {
  const html=await readFile(join(directory,'index.html'),'utf8');
  const files=[...html.matchAll(/(?:src|href)="(\/assets\/[A-Za-z0-9_.-]+\.(?:js|css))"/g)].map(match=>match[1]);
  const paths=[...new Set(['/startup.js',...files])].slice(0,4);
  const ca=await readFile(join(terminal.directory,'tls','ca.crt'));
  const probes=[];
  for(const path of paths){
    const expected=await readFile(join(directory,path.slice(1)));
    // The entry file is tested over both versions to isolate TLS-specific stalls.
    for(const version of path.startsWith('/assets/')&&path.endsWith('.js')?['TLSv1.2','TLSv1.3']:['TLSv1.3']){
      probes.push(probeWebFile({port:terminal.httpsPort,ca,path,expected,version,timeout}));
    }
  }
  const host=new URL(terminal.localOrigin).hostname;
  const adapters=Object.entries(networkInterfaces()).flatMap(([name,addresses])=>(addresses||[])
    .filter(address=>!address.internal&&address.address===host)
    .map(address=>({name,address:address.address,netmask:address.netmask,mac:address.mac})));
  return {checkedAt:new Date().toISOString(),node:process.version,openssl:process.versions.openssl,
    platform:process.platform,localOrigin:terminal.localOrigin,adapters,files:await Promise.all(probes)};
}

export function webDiagnosticsHandler({terminal=config.terminal,inspect=inspectTerminalWeb,ttl=30000}={}) {
  let cached,pending,checkedAt=0;
  return async(req,res,next)=>{
    if(!diagnosticsAllowed(req,terminal))return res.status(403).json({error:{code:'forbidden',message:'Protected operator diagnostics are required.'}});
    try{
      if(!cached||Date.now()-checkedAt>=ttl){
        if(!pending)pending=Promise.resolve().then(inspect).then(result=>{cached=result;checkedAt=Date.now();return result;}).finally(()=>{pending=null;});
        await pending;
      }
      res.set('Cache-Control','no-store').json(cached);
    }catch(error){next(error);}
  };
}

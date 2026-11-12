// Only Node built-ins: this verifier is installed outside the writable application data.
import { verify, createHash } from 'node:crypto';
export const project='madina-express';
export const maxPackageBytes=100*1024*1024;
export function verifyRelease(envelope,publicKey,{minimumSequence=0,now=Date.now()}={}) {
 if(!envelope||typeof envelope.payload!=='string'||typeof envelope.signature!=='string'||envelope.payload.length>32768)throw new Error('Invalid signed release');
 if(!verify(null,Buffer.from(envelope.payload),publicKey,Buffer.from(envelope.signature,'base64')))throw new Error('Release signature is invalid');
 const release=JSON.parse(envelope.payload);
 if(release.project!==project||!/^r-[a-f0-9]{12,40}$/.test(release.releaseId)||!/^[a-f0-9]{40}$/.test(release.commit)||!/^\d+\.\d+\.\d+$/.test(release.version))throw new Error('Invalid release identity');
 if(!release.commit.startsWith(release.releaseId.slice(2)))throw new Error('Release commit mismatch');
 if(!Number.isSafeInteger(release.sequence)||release.sequence<1||release.sequence<minimumSequence)throw new Error('Older releases cannot replace the installed version');
 if(!Number.isFinite(Date.parse(release.createdAt))||!Number.isFinite(Date.parse(release.expiresAt))||Date.parse(release.expiresAt)<=now||Date.parse(release.createdAt)>now+300000)throw new Error('Release metadata is expired or dated in the future');
 if(!/^[a-f0-9]{64}$/.test(release.sha256)||!Number.isSafeInteger(release.bytes)||release.bytes<1||release.bytes>maxPackageBytes||release.file!==release.releaseId+'.zip')throw new Error('Invalid release package');
 if(!Array.isArray(release.migrations)||release.migrations.length>100||release.migrations.some(item=>!/^\d+_[a-z0-9_]+\.sql$/.test(item.name)||!/^([a-f0-9]{64})$/.test(item.sha256)))throw new Error('Invalid schema metadata');
 if(release.schemaBackwardsCompatible!==true)throw new Error('This release requires a supervised database upgrade');
 return release;
}
export function verifyPackage(bytes,release){if(bytes.length!==release.bytes||createHash('sha256').update(bytes).digest('hex')!==release.sha256)throw new Error('Release download is incomplete or corrupted');}
export function zipEntries(bytes){
 // Validate the central directory before any platform extractor touches the archive.
 let end=-1;
 for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)if(bytes.readUInt32LE(at)===0x06054b50){end=at;break;}
 if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==bytes.readUInt16LE(end+10))throw new Error('Unsupported ZIP archive');
 const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16);
 if(start+size>end||count>30000)throw new Error('Invalid ZIP directory');
 let at=start,total=0;const names=new Set();
 for(let i=0;i<count;i++){
  if(at+46>start+size||bytes.readUInt32LE(at)!==0x02014b50)throw new Error('Invalid ZIP entry');
  const nameLength=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),mode=bytes.readUInt32LE(at+38)>>>16;
  const name=bytes.subarray(at+46,at+46+nameLength).toString('utf8');
  if(!name||name.includes('\\')||name.includes(':')||name.startsWith('/')||name.split('/').some(part=>part==='..'||part==='.'||part.startsWith('.env')||part==='.git')||/[\x00-\x1f]/.test(name)||(mode&0xf000)===0xa000||names.has(name.toLowerCase()))throw new Error('Unsafe ZIP path');
  total+=bytes.readUInt32LE(at+24);if(total>700*1024*1024)throw new Error('ZIP archive is too large');
  names.add(name.toLowerCase());at+=46+nameLength+extra+comment;
 }
 if(!names.has('package.json')||!names.has('backend/node/server.js')||!names.has('dist/index.html')||!names.has('build-info.json'))throw new Error('Release application files are missing');
 return [...names];
}
export async function fetchBounded(url,maxBytes,options={}){
 const response=await fetch(url,{...options,signal:AbortSignal.timeout(180000),redirect:options.redirect||'error'});
 if(!response.ok)throw new Error(`Download returned ${response.status}`);
 if(Number(response.headers.get('content-length'))>maxBytes)throw new Error('Download exceeds allowed size');
 const chunks=[];let size=0;
 for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)throw new Error('Download exceeds allowed size');chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks);
}

import {createRequire} from 'node:module';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {webcrypto,createPrivateKey,X509Certificate} from 'node:crypto';
import {isIP} from 'node:net';

// Runs only from the elevated repair tool. Keep the CA and server private keys,
// names, expiry dates and extensions; correct only a future notBefore date.
export async function repairCertificateDates(application,directory,ip,{now=Date.now(),checkOnly=false}={}) {
  if(isIP(ip)!==4||!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip))throw Error('The installed main PC address is not a private IPv4 address.');
  const require=createRequire(join(resolve(application),'package.json'));
  require('reflect-metadata');const x509=require('@peculiar/x509');
  const caPem=await readFile(join(directory,'ca.crt'),'utf8'),serverPem=await readFile(join(directory,'server.crt'),'utf8');
  const ca=new X509Certificate(caPem),server=new X509Certificate(serverPem);
  if(!ca.ca||!ca.verify(ca.publicKey)||!server.checkIssued(ca)||!server.verify(ca.publicKey))throw Error('The local certificate chain is invalid. No certificates were changed.');
  if(!server.checkPrivateKey(createPrivateKey(await readFile(join(directory,'server.key'),'utf8'))))throw Error('The server private key does not match its certificate. No certificates were changed.');
  if(server.checkIP(ip)!==ip)throw Error('The certificate does not match the saved main PC IP. Run Change-Main-PC-Network.cmd with the correct address.');
  if(Date.parse(ca.validTo)<=now||Date.parse(server.validTo)<=now)throw Error('A local certificate has expired. This date repair does not extend expired certificates.');
  const futureCa=Date.parse(ca.validFrom)>now,futureServer=Date.parse(server.validFrom)>now;
  const result={caValidFrom:ca.validFrom,serverValidFrom:server.validFrom,futureCa,futureServer,changed:false,ip};
  if(checkOnly||(!futureCa&&!futureServer))return result;
  const algorithm={name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'};
  const caKeyPem=await readFile(join(directory,'ca.key'),'utf8');
  if(!ca.checkPrivateKey(createPrivateKey(caKeyPem)))throw Error('The CA private key does not match its certificate.');
  const key=await webcrypto.subtle.importKey('pkcs8',Buffer.from(caKeyPem.replace(/-----[^-]+-----|\s/g,''),'base64'),algorithm,false,['sign']);
  const pending=[];
  if(futureCa){
    const original=new x509.X509Certificate(caPem);
    const updated=await x509.X509CertificateGenerator.createSelfSigned({serialNumber:original.serialNumber,name:original.subject,keys:{privateKey:key,publicKey:await original.publicKey.export()},signingAlgorithm:algorithm,notBefore:new Date(now-300000),notAfter:original.notAfter,extensions:original.extensions});
    const pem=updated.toString('pem'),check=new X509Certificate(pem);
    if(!check.ca||!check.verify(ca.publicKey)||!check.publicKey.equals(ca.publicKey))throw Error('The repaired CA did not pass verification.');
    pending.push(['ca.crt',pem,caPem]);
  }
  if(futureServer){
    const original=new x509.X509Certificate(serverPem);
    const updated=await x509.X509CertificateGenerator.create({serialNumber:original.serialNumber,issuer:original.issuer,subject:original.subject,publicKey:await original.publicKey.export(),signingKey:key,signingAlgorithm:algorithm,notBefore:new Date(now-300000),notAfter:original.notAfter,extensions:original.extensions});
    const pem=updated.toString('pem'),check=new X509Certificate(pem);
    if(!check.verify(ca.publicKey)||!check.publicKey.equals(server.publicKey)||check.checkIP(ip)!==ip)throw Error('The repaired server certificate did not pass verification.');
    pending.push(['server.crt',pem,serverPem]);
  }
  const published=[];
  try{
    for(const [name,pem] of pending)await writeFile(join(directory,name+'.next'),pem,{mode:0o600,flag:'wx'});
    for(const [name,,original] of pending){await rename(join(directory,name+'.next'),join(directory,name));published.push([name,original]);}
  }catch(error){for(const [name,original] of published)await writeFile(join(directory,name),original,{mode:0o600});throw error;}
  finally{for(const [name] of pending)await rm(join(directory,name+'.next'),{force:true});}
  return {...result,changed:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  repairCertificateDates(process.argv[2],process.argv[3],process.argv[4],{checkOnly:process.argv.includes('--check')}).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(error.message);process.exitCode=1;});
}

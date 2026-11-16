import {createPrivateKey,randomBytes,sign} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Fixed, explicitly dispatched operation; inputs cannot name SQL, paths or code.
export function salesCleanupEnvelope({installationId,releaseId,ownerId},key,now=Date.now()) {
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(installationId||'')||!/^r-[a-f0-9]{12,40}$/.test(releaseId||'')||!Number.isSafeInteger(ownerId)||ownerId<1)throw new Error('Enter the exact installation, accepted release and protected owner ID.');
 const payload=JSON.stringify({project:'madina-express',action:'clear-test-sales',installationId,releaseId,ownerId,nonce:randomBytes(16).toString('hex'),expiresAt:now+10*60000});
 return {payload,signature:sign(null,Buffer.from(payload),key).toString('base64')};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const key=createPrivateKey(Buffer.from(process.env.MADINA_MAINTENANCE_KEY_BASE64||'','base64').toString());
 const command=salesCleanupEnvelope({installationId:process.env.INPUT_INSTALLATION_ID,releaseId:process.env.INPUT_RELEASE_ID,ownerId:Number(process.env.INPUT_OWNER_ID)},key);
 await writeFile(process.argv[2],JSON.stringify(command),{mode:0o600,flag:'wx'});
 console.log('A ten-minute, installation-bound sales-only cleanup request was signed. No live system was contacted.');
}

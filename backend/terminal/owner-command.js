import { verify } from "node:crypto";

// This is a fixed maintenance operation, not a remote shell or arbitrary SQL.
// Only the external release signing key can approve it for this exact PC/release.
export function verifyOwnerCommand(envelope,key,{installationId,releaseId,now=Date.now()}) {
  if (!envelope || typeof envelope.payload!=="string" || envelope.payload.length>2048 || typeof envelope.signature!=="string" || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature) || !verify(null,Buffer.from(envelope.payload),key,Buffer.from(envelope.signature,"base64"))) throw new Error("Invalid signed maintenance request.");
  const command=JSON.parse(envelope.payload);
  if (command.project!=="madina-express" || command.action!=="clear-test-data" || command.installationId!==installationId || command.releaseId!==releaseId || !/^[a-f0-9]{32}$/.test(command.nonce) || !Number.isSafeInteger(command.ownerId) || command.ownerId<1 || !Number.isFinite(command.expiresAt) || command.expiresAt<=now || command.expiresAt>now+15*60000) throw new Error("Maintenance request does not match this PC/release or has expired.");
  return command;
}

export async function applyOwnerCommand(envelope,options) {
  const command=verifyOwnerCommand(envelope,options.key,options);
  if (!options.begin()) return {nonce:command.nonce,stage:"waiting"};
  try {
    const owner=await options.loadOwner(command.ownerId);
    if (!owner || owner.role!=="admin" || !owner.is_owner || !owner.active) throw new Error("The protected main administrator does not match the maintenance request.");
    const result=await options.execute(owner,command);
    return {nonce:command.nonce,stage:"applied",...result};
  } finally { options.end(); }
}

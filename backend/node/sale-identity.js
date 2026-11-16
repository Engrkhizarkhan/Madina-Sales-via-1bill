import {terminalDevice} from './access.js';
import {config} from './config.js';

// Identity comes from the authenticated account and the verified connection,
// never a ticket form, a browser-provided PC name or the reservation creator.
export function saleIdentity(user, req) {
  const device=req?.socket?terminalDevice(req):'';
  const match=device.match(/^terminal-([1-9][0-9]?)(?::[a-f0-9]{64})?$/);
  const terminalSlot=match?Number(match[1]):null;
  let origin='Admin access';
  if(terminalSlot) origin=`Terminal ${terminalSlot}`;
  else if(config.terminal.local && req?.socket && !req.socket.encrypted) origin='Remote admin';
  else if(config.terminal.local && req?.socket?.encrypted &&
    (['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||(typeof req.socket.localAddress==='string'&&req.socket.remoteAddress===req.socket.localAddress))) origin='Main PC';
  return {userId:user?.id??null,name:user?.name||'Seller not recorded',terminalSlot,origin};
}

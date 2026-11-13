// Keep unchanged object identities so background refreshes do not reset inputs,
// selections, open dialogs or scroll position. A replay never creates duplicates.
export function mergeLiveRecords(current,updates=[],removed=[]) {
  if (!updates.length&&!removed.length) return current;
  const deleted=new Set(removed),pending=new Map(updates.map(record=>[record.id,record]));
  let changed=false;
  const result=[];
  for(const previous of current){
    if(deleted.has(previous.id)){changed=true;pending.delete(previous.id);continue;}
    const next=pending.get(previous.id);pending.delete(previous.id);
    if(next&&JSON.stringify(next)!==JSON.stringify(previous)){result.push(next);changed=true;}
    else result.push(previous);
  }
  if(pending.size){result.unshift(...pending.values());changed=true;}
  return changed?result:current;
}

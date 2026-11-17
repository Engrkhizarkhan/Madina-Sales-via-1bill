export function createTransferMonitor({limit=32,clock=Date.now}={}) {
  const active=new Map(),recent=[];let sequence=0;
  return {
    observe(req,res,next) {
      const address=req.socket.remoteAddress,path=req.path;
      if(req.method!=='GET'||['127.0.0.1','::ffff:127.0.0.1','::1'].includes(address)||
        !/^\/(?:assets\/[A-Za-z0-9_.-]+\.(?:js|css|ttf|woff2?)|startup\.js)$/.test(req.path)||active.size>=limit)return next();
      const id=++sequence,started=clock(),socket=req.socket,initial=socket.bytesWritten||0;
      let source;
      res.once('pipe',stream=>{source=stream;});
      const sample=()=>({path,address,startedAt:new Date(started).toISOString(),milliseconds:clock()-started,
        status:res.statusCode,expectedBytes:Number(res.getHeader('Content-Length'))||null,
        socketBytesWritten:Math.max(0,(socket.bytesWritten||0)-initial),responseBufferBytes:res.writableLength||0,
        socketBufferBytes:socket.writableLength||0,waitingForDrain:Boolean(socket.writableNeedDrain),
        finished:Boolean(res.writableFinished),closed:Boolean(socket.destroyed),protocol:socket.getProtocol?.()||null,
        source:source?{bytesRead:source.bytesRead??null,bufferBytes:source.readableLength??null,flowing:source.readableFlowing??null,
          ended:Boolean(source.readableEnded),destroyed:Boolean(source.destroyed)}:null});
      active.set(id,sample);
      let ended=false;
      const finish=event=>{if(ended)return;ended=true;recent.push({...sample(),event});active.delete(id);while(recent.length>limit)recent.shift();};
      res.once('finish',()=>finish('finish'));res.once('close',()=>finish('close'));next();
    },
    snapshot:()=>({active:[...active.values()].map(sample=>sample()),recent:[...recent]}),
  };
}
export const transferMonitor=createTransferMonitor();

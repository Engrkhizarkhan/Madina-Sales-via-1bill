import {spawn as spawnProcess} from 'node:child_process';

export const tunnelOptions=(directory,apiPort,dbPort)=>[
 '-N','-T','-i',directory+'/tunnel-key',
 '-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
 '-o','UserKnownHostsFile='+directory+'/known_hosts','-o','ExitOnForwardFailure=yes',
 '-o','ConnectTimeout=5','-o','ConnectionAttempts=1',
 '-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2',
 '-R','127.0.0.1:3201:127.0.0.1:'+apiPort,
 '-R','127.0.0.1:13306:127.0.0.1:'+dbPort,'madina-terminal@62.171.173.11',
];
export class TerminalTunnel {
 constructor({command='ssh',args,spawn=spawnProcess,schedule=setTimeout,cancel=clearTimeout,onError=()=>{}}){
  Object.assign(this,{command,args,spawn,schedule,cancel,onError});this.stopped=true;this.child=null;this.retry=null;this.killTimer=null;
 }
 start(){if(!this.stopped)return;this.stopped=false;this.connect();}
 connect(){
  if(this.stopped||this.child)return;
  this.retry=null;
  const child=this.spawn(this.command,this.args,{windowsHide:true,stdio:['ignore','ignore','pipe']});this.child=child;
  child.stderr?.on('data',data=>this.onError(String(data).trim()));
  child.on('error',error=>this.onError(error.message));
  child.once('close',()=>{
   if(this.child!==child)return;
   this.child=null;this.cancel(this.killTimer);this.killTimer=null;
   if(!this.stopped)this.retry=this.schedule(()=>this.connect(),1000);
   this.retry?.unref?.();
  });
 }
 restart(){
  if(this.stopped)return;
  if(!this.child){this.cancel(this.retry);this.retry=null;this.connect();return;}
  if(this.killTimer)return;
  const child=this.child;child.kill();
  if(this.child===child){this.killTimer=this.schedule(()=>{this.killTimer=null;if(this.child===child)child.kill('SIGKILL');},1000);this.killTimer?.unref?.();}
 }
 stop(){this.stopped=true;this.cancel(this.retry);this.cancel(this.killTimer);this.retry=null;this.killTimer=null;this.child?.kill();}
}

import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
export type PageResult<T>={rows:T[];total:number;page:number;size:number;pages:number;amount?:number};
export function useRecordPage<T>(path:string,filters:Record<string,string|number|undefined>){
 const key=JSON.stringify(filters);
 const [position,setPosition]=useState({key,page:1}),[size,setSizeValue]=useState(20),[result,setResult]=useState<PageResult<T>>({rows:[],total:0,page:1,size:20,pages:1}),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const page=position.key===key?position.page:1;
 const setPage=useCallback((value:number)=>setPosition({key,page:value}),[key]);
 const latest=useRef(0),controller=useRef<AbortController|null>(null);
 const refresh=useCallback(async(visible=false)=>{
  const sequence=++latest.current;controller.current?.abort();const request=new AbortController();controller.current=request;
  if(visible)setLoading(true);
  try{const value=await api.recordPage<T>(path,{...JSON.parse(key),page,size},request.signal);if(sequence===latest.current){setResult(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);setError('');if(value.page!==page)setPage(value.page);}}
  catch(e){if(sequence===latest.current&&!request.signal.aborted)setError(e instanceof Error?e.message:'Records could not be loaded.');}
  finally{if(sequence===latest.current)setLoading(false);}
 },[path,key,page,size,setPage]);
 useEffect(()=>{const timer=setTimeout(()=>void refresh(true),180);return()=>{clearTimeout(timer);controller.current?.abort();};},[refresh]);
 useEffect(()=>{const update=()=>{if(!document.hidden)void refresh();};window.addEventListener('madina-records-changed',update);window.addEventListener('focus',update);return()=>{window.removeEventListener('madina-records-changed',update);window.removeEventListener('focus',update);};},[refresh]);
 return {...result,loading,error,setPage,setSize:(value:number)=>{setSizeValue(value);setPage(1);},refresh};
}

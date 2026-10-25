import { tr } from '../app/i18n';
interface RuntimeResponse { returnValue: boolean; baseUrl?: string; errorText?: string }
interface Subscription { cancel(): void }
type RequestOptions = { method: string; parameters: {subscribe: boolean}; subscribe: boolean; resubscribe: boolean; onSuccess(value: RuntimeResponse): void; onFailure(value: {errorText?: string}): void };
type ServiceRequest = (uri:string, options:RequestOptions)=>Subscription;
declare global { interface Window { webOS?: { service: {request: ServiceRequest} } } }
export function connectRuntime(request:ServiceRequest, onDisconnected:()=>void = ()=>{}):Promise<{baseUrl:string;cancel():void}> {
 return new Promise((resolve,reject)=>{
  let subscription:Subscription | undefined; let settled=false;
  const timer=setTimeout(()=>{subscription?.cancel();reject(new Error(tr('err.runtime.noReply')));},15000);
  subscription=request('luna://com.musicfy.webos.service',{
   method:'start',parameters:{subscribe:true},subscribe:true,resubscribe:false,
   onSuccess(value){
    if(settled)return;
    clearTimeout(timer);
    try{const url=new URL(value.baseUrl || '');if(!value.returnValue||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||!/^\/s\/[a-z0-9]+$/.test(url.pathname))throw new Error();}
    catch{subscription?.cancel();reject(new Error(tr('err.runtime.badAddress')));return;}
    settled=true;resolve({baseUrl:value.baseUrl!,cancel:()=>subscription?.cancel()});
   },
   onFailure(value){clearTimeout(timer);subscription?.cancel();onDisconnected();if(!settled){console.debug('[runtime]',value.errorText);reject(new Error(tr('err.runtime.notReady')))};}
  });
 });
}
let connection:Awaited<ReturnType<typeof connectRuntime>> | undefined;
let pending:Promise<void> | undefined;
export const isPackagedTV = ()=>typeof window!=='undefined' && window.location.protocol==='file:';
export function serviceBaseUrl(){return connection?.baseUrl || '';}
export async function ensureRuntime():Promise<void>{
 if(!isPackagedTV() || connection)return;
 if(!pending)pending=(async()=>{
  if(!window.webOS?.service)throw new Error(tr('err.runtime.noBridge'));
  connection=await connectRuntime(window.webOS.service.request,()=>{connection=undefined;pending=undefined;});
 })().finally(()=>{pending=undefined;});
 await pending;
}
export async function runtimeFetch(input:RequestInfo | URL, init?:RequestInit):Promise<Response>{
 await ensureRuntime();
 const url=String(input);
 return fetch(url.startsWith('/api/')?serviceBaseUrl()+url:input,init);
}
if(typeof window!=='undefined')window.addEventListener('unload',()=>{connection?.cancel();connection=undefined;});

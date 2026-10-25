'use strict';
function registerService(service, startRuntime) {
  const clients=new Map(); let pending; let runtime;
  const method=service.register('start');
  function closeIfIdle(){ if(!clients.size && runtime){const old=runtime;runtime=undefined;old.close();} }
  method.on('request',message=>{
    if(!message.isSubscription){message.respond({returnValue:false,errorText:'Subscription required'});return;}
    clients.set(message.uniqueToken,message);
    if(runtime){message.respond({returnValue:true,baseUrl:runtime.baseUrl});return;}
    if(!pending){
      pending=startRuntime().then(value=>{
        runtime=value; pending=undefined;
        for(const client of clients.values())client.respond({returnValue:true,baseUrl:value.baseUrl});
        closeIfIdle();
      }).catch(()=>{
        pending=undefined;for(const client of clients.values())client.respond({returnValue:false,errorText:'Musicfy service could not start'});clients.clear();
      });
    }
  });
  method.on('cancel',message=>{clients.delete(message.uniqueToken);closeIfIdle();});
  return method;
}
module.exports={registerService};

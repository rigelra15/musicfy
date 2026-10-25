import {expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const {registerService}=createRequire(import.meta.url)('../service/lifecycle.cjs');
it('keeps runtime for active subscriptions and closes on last cancellation', async()=>{
 const method=new EventEmitter();const close=vi.fn();const starter=vi.fn(async()=>({baseUrl:'http://127.0.0.1:123/s/token',close}));
 registerService({register:()=>method},starter);
 const first={uniqueToken:'a',isSubscription:true,respond:vi.fn()};const second={uniqueToken:'b',isSubscription:true,respond:vi.fn()};
 method.emit('request',first);method.emit('request',second);await Promise.resolve();
 expect(starter).toHaveBeenCalledTimes(1);expect(first.respond).toHaveBeenCalledWith({returnValue:true,baseUrl:'http://127.0.0.1:123/s/token'});
 method.emit('cancel',first);expect(close).not.toHaveBeenCalled();method.emit('cancel',second);expect(close).toHaveBeenCalledTimes(1);
 method.emit('request',{...first,uniqueToken:'c'});await Promise.resolve();expect(starter).toHaveBeenCalledTimes(2);
});
it('closes a late startup after the caller closes the app',async()=>{
 const method=new EventEmitter();const close=vi.fn();let resolve:any;
 registerService({register:()=>method},()=>new Promise(r=>resolve=r));
 const message={uniqueToken:'a',isSubscription:true,respond:vi.fn()};method.emit('request',message);method.emit('cancel',message);
 resolve({baseUrl:'http://127.0.0.1:123/s/token',close});await Promise.resolve();expect(close).toHaveBeenCalled();expect(message.respond).not.toHaveBeenCalled();
});

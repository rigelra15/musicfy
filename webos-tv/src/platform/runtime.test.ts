import {expect,it,vi} from 'vitest';
import {connectRuntime} from './runtime';
it('starts only the packaged on-device service with a subscription',async()=>{
 const cancel=vi.fn();const request=vi.fn((_uri,options)=>{queueMicrotask(()=>options.onSuccess({returnValue:true,baseUrl:'http://127.0.0.1:12345/s/abc'}));return {cancel};});
 const connection=await connectRuntime(request);
 expect(connection.baseUrl).toBe('http://127.0.0.1:12345/s/abc');expect(request.mock.calls[0][0]).toBe('luna://com.musicfy.webos.service');expect(request.mock.calls[0][1].subscribe).toBe(true);
 connection.cancel();expect(cancel).toHaveBeenCalled();
});
it('rejects a remote host returned by a broken service',async()=>{
 const cancel=vi.fn();
 await expect(connectRuntime((_uri,options)=>{queueMicrotask(()=>options.onSuccess({returnValue:true,baseUrl:'http://remote.test/s/token'}));return{cancel};})).rejects.toThrow();
 expect(cancel).toHaveBeenCalled();
});

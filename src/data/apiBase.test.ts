import {expect,it,vi} from 'vitest';
vi.mock('../platform/runtime',()=>({isPackagedTV:()=>true,serviceBaseUrl:()=> 'http://127.0.0.1:12345/s/testsession'}));
import {apiBaseUrl} from './apiBase';
it('uses an absolute on-device base for media src instead of a file-relative path',()=>{
 expect(apiBaseUrl()).toBe('http://127.0.0.1:12345/s/testsession/api/youtube');
});

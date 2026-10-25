import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
// Packaged builds always discover their on-TV service, never a saved LAN URL.
const env={...process.env,VITE_YOUTUBE_API_BASE_URL:'',VITE_LRCLIB_API_BASE_URL:''};
const app=JSON.parse(readFileSync('public/appinfo.json','utf8'));
const service=JSON.parse(readFileSync('service/services.json','utf8'));
if(!service.id.startsWith(app.id+'.'))throw new Error('Service must belong to the app');
for(const [command,args] of [['npm',['run','build']],['ares-package',['dist','service','-o','artifacts']]]){
 const result=spawnSync(command,args,{stdio:'inherit',env});if(result.status!==0)process.exit(result.status || 1);
}

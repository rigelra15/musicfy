import {h} from 'preact';
import 'iconify-icon';
import icons from './playerIcons.json';
export type IconName=keyof typeof icons;
export function Icon({name}:{name:IconName}){
 return h('iconify-icon',{icon:JSON.stringify(icons[name]),width:'1em',height:'1em','aria-hidden':'true'});
}

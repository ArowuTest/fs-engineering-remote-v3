import crypto from 'node:crypto';
export interface ReadSnapshot{sha256:string;offset:number;length:number;content:string}
export function readSnapshot(content:string,offset:number,length:number):ReadSnapshot{return{sha256:crypto.createHash('sha256').update(content).digest('hex'),offset,length,content}}
export function readDelta(previousSha256:string|undefined,current:ReadSnapshot){if(previousSha256&&previousSha256===current.sha256)return{changed:false,sha256:current.sha256,offset:current.offset,length:current.length,content:''};return{changed:true,...current}}

import type {RemoteOperations} from './operations.js';
import {contextPolicy} from './context-trust.js';
export interface EngineeringContextOptions{fileLimit?:number;statusLines?:number;instructionChars?:number}
export async function engineeringContext(ops:RemoteOperations,root:string,cwd='.',options:EngineeringContextOptions={}){
 const fileLimit=Math.max(20,Math.min(options.fileLimit??120,300));
 const [repo,map,instructions]=await Promise.all([
  ops.inspectRepository(root,cwd),
  ops.repositoryMap(root,cwd,fileLimit),
  ops.applicableInstructions(root,cwd,'.').catch(()=>({instructions:[],count:0,target:'.',trust:'untrusted_context' as const,instructionBearing:false as const,policy:contextPolicy()}))
 ]);
 const status=repo.status.split(/\r?\n/).filter(Boolean).slice(0,options.statusLines??60),scripts=repo.detected.packageScripts as Record<string,string>,checks=['test','check','typecheck','lint','build'].filter(x=>typeof scripts?.[x]==='string');
 const inst=(instructions.instructions as any[]).map(x=>({path:x.path,content:String(x.content).slice(0,options.instructionChars??6000),trust:'untrusted_context' as const,instructionBearing:false as const}));
 return{schemaVersion:'fs.engineering-context.v1',repository:{branch:repo.branch,head:repo.head,dirty:repo.dirty,status},detected:repo.detected,recommendedChecks:checks,files:{sample:map.files,total:map.totalFiles,truncated:map.truncated,topLevel:map.topLevel},instructions:inst,instructionTrust:{trust:'untrusted_context' as const,instructionBearing:false as const,policy:(instructions as any).policy??contextPolicy()},budget:{fileLimit,instructionChars:options.instructionChars??6000},guidance:'Use targeted read_file/search_text calls after this context instead of repeatedly enumerating the repository.'}
}

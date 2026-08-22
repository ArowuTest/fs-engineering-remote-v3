import {NodeRegistry} from './nodes.js';import {iterativeRetrieval,type RetrievalItem} from './iterative-retrieval.js';
const textExt=/\.(ts|tsx|js|jsx|py|go|rs|java|kt|dart|md|json|ya?ml|toml|sql|css|scss|html)$/i;
export interface RepositoryRetrievalRequest{missionId:string;stepId:string;nodeId:string;project:string;root:string;cwd:string;query:string;maxFiles?:number}
export class RepositoryRetrieval{
 constructor(private readonly nodes=new NodeRegistry()){}
 async plan(input:RepositoryRetrievalRequest){const command=`Get-ChildItem -LiteralPath . -Recurse -File -ErrorAction SilentlyContinue | Where-Object {$_.FullName -notmatch '\\\\node_modules\\\\|\\\\.git\\\\|\\\\dist\\\\|\\\\build\\\\|\\\\coverage\\\\'} | Select-Object -First ${Math.min(input.maxFiles??300,500)} -ExpandProperty FullName`;return this.nodes.enqueue({missionId:input.missionId,stepId:input.stepId,nodeId:input.nodeId,project:input.project,capability:'command',operation:'run',payload:{root:input.root,cwd:input.cwd,command,__retrieval:{query:input.query,phase:'discover'}}},{idempotencyKey:`retrieval-discover:${input.missionId}:${input.stepId}:${input.query}`})}
 select(query:string,files:{path:string;text:string;score?:number}[],maxItems=12){const items:RetrievalItem[]=files.filter(f=>textExt.test(f.path)).map(f=>({id:f.path,text:`${f.path}\n${f.text}`,score:f.score??0,source:'repository'}));return iterativeRetrieval(query,items,{maxItems:Math.min(maxItems,20),maxRounds:3,minScore:.1})}
}

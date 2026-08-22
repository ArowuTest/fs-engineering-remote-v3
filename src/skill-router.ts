import {SkillCatalog,type SkillEvaluation} from './skills.js';
export interface SkillSelection{query:string;selected:{id:string;name:string;description:string;evaluation:SkillEvaluation;resources:string[];relevance:number;content:string}[];rejected:{id:string;reason:string}[]}
export class SkillRouter{
  constructor(private readonly catalog:SkillCatalog){}
  async select(queries:string[],limit=8):Promise<SkillSelection>{
    const candidates=new Map<string,Awaited<ReturnType<SkillCatalog['list']>>[number]>();
    for(const q of queries)for(const s of await this.catalog.list(q,undefined,20))candidates.set(s.id,s);
    const selected:SkillSelection['selected']=[],rejected:SkillSelection['rejected']=[];
    const terms=queries.join(' ').toLowerCase().split(/\W+/).filter(x=>x.length>3);
    for(const s of candidates.values()){
      const evaluation=await this.catalog.evaluate(s.id);
      if(evaluation.verdict==='reject'){rejected.push({id:s.id,reason:evaluation.findings.join('; ')||'skill rejected by quality gate'});continue}
      const resources=(await this.catalog.listResources(s.id)).map(r=>r.path),detail=await this.catalog.read(s.id);
      const hay=`${s.id} ${s.name} ${s.description} ${detail.content}`.toLowerCase(),hits=terms.filter(t=>hay.includes(t)).length,relevance=terms.length?hits/terms.length:0;
      selected.push({id:s.id,name:s.name,description:s.description,evaluation,resources,relevance,content:detail.content.slice(0,16000)});
    }
    selected.sort((a,b)=>(b.relevance+b.evaluation.score/5)-(a.relevance+a.evaluation.score/5));
    return {query:queries.join(' | '),selected:selected.slice(0,limit),rejected};
  }
}

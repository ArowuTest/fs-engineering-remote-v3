import type {NodeDoctorReport} from './node-doctor.js';
export interface NodeReadinessSummary{schemaVersion:'fs.node.readiness.v1';ok:boolean;checkedAt:string;platform:string;arch:string;node:string;shell:string;checks:Array<{name:string;status:'pass'|'warn'|'fail'}>}
export function summarizeNodeReadiness(report:NodeDoctorReport,checkedAt=new Date().toISOString()):NodeReadinessSummary{return{schemaVersion:'fs.node.readiness.v1',ok:report.ok,checkedAt,platform:report.platform,arch:report.arch,node:report.node,shell:report.shell,checks:report.checks.map(x=>({name:x.name,status:x.status}))}}

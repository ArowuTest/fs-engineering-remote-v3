import crypto from 'node:crypto';import type {PerformanceEvent} from './performance-telemetry.js';
export interface SessionMarker{schemaVersion:'fs.performance.session.v1';sessionId:string;benchmarkId?:string;harness?:string;model?:string;startedAt:string;endedAt?:string;notes?:string}
export function newPerformanceSession(input:{benchmarkId?:string;harness?:string;model?:string;notes?:string}={}):SessionMarker{return{schemaVersion:'fs.performance.session.v1',sessionId:crypto.randomUUID(),startedAt:new Date().toISOString(),...input}}
export function sessionEvents(events:PerformanceEvent[],session:SessionMarker){const start=Date.parse(session.startedAt),end=session.endedAt?Date.parse(session.endedAt):Infinity;return events.filter(x=>{const t=Date.parse(x.at);return t>=start&&t<=end})}

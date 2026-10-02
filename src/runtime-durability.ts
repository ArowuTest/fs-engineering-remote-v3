type RuntimeEnvironment = Record<string,string|undefined>;

/** Local developer mode may use files; a declared hosted control plane may not. */
export function requiresDurableState(env:RuntimeEnvironment=process.env):boolean {
 const hosted=(env.FS_REMOTE_HOSTED??'').trim().toLowerCase();
 if(!['','0','false','1','true'].includes(hosted))throw new Error('INVALID_HOSTED_FLAG');
 return hosted==='1'||hosted==='true'||Boolean(env.RAILWAY_ENVIRONMENT?.trim()||env.RAILWAY_ENVIRONMENT_ID?.trim()||env.RAILWAY_PROJECT_ID?.trim());
}

/** Run before configuration, runtime ownership, migrations, listeners or job loops. */
export function assertRuntimeDurability(env:RuntimeEnvironment=process.env):void {
 if(requiresDurableState(env)&&!env.DATABASE_URL?.trim())throw new Error('DURABLE_DATABASE_REQUIRED: hosted runtime cannot fall back to filesystem state.');
}

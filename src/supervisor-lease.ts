import {db,databaseEnabled} from './db.js';
import {assertLeaseDuration} from './lease-duration.js';
const iid=()=>process.env.FS_REMOTE_INSTANCE_ID??'v3-default';
export class SupervisorLeaseStore{
 constructor(private readonly workspaceId?:string){}
 private local(){if(this.workspaceId)throw new Error('Workspace supervisor leases require durable PostgreSQL state.');return true}
 async acquire(missionId:string,owner:string,leaseMs=30000){
  assertLeaseDuration(leaseMs);if(!databaseEnabled())return this.local();
  const r=await db().query(`INSERT INTO mission_supervisor_leases(instance_id,mission_id,owner,lease_expires_at,updated_at)
   SELECT $1,m.id,$3,clock_timestamp()+($4::text||' milliseconds')::interval,clock_timestamp() FROM missions m
   WHERE m.id=$2 AND m.instance_id=$1 AND ($5::text IS NULL OR m.workspace_id=$5)
   ON CONFLICT(instance_id,mission_id) DO UPDATE SET owner=EXCLUDED.owner,lease_expires_at=EXCLUDED.lease_expires_at,updated_at=clock_timestamp()
   WHERE mission_supervisor_leases.lease_expires_at<clock_timestamp() OR mission_supervisor_leases.owner=$3 RETURNING owner`,[iid(),missionId,owner,leaseMs,this.workspaceId??null]);return(r.rowCount??0)>0;
 }
 async renew(missionId:string,owner:string,leaseMs=30000){
  assertLeaseDuration(leaseMs);if(!databaseEnabled())return this.local();
  const r=await db().query(`UPDATE mission_supervisor_leases SET lease_expires_at=clock_timestamp()+($4::text||' milliseconds')::interval,updated_at=clock_timestamp()
   WHERE instance_id=$1 AND mission_id=$2 AND owner=$3 AND lease_expires_at>clock_timestamp()
   AND EXISTS(SELECT 1 FROM missions m WHERE m.id=$2 AND m.instance_id=$1 AND ($5::text IS NULL OR m.workspace_id=$5)) RETURNING owner`,[iid(),missionId,owner,leaseMs,this.workspaceId??null]);return(r.rowCount??0)>0;
 }
 async release(missionId:string,owner:string){if(!databaseEnabled())return;
  await db().query(`DELETE FROM mission_supervisor_leases WHERE instance_id=$1 AND mission_id=$2 AND owner=$3
   AND EXISTS(SELECT 1 FROM missions m WHERE m.id=$2 AND m.instance_id=$1 AND ($4::text IS NULL OR m.workspace_id=$4))`,[iid(),missionId,owner,this.workspaceId??null]);
 }
}

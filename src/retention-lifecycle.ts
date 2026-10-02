import {db} from './db.js';
export interface EphemeralCleanupCounts{invitations:number;userSessions:number;passwordResetTokens:number;oauthAuthorizationCodes:number;oauthAccessTokens:number;nodeEnrollments:number;pendingNodeCredentialsCleared:number}
const count=(r:{rowCount:number|null|undefined})=>r.rowCount??0;
export class RetentionLifecycle{
 constructor(private readonly workspaceId?:string){}
 private params(){return [this.workspaceId??null];}
 async cleanupEphemeralCredentials():Promise<EphemeralCleanupCounts>{
  const [workspaceId]=this.params(),c=await db().connect();
  try{await c.query('BEGIN');
   const invitations=count(await c.query("DELETE FROM invitations WHERE ($1::text IS NULL OR workspace_id=$1) AND (expires_at<=clock_timestamp() OR consumed_at IS NOT NULL OR use_count>=max_uses)",[workspaceId]));
   const userSessions=count(await c.query("DELETE FROM user_sessions WHERE ($1::text IS NULL OR workspace_id=$1) AND (expires_at<=clock_timestamp() OR revoked_at IS NOT NULL)",[workspaceId]));
   const passwordResetTokens=count(await c.query("DELETE FROM password_reset_tokens WHERE ($1::text IS NULL OR workspace_id=$1) AND (expires_at<=clock_timestamp() OR consumed_at IS NOT NULL)",[workspaceId]));
   const oauthAuthorizationCodes=count(await c.query("DELETE FROM oauth_authorization_codes WHERE ($1::text IS NULL OR workspace_id=$1) AND (expires_at<=clock_timestamp() OR consumed_at IS NOT NULL)",[workspaceId]));
   const oauthAccessTokens=count(await c.query("DELETE FROM oauth_access_tokens WHERE ($1::text IS NULL OR workspace_id=$1) AND (expires_at<=clock_timestamp() OR revoked_at IS NOT NULL)",[workspaceId]));
   const nodeEnrollments=count(await c.query("DELETE FROM node_enrollments WHERE ($1::text IS NULL OR workspace_id=$1) AND (expires_at<=clock_timestamp() OR consumed_at IS NOT NULL)",[workspaceId]));
   const pendingNodeCredentialsCleared=count(await c.query("UPDATE execution_nodes SET pending_credential_hash=NULL,pending_credential_expires_at=NULL WHERE ($1::text IS NULL OR workspace_id=$1) AND pending_credential_hash IS NOT NULL AND pending_credential_expires_at<=clock_timestamp()",[workspaceId]));
   await c.query('COMMIT');
   return {invitations,userSessions,passwordResetTokens,oauthAuthorizationCodes,oauthAccessTokens,nodeEnrollments,pendingNodeCredentialsCleared};
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 }
}
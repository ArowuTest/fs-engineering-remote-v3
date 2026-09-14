import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
function stateDir(){return process.env.FS_REMOTE_NODE_STATE_DIR??path.join(os.homedir(),'.fs-remote-v3')}
export async function persistNodeCredential(secret:string){if(!secret||secret.length<20)throw new Error('Node credential is invalid.');const dir=stateDir(),file=path.join(dir,'node-credential');await fs.mkdir(dir,{recursive:true,mode:0o700});await fs.writeFile(file,secret,{encoding:'utf8',mode:0o600});try{await fs.chmod(file,0o600)}catch{}return file}
export async function loadNodeCredential(){try{const value=(await fs.readFile(path.join(stateDir(),'node-credential'),'utf8')).trim();return value||undefined}catch{return undefined}}

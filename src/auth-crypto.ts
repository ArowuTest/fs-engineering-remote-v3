import crypto from 'node:crypto';
import { promisify } from 'node:util';
const scrypt=promisify(crypto.scrypt);
export async function hashPassword(password:string){if(password.length<12)throw new Error('Password must contain at least 12 characters.');const salt=crypto.randomBytes(16),key=await scrypt(password,salt,64) as Buffer;return `scrypt$v1$${salt.toString('base64url')}$${key.toString('base64url')}`}
export async function verifyPassword(password:string,encoded:string){const [alg,ver,saltText,hashText]=encoded.split('$');if(alg!=='scrypt'||ver!=='v1'||!saltText||!hashText)return false;const salt=Buffer.from(saltText,'base64url'),expected=Buffer.from(hashText,'base64url'),actual=await scrypt(password,salt,expected.length) as Buffer;return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected)}
export const issueOpaqueToken=(bytes=32)=>crypto.randomBytes(bytes).toString('base64url');
export const hashOpaqueToken=(token:string)=>crypto.createHash('sha256').update(token).digest('hex');

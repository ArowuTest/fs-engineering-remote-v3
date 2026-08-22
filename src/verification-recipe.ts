import {z} from 'zod';
export const verificationRecipeSchema=z.discriminatedUnion('capability',[
 z.object({capability:z.literal('command'),root:z.string(),cwd:z.string(),command:z.string().min(1),timeoutMs:z.number().int().positive().max(900000).optional()}),
 z.object({capability:z.literal('browser'),operation:z.enum(['navigate','snapshot','accessibility','performance']),sessionId:z.number().int().optional(),url:z.string().url().optional()}),
 z.object({capability:z.literal('database'),provider:z.string(),operation:z.string(),payload:z.record(z.string(),z.unknown())}),
 z.object({capability:z.literal('git'),root:z.string(),cwd:z.string(),operation:z.enum(['status','diff'])}),
 z.object({capability:z.literal('ci'),provider:z.string(),operation:z.string(),payload:z.record(z.string(),z.unknown())}),
 z.object({capability:z.literal('deployment'),provider:z.string(),operation:z.string(),payload:z.record(z.string(),z.unknown())})
]);
export type VerificationRecipe=z.infer<typeof verificationRecipeSchema>;
export function recipeFromEvidence(e:any):VerificationRecipe|null{const raw=e?.data?.verificationRecipe??e?.provenance?.verificationRecipe??e?.payload?.verificationRecipe;const parsed=verificationRecipeSchema.safeParse(raw);return parsed.success?parsed.data:null}

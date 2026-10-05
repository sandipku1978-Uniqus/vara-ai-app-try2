/** Sign stdin requests with the application's actual assertion implementation. */
import { readFileSync } from 'node:fs';
import { signUserDataAssertion } from '../../../src/lib/user-data-auth';
import type { UserDataOperation } from '../../../src/lib/user-data-auth';
import type { UserDataKind } from '../../../src/lib/user-data-kinds';
const secret = process.env.DRYRUN_SIGNING_SECRET;
if (!secret || secret.length !== 48) throw new Error('DRYRUN_SIGNING_SECRET must be a 48-character test secret');
const requests = JSON.parse(readFileSync(0, 'utf8')) as Array<{
  name: string; operation: UserDataOperation; kind: UserDataKind;
  userId: string; orgId: string | null; nowMs?: number;
}>;
if (!Array.isArray(requests)) throw new Error('stdin must be a JSON array');
const result: Record<string, ReturnType<typeof signUserDataAssertion>> = {};
for (const { name, ...request } of requests) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name) || Object.hasOwn(result, name)) throw new Error('invalid/duplicate assertion name');
  result[name] = signUserDataAssertion({ ...request, secret });
}
process.stdout.write(JSON.stringify(result) + '\n');

import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { z } from 'zod';

export const visibilityPatch = z.object({
  keys: z.array(z.string().regex(/^(?:gear:\d{1,8}|(?:bike|wheel):[a-z0-9-]{1,96})$/)).min(1).max(3000),
  hidden: z.boolean(),
}).strict();

export function v3Catalogue(file: string) {
  let pending = Promise.resolve();

  async function read(): Promise<string[]> {
    try {
      return z.array(z.string()).parse(JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  function update({ keys, hidden }: z.infer<typeof visibilityPatch>): Promise<string[]> {
    // Sérialise les modifications, même si deux onglets envoient un changement au même moment.
    const write = pending.then(async () => {
      const next = new Set(await read());
      for (const key of keys) {
        if (hidden) next.add(key);
        else next.delete(key);
      }
      const sorted = [...next].sort();
      const temporary = file + '.' + randomUUID();
      try {
        await writeFile(temporary, JSON.stringify(sorted) + '\n', { mode: 0o644, flag: 'wx' });
        await rename(temporary, file);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      return sorted;
    });
    pending = write.then(() => undefined, () => undefined);
    return write;
  }

  return { read, update };
}

import { config } from './config.js'

/* The spool's public surface. Every consumer — app.js, mailer.js, index.js —
   imports these three names and never a driver directly, so where an
   undeliverable form is actually stored is a deployment decision rather than
   a code one.

   Two drivers, because the storage guarantee has to hold in two very
   different places:

     fs   (default) a persistent disk the process owns — the VPS under
          systemd, and local dev. Atomic rename, no network.
     blob           Vercel Blob, for the serverless deployment, where the
          filesystem does not outlive the invocation that wrote to it and a
          spooled form would otherwise be destroyed when the container
          recycles.

   Selected by SPOOL_DRIVER (config.js). The import is lazy and resolved per
   call — the ESM cache makes that free after the first — so a deployment only
   loads the driver it actually uses, and the VPS never pulls @vercel/blob in.
*/
const driver = () => (config.spoolDriver === 'blob' ? import('./spool/blob.js') : import('./spool/fs.js'))

/**
 * Writes an undeliverable submission to the spool: the PDF beside a manifest
 * with everything needed to send it later without the browser being involved.
 */
export const spool = async (submission, reason) => (await driver()).spool(submission, reason)

/** What is waiting to go out, newest first. */
export const listSpool = async () => (await driver()).listSpool()

/**
 * Re-attempts every spooled submission with `send`. Delivered items move to
 * `sent/` rather than being deleted — an operator should be able to see what
 * went out after an outage.
 */
export const flushSpool = async (send) => (await driver()).flushSpool(send)

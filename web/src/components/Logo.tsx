import { useEffect, useState } from 'react'

/**
 * Official logo, with a bundled copy as the fallback. Branch tablets often sit
 * on a restricted network, so the remote URL must never be the only source —
 * and the loaded bytes are cached for the PDF, which needs them inline.
 */
export const LOGO_REMOTE_URL =
  'https://bfl-bred.com/wp-content/uploads/2022/05/BFL-BRED-Group-Logo.png'
export const LOGO_LOCAL_URL = '/logo-bfl.png'

let cachedBytes: Promise<Uint8Array> | null = null

const loadBytes = async (url: string): Promise<Uint8Array> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`logo ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** PNG bytes of the logo for embedding into the PDF; remote first, local second. */
export const getLogoBytes = (): Promise<Uint8Array> => {
  cachedBytes ??= loadBytes(LOGO_REMOTE_URL).catch(() => loadBytes(LOGO_LOCAL_URL))
  return cachedBytes
}

export const Logo = ({ className = 'h-10' }: { className?: string }) => {
  const [src, setSrc] = useState(LOGO_REMOTE_URL)
  useEffect(() => setSrc(LOGO_REMOTE_URL), [])
  return (
    <img
      src={src}
      alt="BFL BRED Group"
      className={`${className} w-auto object-contain`}
      onError={() => setSrc(LOGO_LOCAL_URL)}
    />
  )
}

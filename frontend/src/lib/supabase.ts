import { createClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

/** Null until VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (the publishable key) are set in .env. */
export const supabase = url && key ? createClient(url, key) : null

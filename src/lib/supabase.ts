import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function getSupabaseClient() {
  if (!supabase) {
    throw new Error(
      'Chưa cấu hình Supabase. Vui lòng thêm VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY trên Netlify rồi redeploy.'
    );
  }

  return supabase;
}

export async function signInTeacher(email: string, password: string) {
  const client = getSupabaseClient();

  return client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
}

export async function signOutTeacher() {
  const client = getSupabaseClient();
  return client.auth.signOut();
}

export async function getCurrentSession() {
  const client = getSupabaseClient();

  const {
    data: { session },
    error,
  } = await client.auth.getSession();

  if (error) {
    console.warn('Lỗi getCurrentSession:', error.message);
    return null;
  }

  return session;
}

export async function getCurrentUser() {
  const client = getSupabaseClient();

  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();

  if (sessionError) {
    console.warn('Lỗi getSession:', sessionError.message);
    return null;
  }

  if (!session?.user) return null;

  return session.user;
}

export const onAuthStateChange = (callback: (user: any) => void) => {
  if (!supabase) return () => {};
  const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
    callback(session?.user || null);
  });
  return () => {
    authListener.subscription.unsubscribe();
  };
};
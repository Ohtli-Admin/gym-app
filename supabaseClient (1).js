// PEGA AQUÍ tus credenciales de Supabase (Project Settings > API) — las
// mismas que ya usaste en supabaseClient.js de la versión React Native.
const SUPABASE_URL = 'PEGA_AQUI_TU_PROJECT_URL';
const SUPABASE_ANON_KEY = 'PEGA_AQUI_TU_ANON_PUBLIC_KEY';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

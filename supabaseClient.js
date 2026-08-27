// PEGA AQUÍ tus credenciales de Supabase (Project Settings > API) — las
// mismas que ya usaste en supabaseClient.js de la versión React Native.
const SUPABASE_URL = 'https://ibjbbisbyygbuqemobir.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImliamJiaXNieXlnYnVxZW1vYmlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1Njc4NzgsImV4cCI6MjEwMjE0Mzg3OH0.ngsOG1JtfXyI_z7BP88-WMdNPRbB-6DMpD6H0aBn6CY';
 
// Importante: reasignamos window.supabase (en vez de declarar "const
// supabase") porque la librería cargada desde el CDN ya usa ese mismo
// nombre global — declarar otra variable con "const supabase" choca con
// ella y rompe TODO el script. Sobrescribir la propiedad sí es seguro: ya
// no necesitamos el namespace original, solo el cliente que genera.
window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

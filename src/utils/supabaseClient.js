import { supabase as rawSupabase } from '../../js/supabase.js';

// Fallback mock safe object in case Supabase env vars are not filled locally
const mockQuery = {
  select: () => mockQuery,
  order: () => mockQuery,
  ilike: () => mockQuery,
  eq: () => mockQuery,
  insert: async () => ({ data: [], error: null }),
  update: () => mockQuery,
  delete: () => mockQuery,
  then: (resolve) => resolve({ data: [], error: null }),
  catch: () => Promise.resolve({ data: [], error: null })
};

export const supabase = rawSupabase || {
  from: () => mockQuery
};

export default supabase;

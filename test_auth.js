const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://tzqbecfsgsevayycmgcv.supabase.co';
const supabaseKey = 'sb_publishable_R8HCtLEznIitLNT9_M85TQ_i_uMeoBl';
const sb = createClient(supabaseUrl, supabaseKey);

async function test() {
  console.log("Testing sign up...");
  const { data: d1, error: e1 } = await sb.auth.signUp({ email: 'test_nexo_123@example.com', password: 'password123' });
  console.log("SignUp Error:", e1 ? e1.message : "None");
  console.log("SignUp Data:", d1);

  console.log("Testing sign in...");
  const { data: d2, error: e2 } = await sb.auth.signInWithPassword({ email: 'test_nexo_123@example.com', password: 'password123' });
  console.log("SignIn Error:", e2 ? e2.message : "None");
  console.log("SignIn Data:", d2);
}
test();

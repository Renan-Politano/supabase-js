require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Health check route
app.get('/', (req, res) => {
  res.send('ChatLead API running!');
});

// ===============================
// Onboarding (Registration)
// ===============================
app.post('/onboarding', async (req, res) => {
  try {
    const {
      client_type,        // 'individual' or 'company'
      full_name,
      document,           // CPF or CNPJ (only numbers)
      email,
      password,
      phone,
      company_name        // (optional, only for company)
    } = req.body;

    if (!client_type || !full_name || !document || !email || !password || !phone) {
      return res.status(400).json({ error: "Missing required fields." });
    }
    if (client_type !== "individual" && client_type !== "company") {
      return res.status(400).json({ error: "Invalid client_type. Must be 'individual' or 'company'." });
    }

    // 1. Create user in Supabase Auth (for secure login)
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (authError) return res.status(400).json({ error: authError.message });

    // 2. Create client
    const { data: clientData, error: clientError } = await supabase
      .from('clients')
      .insert([{
        full_name,
        company_name: client_type === 'company' ? company_name : null,
        document,
        email,
        phone,
        client_type
      }])
      .select()
      .single();
    if (clientError) return res.status(400).json({ error: clientError.message });
    const client_id = clientData.id;

    // 3. Create user in 'users' (with id_auth)
    const password_hash = await bcrypt.hash(password, 10);
    const { data: userData, error: userError } = await supabase
      .from('users')
      .insert([{
        client_id: client_id,
        full_name: full_name,
        email: email,
        password_hash: password_hash,
        id_auth: authUser.user.id
      }])
      .select()
      .single();
    if (userError) return res.status(400).json({ error: userError.message });
    const user_id = userData.id;

    // 4. Create contact or company
    if (client_type === "individual") {
      const { error: contactError } = await supabase
        .from('contacts')
        .insert([{
          client_id: client_id,
          full_name: full_name,
          phone: phone,
          email: email,
          responsible_id: user_id
        }]);
      if (contactError) return res.status(400).json({ error: contactError.message });
    } else if (client_type === "company") {
      const { error: companyError } = await supabase
        .from('companies')
        .insert([{
          client_id: client_id,
          company_name: company_name || full_name,
          document: document,
          responsible_id: user_id
        }]);
      if (companyError) return res.status(400).json({ error: companyError.message });
    }

    return res.status(201).json({ message: "Registration successful! Please check your email for confirmation." });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ===============================
// User login (via Supabase Auth)
// ===============================
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  // 1. Authenticate via Supabase Auth
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) return res.status(401).json({ error: 'Invalid credentials.' });

  // 2. Find user in 'users' by email (for roles, client_id etc)
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (userError || !userData)
    return res.status(401).json({ error: 'User not found in database.' });

  // 3. Return token and user data
  return res.json({
    token: data.session.access_token,
    user: userData
  });
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`ChatLead API running on port ${PORT}`);
});
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
      client_type,        // deve ser "company"
      full_name,          // nome do responsável
      company_name,       // razão social
      document,           // CNPJ só números
      email,
      password,
      phone
    } = req.body;

    // Checa se tudo está preenchido
    if (
      !client_type || client_type !== "company" ||
      !full_name || !company_name ||
      !document || !email || !password || !phone
    ) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // 1. Criar cliente
    const { data: clientData, error: clientError } = await supabase
      .from('clients')
      .insert([{
        full_name,                   // nome do responsável (ex: Maria Souza)
        company_name,                // razão social (ex: XPTO LTDA)
        document,                    // CNPJ
        email,                       // email principal
        phone,
        client_type: "company"
      }])
      .select()
      .single();
    if (clientError) return res.status(400).json({ error: clientError.message });
    const client_id = clientData.id;

    // 2. Criar usuário (responsável principal)
    const password_hash = await bcrypt.hash(password, 10);
    // Auth
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (authError) return res.status(400).json({ error: authError.message });

    const { data: userData, error: userError } = await supabase
      .from('users')
      .insert([{
        client_id: client_id,
        full_name: full_name,    // nome do responsável
        email: email,
        password_hash: password_hash,
        id_auth: authUser.user.id
      }])
      .select()
      .single();
    if (userError) return res.status(400).json({ error: userError.message });
    const user_id = userData.id;

    // 3. Criar contato (do responsável)
    const { data: contactData, error: contactError } = await supabase
      .from('contacts')
      .insert([{
        client_id: client_id,
        full_name: full_name,   // nome do responsável
        phone: phone,
        email: email,
        responsible_id: user_id
      }])
      .select()
      .single();
    if (contactError) return res.status(400).json({ error: contactError.message });
    const contact_id = contactData.id;

    // 4. Criar empresa
    const { data: companyData, error: companyError } = await supabase
      .from('companies')
      .insert([{
        client_id: client_id,
        name: company_name,     // razão social
        cnpj: document,
        responsible_id: user_id
      }])
      .select()
      .single();
    if (companyError) return res.status(400).json({ error: companyError.message });
    const company_id = companyData.id;

    // 5. Vincular contato à empresa (contact_company)
    const { error: linkError } = await supabase
      .from('contact_company')
      .insert([{
        contact_id: contact_id,
        company_id: company_id
      }]);
    if (linkError) return res.status(400).json({ error: linkError.message });

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
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
      client_type,        // 'individual' | 'company'
      full_name,          // nome completo ou do responsável
      company_name,       // obrigatório só se company
      document,           // CPF/CNPJ
      email,
      password,
      phone
    } = req.body;

    // 1) Validação por tipo
    if (client_type === 'individual') {
      if (!full_name || !document || !email || !password || !phone) {
        return res.status(400).json({ error: 'Missing required fields for individual.' });
      }
    } else if (client_type === 'company') {
      if (!full_name || !company_name || !document || !email || !password || !phone) {
        return res.status(400).json({ error: 'Missing required fields for company.' });
      }
    } else {
      return res.status(400).json({ error: "Invalid client_type. Must be 'individual' or 'company'." });
    }

    // 2) Normalização
    const onlyDigits = (s) => (s || '').toString().replace(/\D+/g, '');
    const normalizedDocument = onlyDigits(document);
    const normalizedPhone = phone.replace(/\s+/g, '').replace(/[\(\)\-\.]/g, ''); // garanta E.164 do lado do front se puder

    // 3) Criar CLIENT primeiro (usa service key no backend, então RLS não bloqueia)
    const { data: clientData, error: clientError } = await supabase
      .from('clients')
      .insert([{
        full_name,
        company_name: client_type === 'company' ? company_name : null,
        document: normalizedDocument,
        email,
        phone: normalizedPhone,
        client_type
      }])
      .select()
      .single();
    if (clientError) return res.status(400).json({ error: clientError.message });

    const client_id = clientData.id;

    // 4) Criar usuário no Auth JÁ com app_metadata.client_id
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      // Se quiser obrigar confirmação por e-mail, deixe false e convide abaixo:
      email_confirm: false,
      app_metadata: { client_id },
      user_metadata: { full_name }
    });
    if (authError) return res.status(400).json({ error: authError.message });

    // (Opcional) Enviar e-mail de convite/confirm.
    // await supabase.auth.admin.inviteUserByEmail(email, { data: { client_id } });

    // 5) Criar espelho em USERS
    const password_hash = await bcrypt.hash(password, 10);
    const { data: userData, error: userError } = await supabase
      .from('users')
      .insert([{
        client_id,
        id_auth: authUser.user.id,
        full_name,
        email,
        password_hash
      }])
      .select()
      .single();
    if (userError) return res.status(400).json({ error: userError.message });

    const user_id = userData.id;

    // 6) Dados de negócio por tipo
    if (client_type === 'individual') {
      const { error: contactError } = await supabase
        .from('contacts')
        .insert([{
          client_id,
          full_name,
          phone: normalizedPhone,
          email,
          responsible_id: user_id
        }]);
      if (contactError) return res.status(400).json({ error: contactError.message });

      return res.status(201).json({
        message: 'Cadastro realizado com sucesso! Enviamos um e-mail para confirmação.',
        client_id,
        user_id
      });
    }

    // company
    const { data: companyData, error: companyError } = await supabase
      .from('companies')
      .insert([{
        client_id,
        name: company_name,
        cnpj: normalizedDocument,
        responsible_id: user_id
      }])
      .select()
      .single();
    if (companyError) return res.status(400).json({ error: companyError.message });

    const { data: contactData, error: contactError } = await supabase
      .from('contacts')
      .insert([{
        client_id,
        full_name,               // responsável
        phone: normalizedPhone,
        email,
        responsible_id: user_id
      }])
      .select()
      .single();
    if (contactError) return res.status(400).json({ error: contactError.message });

    const { error: linkError } = await supabase
      .from('contact_company')
      .insert([{ contact_id: contactData.id, company_id: companyData.id }]);
    if (linkError) return res.status(400).json({ error: linkError.message });

    return res.status(201).json({
      message: 'Cadastro realizado com sucesso! Enviamos um e-mail para confirmação.',
      client_id,
      user_id,
      company_id: companyData.id,
      contact_id: contactData.id
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`ChatLead API running on port ${PORT}`);
});
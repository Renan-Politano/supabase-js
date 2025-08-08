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
  let authUserId = null;

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
    const normalizedPhone = (phone || '')
      .replace(/\s+/g, '')
      .replace(/[\(\)\-\.]/g, ''); // ideal: já vir E.164 do front (+5511999999999)

    // 3) signUp — envia e-mail automaticamente (se "Confirm email" estiver ON no Supabase)
    const { data: suData, error: suErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name }, // user_metadata
      }
    });
    if (suErr) return res.status(400).json({ error: suErr.message });

    authUserId = suData?.user?.id;
    if (!authUserId) {
      return res.status(400).json({ error: 'Auth user not returned by signUp.' });
    }

    // 4) Criar CLIENT (usa service key no backend, então RLS não bloqueia)
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

    if (clientError) {
      // rollback do usuário no Auth para não sobrar órfão
      try { await supabase.auth.admin.deleteUser(authUserId); } catch (_) {}
      return res.status(400).json({ error: clientError.message });
    }

    const client_id = clientData.id;

    // 5) Setar app_metadata.client_id DEPOIS do signUp
    const { error: updErr } = await supabase.auth.admin.updateUserById(authUserId, {
      app_metadata: { client_id }
    });
    if (updErr) {
      // rollback: apaga user auth e client criado
      try { await supabase.auth.admin.deleteUser(authUserId); } catch (_) {}
      try { await supabase.from('clients').delete().eq('id', client_id); } catch (_) {}
      return res.status(400).json({ error: updErr.message });
    }

    // 6) Criar espelho em USERS
    // OBS de segurança: evitar armazenar password_hash próprio; o Supabase já guarda a senha.
    // Mantive para não quebrar o escopo. Se não quiser, remova as 3 linhas de hash + field na insert.
    const password_hash = await bcrypt.hash(password, 10);
    const { data: userData, error: userError } = await supabase
      .from('users')
      .insert([{
        client_id,
        id_auth: authUserId,
        full_name,
        email,
        password_hash
      }])
      .select()
      .single();
    if (userError) {
      // rollback total
      try { await supabase.auth.admin.deleteUser(authUserId); } catch (_) {}
      try { await supabase.from('clients').delete().eq('id', client_id); } catch (_) {}
      return res.status(400).json({ error: userError.message });
    }

    const user_id = userData.id;

    // 7) Dados de negócio por tipo
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

      if (contactError) {
        // rollback total
        try { await supabase.auth.admin.deleteUser(authUserId); } catch (_) {}
        try { await supabase.from('users').delete().eq('id', user_id); } catch (_) {}
        try { await supabase.from('clients').delete().eq('id', client_id); } catch (_) {}
        return res.status(400).json({ error: contactError.message });
      }

      return res.status(201).json({
        message: 'Cadastro iniciado com sucesso! Enviamos um e-mail para confirmação.',
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
    if (companyError) {
      // rollback total
      try { await supabase.auth.admin.deleteUser(authUserId); } catch (_) {}
      try { await supabase.from('users').delete().eq('id', user_id); } catch (_) {}
      try { await supabase.from('clients').delete().eq('id', client_id); } catch (_) {}
      return res.status(400).json({ error: companyError.message });
    }

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
    if (contactError) {
      // rollback total
      try { await supabase.from('companies').delete().eq('id', companyData?.id); } catch (_) {}
      try { await supabase.auth.admin.deleteUser(authUserId); } catch (_) {}
      try { await supabase.from('users').delete().eq('id', user_id); } catch (_) {}
      try { await supabase.from('clients').delete().eq('id', client_id); } catch (_) {}
      return res.status(400).json({ error: contactError.message });
    }

    const { error: linkError } = await supabase
      .from('contact_company')
      .insert([{ contact_id: contactData.id, company_id: companyData.id }]);
    if (linkError) {
      // rollback total
      try { await supabase.from('contacts').delete().eq('id', contactData.id); } catch (_) {}
      try { await supabase.from('companies').delete().eq('id', companyData.id); } catch (_) {}
      try { await supabase.auth.admin.deleteUser(authUserId); } catch (_) {}
      try { await supabase.from('users').delete().eq('id', user_id); } catch (_) {}
      try { await supabase.from('clients').delete().eq('id', client_id); } catch (_) {}
      return res.status(400).json({ error: linkError.message });
    }

    return res.status(201).json({
      message: 'Cadastro iniciado com sucesso! Enviamos um e-mail para confirmação.',
      client_id,
      user_id,
      company_id: companyData.id,
      contact_id: contactData.id
    });

  } catch (e) {
    console.error(e);
    // tentativa de rollback final caso algo tenha escapado
    // (evite hard-fails aqui porque você pode não ter ids ainda)
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`ChatLead API running on port ${PORT}`);
});
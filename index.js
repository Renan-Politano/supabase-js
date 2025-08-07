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

// Teste
app.get('/', (req, res) => {
  res.send('API ChatLead funcionando!');
});

// ===============================
// Rota de cadastro inicial (onboarding)
// Cria empresa/cliente + usuário principal
// ===============================
app.post('/onboarding', async (req, res) => {
  const {
    tipo_cliente, nome_razao, email, password,
    telefone, cnpj, nome_fantasia, cpf
  } = req.body;

  if (!tipo_cliente || !nome_razao || !email || !password) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }
  if (tipo_cliente !== 'pf' && tipo_cliente !== 'pj') {
    return res.status(400).json({ error: 'Tipo de cliente inválido' });
  }

  // Cria usuário no Supabase Auth
  const { data: userData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (authError) return res.status(400).json({ error: authError.message });

  // Cria cliente
  const { data: clienteData, error: clienteError } = await supabase
    .from('clientes')
    .insert([{ nome_razao, email, tipo_cliente, telefone, cnpj, cpf }])
    .select()
    .single();
  if (clienteError) return res.status(400).json({ error: clienteError.message });

  // Cria usuário principal
  const senha_hash = await bcrypt.hash(password, 10);
  const { data: usuarioData, error: usuarioError } = await supabase
    .from('usuarios')
    .insert([{
      id_cliente: clienteData.id,
      nome: nome_razao,
      email,
      senha_hash,
      role: 'admin'
    }])
    .select()
    .single();
  if (usuarioError) return res.status(400).json({ error: usuarioError.message });

  let empresaData = null;
  let contatoData = null;

  if (tipo_cliente === 'pj') {
    // Cria empresa vinculada ao cliente
    const { data, error } = await supabase
      .from('empresas')
      .insert([{
        id_cliente: clienteData.id,
        nome: nome_fantasia || nome_razao,
        cnpj: cnpj || null,
        telefone: telefone || null
      }])
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    empresaData = data;
  }

  if (tipo_cliente === 'pf') {
    // Cria contato vinculado ao cliente
    const { data, error } = await supabase
      .from('contatos')
      .insert([{
        id_cliente: clienteData.id,
        nome: nome_razao,
        telefone: telefone || null,
        email: email,
        cpf: cpf || null
      }])
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    contatoData = data;
  }

  return res.json({
    user: userData,
    cliente: clienteData,
    usuario: usuarioData,
    empresa: empresaData,
    contato: contatoData
  });
});


// ===============================
// Rota de cadastro de usuário adicional
// Cadastra usuário dentro de um cliente já existente
// ===============================
app.post('/cadastro', async (req, res) => {
  const { id_cliente, nome, email, password, role } = req.body;
  if (!id_cliente || !nome || !email || !password) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }

  // Cria usuário no Supabase Auth
  const { data: userData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (authError) return res.status(400).json({ error: authError.message });

  // Cria usuário no banco (vinculado ao cliente)
  const senha_hash = await bcrypt.hash(password, 10);
  const { data: usuarioData, error: usuarioError } = await supabase
    .from('usuarios')
    .insert([{
      id_cliente,
      nome,
      email,
      senha_hash,
      role: role || 'colaborador'
    }])
    .select()
    .single();
  if (usuarioError) return res.status(400).json({ error: usuarioError.message });

  return res.json({
    user: userData,
    usuario: usuarioData
  });
});

// =====================
// Rota de login
// =====================
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email e senha obrigatórios' });

  // Busca usuário em 'usuarios'
  const { data: usuarioData, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('email', email)
    .single();

  if (error || !usuarioData)
    return res.status(400).json({ error: 'Usuário não encontrado' });

  const senhaOk = await bcrypt.compare(password, usuarioData.senha_hash);
  if (!senhaOk)
    return res.status(401).json({ error: 'Senha inválida' });

  return res.json({ usuario: usuarioData });
});

// Porta do Railway ou local
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});

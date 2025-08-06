require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

// Instancia o Supabase Client com as variáveis de ambiente do Railway
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ===========================
// Rota de cadastro (onboarding)
// ===========================
app.post('/onboarding', async (req, res) => {
  const { nome_razao, email, password, nome_usuario } = req.body;
  if (!nome_razao || !email || !password) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }

  // 1. Cria usuário no Supabase Auth
  const { data: userData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (authError) return res.status(400).json({ error: authError.message });

  // 2. Cria cliente
  const { data: clienteData, error: clienteError } = await supabase
    .from('clientes')
    .insert([{ nome_razao, email }])
    .select()
    .single();
  if (clienteError) return res.status(400).json({ error: clienteError.message });

  // 3. Cria usuário (vinculado ao cliente)
  const senha_hash = await bcrypt.hash(password, 10);
  const { data: usuarioData, error: usuarioError } = await supabase
    .from('usuarios')
    .insert([{
      id_cliente: clienteData.id,
      nome: nome_usuario || nome_razao,
      email,
      senha_hash
    }])
    .select()
    .single();
  if (usuarioError) return res.status(400).json({ error: usuarioError.message });

  return res.json({
    user: userData,
    cliente: clienteData,
    usuario: usuarioData
  });
});

// ===================
// Rota de login
// ===================
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

// Teste rápido para garantir que o servidor está rodando
app.get('/', (req, res) => {
  res.send('API ChatLead funcionando!');
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});

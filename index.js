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
// Exemplo do endpoint de cadastro
app.post('/onboarding', async (req, res) => {
  const { tipo_cliente, nome_razao, documento, email, telefone, senha } = req.body;
  if (!tipo_cliente || !nome_razao || !documento || !email || !telefone || !senha) {
    return res.status(400).json({ error: "Campos obrigatórios faltando." });
  }

  // Cadastrar cliente
  const cliente = await db.query(`
    INSERT INTO clientes (nome_razao, documento, email, telefone, tipo_cliente)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [nome_razao, documento, email, telefone, tipo_cliente]);
  const id_cliente = cliente.rows[0].id;

  // Cadastrar usuário
  const senha_hash = await bcrypt.hash(senha, 10);
  const usuario = await db.query(`
    INSERT INTO usuarios (id_cliente, nome, email, senha_hash)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `, [id_cliente, nome_razao, email, senha_hash]);
  const id_usuario = usuario.rows[0].id;

  if (tipo_cliente === "pessoa_fisica") {
    // Cadastro em contatos
    await db.query(`
      INSERT INTO contatos (id_cliente, nome, telefone, email, id_responsavel)
      VALUES ($1, $2, $3, $4, $5)
    `, [id_cliente, nome_razao, telefone, email, id_usuario]);
  } else if (tipo_cliente === "pessoa_juridica") {
    // Cadastro em empresas
    await db.query(`
      INSERT INTO empresas (id_cliente, nome, cnpj, id_responsavel)
      VALUES ($1, $2, $3, $4)
    `, [id_cliente, nome_razao, documento, id_usuario]);
  }

  return res.status(201).json({ message: "Cadastro realizado com sucesso!" });
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

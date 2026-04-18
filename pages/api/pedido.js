import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const { ref } = req.query;

  if (!ref) {
    return res.status(400).json({ error: 'Referencia ausente' });
  }

  const { data: pedido, error } = await sb
    .from('pedidos')
    .select('referencia, status, codigo, transaction_id, created_at')
    .eq('referencia', ref)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: 'Erro ao buscar pedido' });
  }

  if (!pedido) {
    return res.status(404).json({ error: 'Pedido nao encontrado' });
  }

  return res.status(200).json(pedido);
}

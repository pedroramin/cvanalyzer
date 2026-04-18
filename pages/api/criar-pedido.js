import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// seus links fixos
const CHECKOUTS = {
  5: 'https://checkoutseguro.ru/checkout/cmo1nz9kd000j1qo6ycmchd3v?offer=R9JX4Q5',
  20: 'https://checkoutseguro.ru/checkout/cmo1nz9kd000j1qo6ycmchd3v?offer=1ITEGTR',
  50: 'https://checkoutseguro.ru/checkout/cmo1nz9kd000j1qo6ycmchd3v?offer=2W00KCF',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, moedas } = req.body || {};

    // valida user
    if (!userId) {
      return res.status(400).json({ error: 'userId ausente' });
    }

    // valida quantidade
    if (![5, 20, 50].includes(Number(moedas))) {
      return res.status(400).json({ error: 'Quantidade de moedas inválida' });
    }

    const moedasNum = Number(moedas);
    const referencia = crypto.randomUUID();

    // salva pedido CORRETO
    const { error } = await sb.from('pedidos').insert({
      referencia,
      user_id: userId,
      oferta: `${moedasNum}_moedas`,
      moedas: moedasNum,
      status: 'pendente',
      credited: false,
    });

    if (error) {
      console.error('Erro ao criar pedido:', error);
      return res.status(500).json({ error: 'Erro ao criar pedido' });
    }

    // pega link correto
    const checkoutUrl = CHECKOUTS[moedasNum];

    return res.status(200).json({
      referencia,
      moedas: moedasNum,
      checkoutUrl,
    });

  } catch (err) {
    console.error('Erro interno:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}

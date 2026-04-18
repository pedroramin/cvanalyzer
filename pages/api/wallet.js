import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId ausente' });
  }

  const { data: wallet, error } = await sb
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('Erro ao buscar wallet:', error);
    return res.status(500).json({ error: 'Erro ao buscar wallet' });
  }

  return res.status(200).json({
    user_id: userId,
    coins: wallet?.coins || 0,
  });
}

import { useEffect, useState } from 'react';

export default function Home() {
  const [coins, setCoins] = useState(null);
  const [loading, setLoading] = useState(false);

  // TEMPORARIO: depois a gente troca pelo usuário logado real
  const userId = '4fb5c82f-a4a9-46b1-b9f6-6495d1a72434';

  async function carregarSaldo() {
    try {
      const res = await fetch(`/api/wallet?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();

      if (!res.ok) {
        console.error(data);
        setCoins(0);
        return;
      }

      setCoins(data.coins || 0);
    } catch (err) {
      console.error(err);
      setCoins(0);
    }
  }

  async function comprarMoedas(moedas) {
    try {
      setLoading(true);

      const res = await fetch('/api/criar-pedido', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          moedas,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Erro ao criar pedido');
        setLoading(false);
        return;
      }

      window.location.href = data.checkoutUrl;
    } catch (err) {
      console.error(err);
      alert('Erro ao iniciar compra');
      setLoading(false);
    }
  }

  useEffect(() => {
    carregarSaldo();
  }, []);

  return (
    <main style={{ fontFamily: 'Arial, sans-serif', padding: 32, maxWidth: 900, margin: '0 auto' }}>
      <h1>CV Analyzer</h1>
      <p>Analise currículos e use suas moedas para consultas.</p>

      <section style={{ marginTop: 32, padding: 20, border: '1px solid #ddd', borderRadius: 10 }}>
        <h2>Seu saldo</h2>
        <p style={{ fontSize: 28, fontWeight: 'bold' }}>
          {coins === null ? 'Carregando...' : `${coins} moedas`}
        </p>
        <button onClick={carregarSaldo}>Atualizar saldo</button>
      </section>

      <section style={{ marginTop: 32, padding: 20, border: '1px solid #ddd', borderRadius: 10 }}>
        <h2>Comprar moedas</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={() => comprarMoedas(5)} disabled={loading}>
            Comprar 5 moedas
          </button>
          <button onClick={() => comprarMoedas(20)} disabled={loading}>
            Comprar 20 moedas
          </button>
          <button onClick={() => comprarMoedas(50)} disabled={loading}>
            Comprar 50 moedas
          </button>
        </div>
      </section>

      <section style={{ marginTop: 32, padding: 20, border: '1px solid #ddd', borderRadius: 10 }}>
        <h2>Comprar consulta</h2>
        <p>Depois a gente liga isso no seu sistema de análise.</p>
      </section>
    </main>
  );
}

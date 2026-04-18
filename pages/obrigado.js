import { useEffect, useState } from 'react';

export default function Obrigado() {
  const [status, setStatus] = useState('carregando');
  const [codigo, setCodigo] = useState('');
  const [mensagem, setMensagem] = useState('Carregando...');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');

    async function verificar() {
      if (!ref) {
        setStatus('erro');
        setMensagem('Referencia nao encontrada.');
        return;
      }

      try {
        const res = await fetch(`/api/pedido?ref=${encodeURIComponent(ref)}`);
        const data = await res.json();

        if (!res.ok) {
          setStatus('erro');
          setMensagem(data.error || 'Erro ao consultar pedido.');
          return;
        }

        if (data.status === 'aprovado' && data.codigo) {
          setStatus('aprovado');
          setCodigo(data.codigo);
          return;
        }

        if (String(data.status).toLowerCase() === 'recusado') {
          setStatus('recusado');
          setMensagem('Pagamento recusado.');
          return;
        }

        setStatus('pendente');
        setMensagem('Aguardando confirmacao do pagamento...');
        setTimeout(verificar, 3000);
      } catch (e) {
        setStatus('erro');
        setMensagem('Erro de conexao ao consultar pedido.');
      }
    }

    verificar();
  }, []);

  return (
    <main style={{ fontFamily: 'Arial, sans-serif', padding: 24, maxWidth: 700, margin: '0 auto' }}>
      <h1>Obrigado pela compra</h1>

      {status === 'carregando' && <p>{mensagem}</p>}
      {status === 'pendente' && <p>{mensagem}</p>}
      {status === 'recusado' && <p>{mensagem}</p>}
      {status === 'erro' && <p>{mensagem}</p>}

      {status === 'aprovado' && (
        <div style={{ marginTop: 24 }}>
          <p>Pagamento aprovado. Seu codigo:</p>
          <div
            style={{
              fontSize: 28,
              fontWeight: 'bold',
              padding: 16,
              border: '1px solid #ddd',
              borderRadius: 8,
              background: '#f7f7f7',
              wordBreak: 'break-word',
            }}
          >
            {codigo}
          </div>
          <p style={{ marginTop: 12 }}>Guarde esse codigo com seguranca.</p>
        </div>
      )}
    </main>
  );
}

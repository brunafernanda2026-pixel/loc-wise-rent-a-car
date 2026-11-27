
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  const pagarmeKey = process.env.PAGARME_SECRET_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!pagarmeKey || !supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Configuração incompleta." });
  }

  const precos = {
    "Fiat Mobi Like": 12900,
    "Chevrolet Onix LT": 15900,
    "Toyota Corolla XEi": 24900,
    "Honda Civic": 27900,
    "Jeep Compass": 32900,
    "Toyota Hilux 4x4": 45900
  };

  try {
    const {
      veiculo,
      retirada,
      devolucao,
      nome,
      whatsapp,
      email
    } = req.body || {};

    const diaria = precos[veiculo];

    if (
      !diaria || !retirada || !devolucao ||
      !nome?.trim() || !whatsapp?.trim() || !email?.trim()
    ) {
      return res.status(400).json({ error: "Preencha todos os dados." });
    }

    const inicio = new Date(`${retirada}T12:00:00Z`);
    const fim = new Date(`${devolucao}T12:00:00Z`);
    const dias = (fim - inicio) / 86400000;

    if (
      !Number.isInteger(dias) ||
      dias < 1 || dias > 30 ||
      Number.isNaN(inicio.getTime()) ||
      retirada < new Date().toISOString().slice(0, 10)
    ) {
      return res.status(400).json({ error: "Confira as datas." });
    }

    const total = diaria * dias;

    const reservaResponse = await fetch(
      `${supabaseUrl}/rest/v1/reservations`,
      {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          customer_name: nome.trim(),
          whatsapp: whatsapp.trim(),
          email: email.trim(),
          vehicle_name: veiculo,
          pickup_date: retirada,
          dropoff_date: devolucao,
          pickup_location: "Aeroporto Internacional do Recife (REC)",
          status: "pending",
          payment_status: "pending"
        })
      }
    );

    const reservas = await reservaResponse.json();

    if (!reservaResponse.ok || !reservas[0]?.id) {
      console.error("Erro ao registrar reserva:", reservas);
      return res.status(502).json({
        error: "Não foi possível registrar a reserva."
      });
    }

    const reserva = reservas[0];
    const auth = Buffer.from(`${pagarmeKey}:`).toString("base64");

    const pagamentoResponse = await fetch(
      "https://api.pagar.me/core/v5/paymentlinks",
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          type: "order",
          name: `LOC WISE - ${veiculo}`,
          order_code: String(reserva.id),
          expires_in: 60,
          max_paid_sessions: 1,
          payment_settings: {
            accepted_payment_methods: ["pix", "credit_card"],
            pix_settings: {},
            credit_card_settings: {
              operation_type: "auth_and_capture",
              installments: [{ number: 1, total }]
            }
          },
          cart_settings: {
            items: [{
              amount: total,
              name: `${veiculo} - ${dias} diária(s)`,
              default_quantity: 1
            }]
          }
        })
      }
    );

    const pagamento = await pagamentoResponse.json();

    if (!pagamentoResponse.ok || !pagamento.url || !pagamento.id) {
      console.error("Erro ao criar checkout:", pagamento);
      return res.status(502).json({
        error: "Reserva registrada, mas não foi possível gerar o pagamento."
      });
    }

    const updateResponse = await fetch(
      `${supabaseUrl}/rest/v1/reservations?id=eq.${reserva.id}`,
      {
        method: "PATCH",
        headers: {
          "apikey": supabaseKey,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          pagarme_order_id: pagamento.id
        })
      }
    );

    if (!updateResponse.ok) {
      console.error("Erro ao atualizar reserva:", await updateResponse.text());
      return res.status(502).json({
        error: "Pagamento criado, mas não foi possível atualizar a reserva."
      });
    }

    return res.status(200).json({
      checkout_url: pagamento.url,
      valor: total / 100
    });

  } catch (erro) {
    console.error("Erro interno:", erro);
    return res.status(500).json({ error: "Erro interno." });
  }
}


async function lerResposta(response) {
  const texto = await response.text();

  if (!texto) {
    return { dados: null, texto: "" };
  }

  try {
    return {
      dados: JSON.parse(texto),
      texto
    };
  } catch {
    return {
      dados: null,
      texto
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido."
    });
  }

  const pagarmeKey = process.env.PAGARME_SECRET_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!pagarmeKey || !supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      error: "Configuração incompleta."
    });
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
      !diaria ||
      !retirada ||
      !devolucao ||
      !nome?.trim() ||
      !whatsapp?.trim() ||
      !email?.trim()
    ) {
      return res.status(400).json({
        error: "Preencha todos os dados."
      });
    }

    const inicio = new Date(`${retirada}T12:00:00Z`);
    const fim = new Date(`${devolucao}T12:00:00Z`);
    const dias = (fim - inicio) / 86400000;

    if (
      !Number.isInteger(dias) ||
      dias < 1 ||
      dias > 30 ||
      Number.isNaN(inicio.getTime()) ||
      retirada < new Date().toISOString().slice(0, 10)
    ) {
      return res.status(400).json({
        error: "Confira as datas."
      });
    }

    const total = diaria * dias;

    // 1. Registrar reserva no Supabase
    const reservaResponse = await fetch(
      `${supabaseUrl}/rest/v1/reservations`,
      {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
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

    const reservaResultado = await lerResposta(reservaResponse);
    const reservas = reservaResultado.dados;

    if (
      !reservaResponse.ok ||
      !Array.isArray(reservas) ||
      !reservas[0]?.id
    ) {
      console.error("ERRO SUPABASE:", {
        status: reservaResponse.status,
        resposta: reservaResultado.texto
      });

      return res.status(502).json({
        error: "Não foi possível registrar a reserva."
      });
    }

    const reserva = reservas[0];

    // 2. Criar checkout na Pagar.me
    const auth = Buffer
      .from(`${pagarmeKey}:`)
      .toString("base64");

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
              installments: [
                {
                  number: 1,
                  total: total
                }
              ]
            }
          },
          cart_settings: {
            items: [
              {
                amount: total,
                name: `${veiculo} - ${dias} diária(s)`,
                default_quantity: 1
              }
            ]
          }
        })
      }
    );

    const pagamentoResultado = await lerResposta(pagamentoResponse);
    const pagamento = pagamentoResultado.dados;

    if (
      !pagamentoResponse.ok ||
      !pagamento?.url ||
      !pagamento?.id
    ) {
      console.error("ERRO PAGAR.ME:", {
        status: pagamentoResponse.status,
        resposta: pagamentoResultado.texto
      });

      return res.status(502).json({
        error: "Não foi possível gerar o pagamento."
      });
    }

    // 3. Atualizar reserva com o identificador do pagamento
    const updateResponse = await fetch(
      `${supabaseUrl}/rest/v1/reservations?id=eq.${reserva.id}`,
      {
        method: "PATCH",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          pagarme_order_id: pagamento.id
        })
      }
    );

    if (!updateResponse.ok) {
      const erroUpdate = await updateResponse.text();

      console.error("ERRO AO ATUALIZAR RESERVA:", {
        status: updateResponse.status,
        resposta: erroUpdate
      });

      return res.status(502).json({
        error: "Pagamento criado, mas não foi possível atualizar a reserva."
      });
    }

    return res.status(200).json({
      checkout_url: pagamento.url,
      valor: total / 100
    });

  } catch (erro) {
    console.error("ERRO INTERNO:", erro);

    return res.status(500).json({
      error: "Erro interno."
    });
  }
}

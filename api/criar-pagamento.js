
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const secret = process.env.PAGARME_SECRET_KEY;

  if (!secret) {
    return res.status(500).json({ error: "Configuração de pagamento ausente." });
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
    const { veiculo, retirada, devolucao } = req.body || {};
    const diaria = precos[veiculo];

    if (!diaria || !retirada || !devolucao) {
      return res.status(400).json({ error: "Dados inválidos." });
    }

    const inicio = new Date(`${retirada}T12:00:00`);
    const fim = new Date(`${devolucao}T12:00:00`);
    const dias = Math.round((fim - inicio) / 86400000);

    if (
      !Number.isFinite(dias) ||
      dias < 1 ||
      dias > 30 ||
      inicio < new Date(new Date().toDateString())
    ) {
      return res.status(400).json({ error: "Confira as datas da locação." });
    }

    const total = diaria * dias;
    const auth = Buffer.from(`${secret}:`).toString("base64");

    const resposta = await fetch(
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
          expires_in: 60,
          max_paid_sessions: 1,
          payment_settings: {
            accepted_payment_methods: ["pix", "credit_card"],
            pix_settings: {},
            credit_card_settings: {
              operation_type: "auth_and_capture",
              installments: [
                { number: 1, total: total }
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

    const dados = await resposta.json();

    if (!resposta.ok) {
      console.error("Erro Pagar.me:", dados);
      return res.status(502).json({
        error: "Não foi possível criar o pagamento."
      });
    }

    return res.status(200).json({
      checkout_url: dados.url,
      valor: total / 100
    });

  } catch (erro) {
    console.error(erro);
    return res.status(500).json({ error: "Erro interno." });
  }
}

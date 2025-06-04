import { buffer } from 'micro';
import Stripe from 'stripe';

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  let buf;
  try {
    buf = await buffer(req);
  } catch (err) {
    console.error('❌ Error al leer el buffer:', err.message);
    return res.status(400).send('Invalid body');
  }

  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, secret);
  } catch (err) {
    console.error('❌ Verificación fallida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('✅ Evento recibido:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data?.object;

    console.log('📩 Datos de sesión recibidos:');
    console.log('  - Email:', session?.customer_details?.email);
    console.log('  - Producto:', session?.metadata?.product_id);

    // Aquí podrías agregar lógica real más adelante
  }

  res.status(200).json({ received: true });
}

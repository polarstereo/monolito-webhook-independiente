import { buffer } from 'micro';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

    const email = session?.customer_details?.email;
    const productId = session?.client_reference_id;

    console.log("🧾 session completa:");
    console.dir(session, { depth: null });

    console.log("📩 Dato

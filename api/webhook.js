import Stripe from 'stripe';
import { buffer } from 'micro';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe("sk_test_TU_CLAVE_AQUI", {
  apiVersion: '2023-10-16'
});

const supabase = createClient(
  "https://TU_PROYECTO.supabase.co",
  "eyJhbGciOi..." // anon key
);

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  const secret = "whsec_TU_CLAVE_WEBHOOK";

  let rawBody;
  try {
    rawBody = await buffer(req);
  } catch (err) {
    return res.status(400).send(`Error reading body: ${err.message}`);
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Aquí va la lógica de sesión/membresías como antes...
  console.log('✅ Webhook verificado correctamente:', event.type);

  res.status(200).json({ received: true });
}

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
    console.error('Error al leer el buffer:', err.message);
    return res.status(400).send('Invalid body');
  }

  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, secret);
  } catch (err) {
    console.error('Verificacion fallida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Evento recibido:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data?.object;

    const email = session?.customer_details?.email;
    const productId = session?.client_reference_id;

    console.log("Session completa:");
    console.dir(session, { depth: null });

    console.log("Datos recibidos:");
    console.log(" - Email:", email);
    console.log(" - Producto ID:", productId);

    if (!email || !productId) {
      console.error('Faltan datos del usuario o producto');
      return res.status(400).send('Missing metadata');
    }

    const { data: membresias, error: errorMembresia } = await supabase
      .from('membresias')
      .select('*')
      .ilike('stripe_product_id', productId);

    console.log("Resultado membresias:", membresias);
    if (errorMembresia) console.error("Error membresia:", errorMembresia.message);

    const membresia = membresias?.[0];
    if (!membresia) {
      console.error('Membresia no encontrada:', productId);
      return res.status(404).send('Membresia no encontrada');
    }

    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (!user) {
      const { data: newUser, error } = await supabase
        .from('users')
        .insert([{ email, rol: 'estudiante' }])
        .select()
        .single();

      if (error) {
        console.error('Error al crear usuario en tabla users:', error.message);
        return res.status(500).send('No se pudo crear el usuario');
      }

      user = newUser;
      console.log('Usuario creado en tabla users:', user.id);
    } else {
      console.log('Usuario ya existia en tabla users:', user.id);
    }

    // Verificar si existe en auth.users
    const { data: authUser, error: authCheckError } = await supabase
      .from('auth.users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (!authUser) {
      console.log('Usuario NO existe en auth.users. Creando ahora:', email);
      const { error: authError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
      });

      if (authError && authError.message !== 'User already registered') {
        console.error('Error al crear usuario en auth.users:', authError.message);
      } else {
        console.log('Usuario creado en auth.users correctamente');
      }
    } else {
      console.log('Usuario ya existe también en auth.users');
    }

    const { error: insertError } = await supabase
      .from('usuario_membresias')
      .insert([
        {
          usuario_id: user.id,
          membresia_id: membresia.id,
          horas_disponibles: membresia.horas_semanales,
        },
      ]);

    if (insertError) {
      console.error('Error al asignar membresia:', insertError.message);
      return res.status(500).send('No se pudo asignar membresia');
    }

    console.log('Membresia asignada correctamente.');
  } else {
    console.log('Evento ignorado:', event.type);
  }

  res.status(200).json({ received: true });
}

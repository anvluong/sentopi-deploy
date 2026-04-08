exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { name, email } = payload;

  if (!email) {
    return { statusCode: 400, body: 'Email is required' };
  }

  const KIT_API_KEY    = process.env.KIT_API_KEY;
  const KIT_SEQUENCE_ID = process.env.KIT_SEQUENCE_ID || '2709975';

  // Add subscriber via Kit v3 API — sequence subscribe endpoint
  const kitRes = await fetch(
    `https://api.convertkit.com/v3/sequences/${KIT_SEQUENCE_ID}/subscribe`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: KIT_API_KEY,
        email,
        first_name: name ? name.split(' ')[0] : '',
      }),
    }
  );

  if (!kitRes.ok) {
    const err = await kitRes.text();
    console.error('Kit API error:', err);
    return { statusCode: 502, body: 'Subscription failed' };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};

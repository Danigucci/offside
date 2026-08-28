export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const data = await req.json();
    const { name, phone, email, team, message } = data;

    if (!email || !name) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.FROM_EMAIL;
    const toEmail = process.env.TO_EMAIL;

    if (!apiKey || !fromEmail || !toEmail) {
      return new Response(JSON.stringify({ error: "Server email config missing" }), { status: 500 });
    }

    const html = `
      <h2>Новая заявка на регистрацию</h2>
      <p><strong>Имя:</strong> ${escapeHtml(name)}</p>
      ${phone ? `<p><strong>Телефон:</strong> ${escapeHtml(phone)}</p>` : ""}
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      ${team ? `<p><strong>Команда:</strong> ${escapeHtml(team)}</p>` : ""}
      ${message ? `<p><strong>Сообщение:</strong> ${escapeHtml(message)}</p>` : ""}
    `;

    const confirmationHtml = `
      <p>Привет!</p>
      <p>Вы зарегистрированы на игру <strong>«Осенняя серия игр»</strong>:</p>
      <p>
        📅 <strong>09.09.26</strong>, начало в <strong>19:00</strong><br>
        📍 Kin Za Dumplings and Oysters at Kudamm, Dahlmannstraße 23, 10629 Berlin<br>
        💶 Вход: <strong>12 €</strong> с человека<br>
        👥 Команда: <strong>${escapeHtml(team || "—")}</strong>
      </p>
      <p>Формат: Спортивная классика — 7 туров (разминка, правда/ложь, музыкальный, ЧМ, картинки, 3 факта, блиц). Максимум 10 человек в команде.</p>
      <p>До встречи на игре!<br>OFFSIDE Quiz Berlin</p>
    `;

    const [adminRes, confirmRes] = await Promise.all([
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: toEmail,
          reply_to: email,
          subject: `Новая заявка: ${name}`,
          html,
        }),
      }),
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: email,
          subject: "Вы зарегистрированы — OFFSIDE Quiz Berlin ⚽",
          html: confirmationHtml,
        }),
      }),
    ]);

    if (!adminRes.ok) {
      const errText = await adminRes.text();
      return new Response(JSON.stringify({ error: "Resend error (admin)", details: errText }), { status: 502 });
    }
    if (!confirmRes.ok) {
      const errText = await confirmRes.text();
      return new Response(JSON.stringify({ error: "Resend error (confirmation)", details: errText }), { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Unexpected error", details: String(err) }), { status: 500 });
  }
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const PLACE = "Kvartira 62, Lübbener Str. 18, 10997 Berlin-Bezirk Friedrichshain-Kreuzberg";
const GAMES = {
  "07.10.26": { title: "Осенняя серия игр", time: "19:00", place: PLACE, price: "12 €", closeAt: "2026-10-07T18:00:00+02:00" },
  "08.11.26": { title: "День рождения квиза: нам ровно год!", time: "19:00", place: PLACE, price: "15 €" },
};

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const data = await req.json();
    const { name, phone, email, team, message, gameDate } = data;
    const game = GAMES[gameDate] || GAMES["08.11.26"];
    const date = GAMES[gameDate] ? gameDate : "08.11.26";

    if (game.closeAt && Date.now() >= new Date(game.closeAt).getTime()) {
      return new Response(JSON.stringify({ error: "Registration closed" }), { status: 410 });
    }

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
      <h2>Новая заявка на регистрацию (${date})</h2>
      <p><strong>Имя:</strong> ${escapeHtml(name)}</p>
      ${phone ? `<p><strong>Телефон:</strong> ${escapeHtml(phone)}</p>` : ""}
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      ${team ? `<p><strong>Команда:</strong> ${escapeHtml(team)}</p>` : ""}
      ${message ? `<p><strong>Сообщение:</strong> ${escapeHtml(message)}</p>` : ""}
    `;

    const confirmationHtml = `
      <p>Привет!</p>
      <p>Вы зарегистрированы на игру <strong>«${game.title}»</strong>:</p>
      <p>
        📅 <strong>${date}</strong>, начало в <strong>${game.time}</strong><br>
        📍 ${game.place}<br>
        💶 Вход: <strong>${game.price}</strong> с человека<br>
        👥 Команда: <strong>${escapeHtml(team || "—")}</strong>
      </p>
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
          subject: `Новая заявка (${date}): ${name}`,
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

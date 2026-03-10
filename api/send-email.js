export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { to, subject, body, from_name } = req.body;
  if (!to || !subject || !body) return res.status(400).json({ error: "Missing fields" });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: "RESEND_API_KEY not configured" });

  const SHOP_EMAIL = process.env.SHOP_FROM_EMAIL || "info@foppo.fi";
  const SHOP_NAME  = process.env.SHOP_FROM_NAME  || "Foppo Älylaitehuolto";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${SHOP_NAME} <${SHOP_EMAIL}>`,
        to: [to],
        subject,
        text: body,
        // Convert plain text newlines to HTML for nicer rendering
        html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.7;color:#222;max-width:560px;margin:0 auto;padding:32px 24px">
          ${body.replace(/\n/g, "<br>")}
          <hr style="margin-top:32px;border:none;border-top:1px solid #eee">
          <p style="font-size:12px;color:#999;margin-top:16px">${SHOP_NAME}</p>
        </div>`,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Resend error:", data);
      return res.status(500).json({ error: data.message || "Failed to send email" });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    console.error("Email send error:", err);
    return res.status(500).json({ error: err.message });
  }
}

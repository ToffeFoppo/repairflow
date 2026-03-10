export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ error: "Missing fields" });

  const API_USER    = process.env.FORTYSIXELKS_USER;
  const API_PASS    = process.env.FORTYSIXELKS_PASS;
  const SENDER_NAME = process.env.FORTYSIXELKS_SENDER || "Foppo";

  if (!API_USER || !API_PASS) return res.status(500).json({ error: "46elks credentials not configured" });

  // Normalize Finnish numbers: 04x → +3584x
  let phone = to.replace(/\s/g, "");
  if (phone.startsWith("0")) phone = "+358" + phone.slice(1);

  try {
    const body = new URLSearchParams({
      from: SENDER_NAME,
      to: phone,
      message,
    });

    const response = await fetch("https://api.46elks.com/a1/sms", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${API_USER}:${API_PASS}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const data = await response.json();
    if (!response.ok || data.status === "failed") {
      console.error("46elks error:", data);
      return res.status(500).json({ error: data.message || "Failed to send SMS" });
    }

    return res.status(200).json({ success: true, id: data.id, status: data.status });
  } catch (err) {
    console.error("SMS send error:", err);
    return res.status(500).json({ error: err.message });
  }
}

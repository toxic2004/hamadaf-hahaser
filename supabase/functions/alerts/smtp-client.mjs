// Gmail delivery via SMTP + App Password (2026-08-15, pending user approval to
// deploy). This intentionally avoids pulling in nodemailer or any other npm
// SMTP client: Supabase Edge Functions run on a restricted Deno runtime, and
// heavy Node-compat dependencies (net/tls/dns) are a real risk of not working
// cleanly there. Deno's native Deno.connect/Deno.startTls are already used
// elsewhere for direct Postgres/Redis connections in Edge Functions, so a
// small hand-written SMTP+STARTTLS client is the more reliable choice here.

function toBase64(value) {
  return btoa(unescape(encodeURIComponent(value)));
}

function wrapBase64(value) {
  const raw = toBase64(value);
  const lines = [];
  for (let index = 0; index < raw.length; index += 76) {
    lines.push(raw.slice(index, index + 76));
  }
  return lines.join("\r\n");
}

function dotStuff(message) {
  return message
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? "." + line : line))
    .join("\r\n");
}

export function buildMimeMessage({ from, to, subject, html, text }) {
  const boundary = `hamadaf-${crypto.randomUUID()}`;
  const encodedSubject = `=?UTF-8?B?${toBase64(subject)}?=`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    wrapBase64(text || ""),
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    wrapBase64(html || ""),
    ``,
    `--${boundary}--`,
    ``,
  ];
  return lines.join("\r\n");
}

function parseSmtpResponse(rawText) {
  const lines = rawText.split("\r\n").filter(Boolean);
  const lastLine = lines[lines.length - 1] || "";
  const code = Number(lastLine.slice(0, 3));
  return { code, text: rawText, complete: /^\d{3} /.test(lastLine) };
}

async function readSmtpResponse(connection, decoder) {
  const buffer = new Uint8Array(4096);
  let text = "";
  for (;;) {
    const bytesRead = await connection.read(buffer);
    if (bytesRead === null) break;
    text += decoder.decode(buffer.subarray(0, bytesRead));
    const parsed = parseSmtpResponse(text);
    if (parsed.complete) return parsed;
  }
  return parseSmtpResponse(text);
}

async function runSmtpCommand(connection, decoder, encoder, line, expectedCodes) {
  await connection.write(encoder.encode(`${line}\r\n`));
  const response = await readSmtpResponse(connection, decoder);
  if (!expectedCodes.includes(response.code)) {
    throw new Error(`SMTP command failed (${line.split(" ")[0]}): ${response.text.trim()}`);
  }
  return response;
}

export async function sendMailViaGmailSmtp({
  user,
  pass,
  from,
  to,
  subject,
  html,
  text,
  hostname = "smtp.gmail.com",
  port = 587,
}) {
  if (!user || !pass) throw new Error("Missing Gmail SMTP credentials");
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let conn = await Deno.connect({ hostname, port });
  try {
    const greeting = await readSmtpResponse(conn, decoder);
    if (greeting.code !== 220) {
      throw new Error(`Unexpected SMTP greeting: ${greeting.text.trim()}`);
    }
    await runSmtpCommand(conn, decoder, encoder, "EHLO hamadaf-hahaser", [250]);
    await runSmtpCommand(conn, decoder, encoder, "STARTTLS", [220]);
    conn = await Deno.startTls(conn, { hostname });
    await runSmtpCommand(conn, decoder, encoder, "EHLO hamadaf-hahaser", [250]);
    await runSmtpCommand(conn, decoder, encoder, "AUTH LOGIN", [334]);
    await runSmtpCommand(conn, decoder, encoder, toBase64(user), [334]);
    await runSmtpCommand(conn, decoder, encoder, toBase64(pass), [235]);
    await runSmtpCommand(conn, decoder, encoder, `MAIL FROM:<${user}>`, [250]);
    await runSmtpCommand(conn, decoder, encoder, `RCPT TO:<${to}>`, [250, 251]);
    await runSmtpCommand(conn, decoder, encoder, "DATA", [354]);
    const message = buildMimeMessage({ from, to, subject, html, text });
    const payload = `${dotStuff(message)}\r\n.\r\n`;
    await conn.write(encoder.encode(payload));
    const dataResponse = await readSmtpResponse(conn, decoder);
    if (dataResponse.code !== 250) {
      throw new Error(`SMTP message rejected: ${dataResponse.text.trim()}`);
    }
    await conn.write(encoder.encode("QUIT\r\n"));
    return { ok: true, response: dataResponse.text.trim() };
  } finally {
    try {
      conn.close();
    } catch {
      // Connection may already be closed by the server after QUIT; ignore.
    }
  }
}

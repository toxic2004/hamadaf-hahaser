const REQUEST_TIMEOUT_MS = 20_000;

function required(value, name) {
  const result = String(value || "").trim();
  if (!result)
    throw new Error(`Missing required environment variable: ${name}`);
  return result;
}

function endpointUrl(value) {
  const endpoint = new URL(required(value, "SUPABASE_ALERTS_URL"));
  if (endpoint.protocol !== "https:")
    throw new Error("SUPABASE_ALERTS_URL must use HTTPS");
  return endpoint.toString();
}

async function request(endpoint, secret, fetchImpl) {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-schedule-secret": secret,
    },
    body: JSON.stringify({ mode: "schedule" }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

export async function runAlertsSmokeTest({
  endpoint: endpointValue,
  secret: secretValue,
  fetchImpl = fetch,
}) {
  const endpoint = endpointUrl(endpointValue);
  const secret = required(secretValue, "SUPABASE_ALERTS_SCHEDULE_SECRET");
  const invalidSecret = `${secret}.invalid`;

  const rejected = await request(endpoint, invalidSecret, fetchImpl);
  if (rejected.response.status !== 401)
    throw new Error("The endpoint did not reject an invalid schedule secret");

  const accepted = await request(endpoint, secret, fetchImpl);
  if (!accepted.response.ok || accepted.body?.ok !== true)
    throw new Error(
      `The authorized schedule request failed with status ${accepted.response.status}`,
    );

  return {
    rejectedInvalidSecret: true,
    authorizedRequest: true,
    localDate: accepted.body.local?.date || null,
    localHour: accepted.body.local?.hour ?? null,
    usersChecked: Number(accepted.body.users || 0),
    resultsReturned: Array.isArray(accepted.body.results)
      ? accepted.body.results.length
      : 0,
  };
}

const isDirectRun =
  process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;

if (isDirectRun) {
  try {
    const result = await runAlertsSmokeTest({
      endpoint: process.env.SUPABASE_ALERTS_URL,
      secret: process.env.SUPABASE_ALERTS_SCHEDULE_SECRET,
    });
    console.log("Alerts smoke test passed");
    console.log(`Invalid secret rejected: ${result.rejectedInvalidSecret}`);
    console.log(`Authorized request accepted: ${result.authorizedRequest}`);
    console.log(`Users checked: ${result.usersChecked}`);
    console.log(`Results returned: ${result.resultsReturned}`);
  } catch (error) {
    console.error(
      "Alerts smoke test failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exitCode = 1;
  }
}

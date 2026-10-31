// Stands in for Ollama in the end-to-end stack, so the review flow is fast and the same
// every run. Every chat request gets the reading llama3.2 really gave for
// fixtures/sample-energy-bill.pdf: the total copied into the VAT field, which the VAT
// checks catch, so the document always lands in review.
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 11434);

// Printed values, as the extraction prompt asks for; the pipeline parses the units
const reading = {
  supplier: "Northern Power Ltd",
  account_number: "AC-1029384",
  meter_point_number: "1200023456781",
  billing_period_start: "2026-08-01",
  billing_period_end: "2026-08-31",
  consumption_kwh: "1,250 kWh",
  unit_rate_pence: "24.5p",
  standing_charge_pence_per_day: "52.1p",
  subtotal_gbp: "£322.40",
  vat_rate_percent: "20%",
  vat_gbp: "£386.88",
  total_gbp: "£386.88",
};

function reply(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

createServer((request, response) => {
  if (request.method === "GET" && (request.url === "/" || request.url === "/api/version")) {
    reply(response, 200, { version: "stub" });
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/chat") {
    reply(response, 404, { error: "not found" });
    return;
  }

  let raw = "";
  request.on("data", (chunk) => {
    raw += chunk;
  });
  request.on("end", () => {
    const { model = "stub" } = JSON.parse(raw || "{}");
    reply(response, 200, {
      model,
      created_at: new Date().toISOString(),
      message: { role: "assistant", content: JSON.stringify(reading) },
      done: true,
      done_reason: "stop",
      total_duration: 1_000_000,
    });
  });
}).listen(port, () => {
  console.log(`ollama stub listening on ${String(port)}`);
});

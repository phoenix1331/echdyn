# Labelled sets

Ground truth for measuring extraction accuracy. Each set is a directory of PDFs, each with a JSON label beside it.

| Directory         | Contents                                                                      | In git          |
| ----------------- | ----------------------------------------------------------------------------- | --------------- |
| `sets/synthetic/` | 30 generated UK energy bills (`make eval-generate`, seed 1331)                | Yes             |
| `sets/scanned/`   | The same 30 bills as image-only scans, same labels, layout marked `(scanned)` | Yes             |
| `sets/private/`   | Your own real documents and labels                                            | No (gitignored) |

## Label format

`bill-001.json` labels `bill-001.pdf`:

```json
{
  "document_type": "uk-energy-bill",
  "source": "real",
  "layout": "Northern Power Ltd",
  "notes": "Scanned, slight skew",
  "expected": {
    "supplier": "Northern Power Ltd",
    "account_number": "AC-1029384",
    "meter_point_number": "1200023456781",
    "billing_period_start": "2026-08-01",
    "billing_period_end": "2026-08-31",
    "consumption_kwh": 1250,
    "unit_rate_pence": 24.5,
    "standing_charge_pence_per_day": 52.1,
    "subtotal_gbp": 322.4,
    "vat_rate_percent": 20,
    "vat_gbp": 64.48,
    "total_gbp": 386.88
  }
}
```

| Key             | Required | Notes                                                                                           |
| --------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `document_type` | Yes      | A registered slug, e.g. `uk-energy-bill`                                                        |
| `source`        | Yes      | `synthetic` or `real`                                                                           |
| `expected`      | Yes      | Hand-checked values in the schema's units (money in pounds, rates in pence, dates `YYYY-MM-DD`) |
| `file`          | No       | PDF name if it differs from the label's name                                                    |
| `layout`        | No       | Supplier template or similar; the report breaks accuracy down by it (defaults to `source`)      |
| `notes`         | No       | Anything that explains a hard case                                                              |

Labels are validated against the document type's schema when loaded, so a typo in ground truth fails loudly rather than quietly lowering measured accuracy.

## Adding your own documents

1. Put PDFs in `sets/private/`.
2. Write a label for each, checking every value against the printed document.
3. Run the eval against that directory to see which model suits your paperwork.

## Synthetic bills

Three supplier layouts with different labels, date formats (`01/08/2026`, `1 August 2026`, `01-Aug-26`) and units (one quotes rates in £/kWh, which must end up in pence). Bills mix electricity (valid MPAN check digits) and gas (volume to kWh conversion lines), 5% and 20% VAT, and include distractor figures: previous balances, payments, meter readings and a 12-month usage page on some bills. Every label passes the document type's business rules.

## Scanned bills

`make eval-generate` also writes `sets/scanned/`: each synthetic bill rasterised at 150 DPI, tilted by up to a degree on off-white paper, speckled and saved as JPEG pages in an image-only PDF. With no text layer, the pipeline renders the pages and sends them to the vision model (`OLLAMA_VISION_MODEL`), so this set measures the vision path against exactly the ground truth the text set uses.

## Running the eval

`make eval` runs every set present. Text documents are read by each model in `MODELS`, scans by `VISION_MODEL` (default `OLLAMA_VISION_MODEL`). The report shows each set apart, with the model that actually read it.

| Example                              | Runs                                   |
| ------------------------------------ | -------------------------------------- |
| `make eval`                          | Everything, with the models in `.env`  |
| `make eval MODELS=llama3.2,qwen3:8b` | Two text models, same vision model     |
| `make eval LIMIT=5`                  | The first 5 documents of every set     |
| `make eval LIMIT=scanned=5`          | Every text document, the first 5 scans |

Vision on CPU is slow (minutes per scan), so limit the scanned set on machines without a GPU.

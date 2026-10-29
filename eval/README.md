# Labelled sets

Ground truth for measuring extraction accuracy. Each set is a directory of PDFs, each with a JSON label beside it.

| Directory         | Contents                                                       | In git          |
| ----------------- | -------------------------------------------------------------- | --------------- |
| `sets/synthetic/` | 30 generated UK energy bills (`make eval-generate`, seed 1331) | Yes             |
| `sets/private/`   | Your own real documents and labels                             | No (gitignored) |

## Label format

`bill-001.json` labels `bill-001.pdf`:

```json
{
  "document_type": "uk-energy-bill",
  "source": "real",
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
| `notes`         | No       | Anything that explains a hard case                                                              |

Labels are validated against the document type's schema when loaded, so a typo in ground truth fails loudly rather than quietly lowering measured accuracy.

## Adding your own documents

1. Put PDFs in `sets/private/`.
2. Write a label for each, checking every value against the printed document.
3. Run the eval against that directory to see which model suits your paperwork.

## Synthetic bills

Three supplier layouts with different labels, date formats (`01/08/2026`, `1 August 2026`, `01-Aug-26`) and units (one quotes rates in £/kWh, which the model must convert to pence). Bills mix electricity (valid MPAN check digits) and gas (volume to kWh conversion lines), 5% and 20% VAT, and include distractor figures: previous balances, payments, meter readings and a 12-month usage page on some bills. Every label passes the document type's business rules.
